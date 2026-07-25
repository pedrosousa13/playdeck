#!/usr/bin/env node
// Packaging correctness harness: builds and packs every publishable workspace
// package, lints each tarball with publint + attw, then installs the packed
// tarballs (not workspace links) into a clean React 19/Vite fixture, builds
// it, and smoke-tests the result in a real browser.
//
// New workspace packages are covered automatically: package discovery comes
// from `pnpm list -r`, filtered to non-private projects. Nothing here is
// hardcoded to today's package names.

import { chromium } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import {
  cpSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync
} from 'node:fs';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { extname, join } from 'node:path';
import { fileURLToPath, URL } from 'node:url';

const console = globalThis.console;
const process = globalThis.process;

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const fixtureTemplate = join(repoRoot, 'tests/packaging/fixture');

const run = (command, args, options = {}) =>
  execFileSync(command, args, {
    cwd: repoRoot,
    stdio: 'inherit',
    ...options
  });

const tryRun = (command, args, options = {}) => {
  try {
    run(command, args, options);
    return true;
  } catch {
    return false;
  }
};

const tarballFileName = (name, version) =>
  `${name.replace(/^@/, '').replace('/', '-')}-${version}.tgz`;

async function main() {
  // 1. Discover every publishable (non-private) workspace package.
  const listing = JSON.parse(
    execFileSync('pnpm', ['list', '-r', '--depth', '-1', '--json'], {
      cwd: repoRoot,
      encoding: 'utf8'
    })
  );
  const packages = listing.filter((entry) => entry.private === false);
  if (packages.length === 0) {
    throw new Error('No publishable workspace packages were discovered.');
  }
  console.log(
    `Discovered ${packages.length} publishable package(s): ${packages
      .map((pkg) => pkg.name)
      .join(', ')}`
  );

  const tarballDir = mkdtempSync(join(tmpdir(), 'reely-packaging-tarballs-'));
  const failures = [];

  try {
    // 2. Build and pack each package.
    for (const pkg of packages) {
      console.log(`\n--- Building ${pkg.name} ---`);
      run('pnpm', ['exec', 'turbo', 'run', 'build', '--filter', pkg.name]);
      console.log(`--- Packing ${pkg.name} ---`);
      run('pnpm', [
        '--filter',
        pkg.name,
        'pack',
        '--pack-destination',
        tarballDir
      ]);
    }

    // 3. Lint every tarball with publint and attw.
    for (const pkg of packages) {
      const tarball = join(tarballDir, tarballFileName(pkg.name, pkg.version));

      console.log(`\n--- publint: ${pkg.name} ---`);
      if (!tryRun('pnpm', ['exec', 'publint', 'run', '--strict', tarball])) {
        failures.push(`publint failed for ${pkg.name}`);
      }

      console.log(`\n--- attw --pack: ${pkg.name} ---`);
      // attw treats every `exports` subpath as a code entry point and expects
      // type declarations behind it, so an asset export (a stylesheet) always
      // reports "resolution failed". Excluding them is correct rather than a
      // workaround: there is nothing for TypeScript to resolve, and publint
      // still checks that the subpath exists in the tarball.
      //
      // Derived from the package's own exports so a future asset export is
      // covered without editing this script.
      const assetEntrypoints = Object.keys(
        JSON.parse(readFileSync(join(pkg.path, 'package.json'), 'utf8'))
          .exports ?? {}
        // attw names entrypoints without the leading `./`.
      )
        .filter((subpath) => /\.(?:css|svg|png|woff2?)$/.test(subpath))
        .map((subpath) => subpath.replace(/^\.\//, ''));

      // All workspace packages currently ship ESM only (`"type": "module"`,
      // a single `import` export condition, no `require` entry point). The
      // esm-only profile stops attw from flagging the legacy CJS/node10
      // resolution modes these packages intentionally do not support.
      if (
        !tryRun('pnpm', [
          'exec',
          'attw',
          '--pack',
          '--profile',
          'esm-only',
          // The tarball goes before the flag: --exclude-entrypoints is
          // variadic and would otherwise swallow it as another entrypoint.
          tarball,
          ...(assetEntrypoints.length > 0
            ? ['--exclude-entrypoints', ...assetEntrypoints]
            : [])
        ])
      ) {
        failures.push(`attw failed for ${pkg.name}`);
      }
    }

    if (failures.length > 0) {
      for (const failure of failures) console.error(`FAIL: ${failure}`);
      throw new Error('publint/attw found packaging problems.');
    }

    // 4. Install the packed tarballs (not workspace links) into a clean
    // React 19/Vite fixture, build it, and smoke-test it in a browser.
    await runFixture(packages, tarballDir);
  } finally {
    rmSync(tarballDir, { recursive: true, force: true });
  }
}

async function runFixture(packages, tarballDir) {
  const fixtureDir = mkdtempSync(join(tmpdir(), 'reely-packaging-fixture-'));
  try {
    cpSync(fixtureTemplate, fixtureDir, { recursive: true });

    const manifestPath = join(fixtureDir, 'package.json');
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    manifest.dependencies ??= {};
    const tarballSpecs = {};
    for (const pkg of packages) {
      tarballSpecs[pkg.name] = `file:${join(
        tarballDir,
        tarballFileName(pkg.name, pkg.version)
      )}`;
    }
    Object.assign(manifest.dependencies, tarballSpecs);
    writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

    // Packages depend on each other by workspace name (e.g. @reely/react
    // depends on @reely/core). `pnpm pack` rewrites those to plain semver
    // ranges, which don't exist on the real registry. Force every internal
    // dependency, however deep, to resolve to the tarball being tested.
    const overridesYaml = [
      'overrides:',
      ...Object.entries(tarballSpecs).map(
        ([name, spec]) => `  ${JSON.stringify(name)}: ${JSON.stringify(spec)}`
      ),
      ''
    ].join('\n');
    writeFileSync(join(fixtureDir, 'pnpm-workspace.yaml'), overridesYaml);

    console.log('\n--- Installing packed tarballs into the fixture ---');
    run('pnpm', ['install', '--no-frozen-lockfile'], { cwd: fixtureDir });

    console.log('\n--- Building the fixture ---');
    run('pnpm', ['run', 'build'], { cwd: fixtureDir });

    console.log('\n--- Smoke-testing the fixture in a browser ---');
    await smokeTest(join(fixtureDir, 'dist'));
  } finally {
    rmSync(fixtureDir, { recursive: true, force: true });
  }
}

async function smokeTest(distDir) {
  const mime = {
    '.css': 'text/css',
    '.html': 'text/html',
    '.js': 'text/javascript',
    '.json': 'application/json'
  };
  const server = createServer(async (request, response) => {
    try {
      const requestUrl = new URL(request.url ?? '/', 'http://127.0.0.1');
      const pathname =
        requestUrl.pathname === '/' ? '/index.html' : requestUrl.pathname;
      const body = await readFile(join(distDir, pathname));
      response.writeHead(200, {
        'content-type': mime[extname(pathname)] ?? 'application/octet-stream'
      });
      response.end(body);
    } catch {
      response.writeHead(404);
      response.end();
    }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));

  let browser;
  try {
    const address = server.address();
    if (!address || typeof address === 'string') {
      throw new Error('Could not resolve fixture server address.');
    }
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    const pageErrors = [];
    page.on('pageerror', (error) => pageErrors.push(error));

    await page.goto(`http://127.0.0.1:${address.port}`);
    const media = page.locator('[data-reely-part="media"]');
    await media.waitFor();
    const source = await media.locator('source').getAttribute('src');
    if (source !== '/fixture.mp4') {
      throw new Error(
        `Expected the smoke player to request /fixture.mp4, got: ${source}`
      );
    }
    if (pageErrors.length > 0) {
      throw new Error(
        `The smoke player threw uncaught errors: ${pageErrors
          .map((error) => error.message)
          .join('; ')}`
      );
    }
  } finally {
    try {
      await browser?.close();
    } finally {
      await new Promise((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve()))
      );
    }
  }
}

try {
  await main();
} catch (error) {
  console.error(`\n${error.message}`);
  process.exit(1);
}
