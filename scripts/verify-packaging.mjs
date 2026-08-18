#!/usr/bin/env node
// Packaging correctness harness: builds and packs every publishable workspace
// package, lints each tarball with publint + attw, then installs the packed
// tarballs (not workspace links) into a clean React 19/Vite fixture, builds
// it, and smoke-tests the result in a real browser.
//
// New workspace packages are covered automatically: package discovery comes
// from scripts/workspace-packages.mjs, the single definition of "publishable"
// this repo has. Nothing here is hardcoded to today's package names.

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
import { publishablePackages } from './workspace-packages.mjs';

const console = globalThis.console;
const process = globalThis.process;

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const fixtureTemplate = join(repoRoot, 'tests/packaging/fixture');

/**
 * @typedef {import('./workspace-packages.mjs').PublishablePackage} PublishablePackage
 */

/**
 * @param {string} command
 * @param {readonly string[]} args
 * @param {import('node:child_process').ExecFileSyncOptions} [options]
 */
const run = (command, args, options = {}) =>
  execFileSync(command, args, {
    cwd: repoRoot,
    stdio: 'inherit',
    ...options
  });

/**
 * @param {string} command
 * @param {readonly string[]} args
 * @param {import('node:child_process').ExecFileSyncOptions} [options]
 */
const tryRun = (command, args, options = {}) => {
  try {
    run(command, args, options);
    return true;
  } catch {
    return false;
  }
};

/**
 * @param {string} name
 * @param {string} version
 */
const tarballFileName = (name, version) =>
  `${name.replace(/^@/, '').replace('/', '-')}-${version}.tgz`;

/** @param {string} tarball */
const tarballEntries = (tarball) =>
  execFileSync('tar', ['-tzf', tarball], { encoding: 'utf8' })
    .split('\n')
    .filter((entry) => entry !== '' && !entry.endsWith('/'))
    // Every entry in an npm tarball is under `package/`.
    .map((entry) => entry.replace(/^package\//, ''));

/**
 * @param {string} tarball
 * @param {string} entry
 */
const readTarballFile = (tarball, entry) =>
  execFileSync('tar', ['-xzOf', tarball, `package/${entry}`], {
    encoding: 'utf8'
  });

// What ships is what the `files` field lets through, and that is a coarser
// filter than it looks: `dist` sweeps up whatever else the build left in the
// directory. These are the two things a consumer should never receive.
/** @param {string} tarball */
const tarballProblems = (tarball) => {
  const entries = tarballEntries(tarball);
  /** @type {string[]} */
  const problems = [];

  // Incremental-build caches: TypeScript writes `.tsbuildinfo` beside the
  // declarations it emits, so `files: ["dist"]` publishes the build cache --
  // including the one belonging to the *test* program, which lists paths that
  // are not in the package at all.
  for (const entry of entries.filter((name) =>
    /(^|\/)\.tsbuildinfo/.test(name)
  )) {
    problems.push(`ships a build cache: ${entry}`);
  }

  // A source map has to be usable by whoever receives it. That means either it
  // carries its sources inline, or the files it points at are in the tarball --
  // a map that resolves to neither is a dangling pointer at the publisher's
  // working copy.
  for (const entry of entries.filter((name) => name.endsWith('.map'))) {
    const map =
      /** @type {{ sources?: string[]; sourcesContent?: unknown }} */ (
        JSON.parse(readTarballFile(tarball, entry))
      );
    const sources = map.sources ?? [];
    const inlined =
      Array.isArray(map.sourcesContent) &&
      map.sourcesContent.length === sources.length &&
      map.sourcesContent.every(
        (/** @type {unknown} */ content) => typeof content === 'string'
      );
    if (inlined) continue;
    const dir = entry.includes('/') ? entry.replace(/\/[^/]*$/, '') : '';
    const missing = sources.filter(
      (source) => !entries.includes(join(dir, source).replaceAll('\\', '/'))
    );
    if (missing.length > 0) {
      problems.push(
        `${entry} points at sources that are not in the tarball and does not inline them: ${missing.join(', ')}`
      );
    }
  }

  return problems;
};

async function main() {
  // 1. Discover every publishable (non-private) workspace package.
  const packages = publishablePackages(repoRoot);
  console.log(
    `Discovered ${packages.length} publishable package(s): ${packages
      .map((pkg) => pkg.name)
      .join(', ')}`
  );

  const tarballDir = mkdtempSync(
    join(tmpdir(), 'playdeck-packaging-tarballs-')
  );
  /** @type {string[]} */
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

      console.log(`\n--- tarball contents: ${pkg.name} ---`);
      const contentProblems = tarballProblems(tarball);
      for (const problem of contentProblems) {
        console.error(`${pkg.name} ${problem}`);
        failures.push(`${pkg.name} ${problem}`);
      }
      if (contentProblems.length === 0) console.log('ok');

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

/**
 * @param {readonly PublishablePackage[]} packages
 * @param {string} tarballDir
 */
async function runFixture(packages, tarballDir) {
  const fixtureDir = mkdtempSync(join(tmpdir(), 'playdeck-packaging-fixture-'));
  try {
    cpSync(fixtureTemplate, fixtureDir, { recursive: true });

    const manifestPath = join(fixtureDir, 'package.json');
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    manifest.dependencies ??= {};
    /** @type {Record<string, string>} */
    const tarballSpecs = {};
    for (const pkg of packages) {
      tarballSpecs[pkg.name] = `file:${join(
        tarballDir,
        tarballFileName(pkg.name, pkg.version)
      )}`;
    }
    Object.assign(manifest.dependencies, tarballSpecs);
    writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

    // Packages depend on each other by workspace name (e.g. @playdeck/react
    // depends on @playdeck/core). `pnpm pack` rewrites those to plain semver
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

/** @param {string} distDir */
async function smokeTest(distDir) {
  /** @type {Record<string, string>} */
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
  // `resolve` takes an argument, so passing it straight to `listen` matched the
  // (port, backlog, listener) overload rather than the (port, host, listener)
  // one -- which typechecked '127.0.0.1' as a backlog size.
  await new Promise((resolve) =>
    server.listen(0, '127.0.0.1', () => resolve(undefined))
  );

  /** @type {import('@playwright/test').Browser | undefined} */
  let browser;
  try {
    const address = server.address();
    if (!address || typeof address === 'string') {
      throw new Error('Could not resolve fixture server address.');
    }
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    /** @type {Error[]} */
    const pageErrors = [];
    page.on('pageerror', (error) => pageErrors.push(error));

    await page.goto(`http://127.0.0.1:${address.port}`);
    const media = page.locator('[data-playdeck-part="media"]');
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
        server.close((error) => (error ? reject(error) : resolve(undefined)))
      );
    }
  }
}

try {
  await main();
} catch (error) {
  // Not every throw is an Error -- a spawned tool that rejects with a string
  // used to print an empty line and exit 1 with no reason given.
  console.error(`\n${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
