#!/usr/bin/env node
// Packaging correctness harness: builds and packs every publishable workspace
// package, checks each tarball -- with publint, with attw, and against the
// rules `tarballProblems` below reads out of the tarball itself -- then
// installs the packed tarballs (not workspace links) into a clean React
// 19/Vite fixture, type-checks the fixture's sources against them under every
// resolution mode scripts/resolution-modes.mjs carries, builds it, and
// smoke-tests the result in a real browser.
//
// Each of those rules is stated where it is implemented rather than listed
// here, so adding one cannot leave this paragraph describing a gate that has
// moved on.
//
// New workspace packages are covered automatically: package discovery comes
// from scripts/workspace-packages.mjs, the single definition of "publishable"
// this repo has. Nothing here is hardcoded to today's package names.
//
// The fixture install is the one in this repository that runs outside the
// workspace, and #336 is the record of what that cost. It now replays
// tests/packaging/fixture/pnpm-lock.yaml under a copy of the root
// pnpm-workspace.yaml; `--update-fixture-lockfile` regenerates that lockfile
// and does nothing else.

import { chromium } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import {
  copyFileSync,
  cpSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync
} from 'node:fs';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { extname, join, posix } from 'node:path';
import { fileURLToPath, URL } from 'node:url';
import { guardProblems } from './esm-only-guard.mjs';
import {
  fixtureWorkspaceYaml,
  reresolvedPackages
} from './packaging-fixture.mjs';
import { resolutionModes, resolutionProblems } from './resolution-modes.mjs';
import { changelogProblems, shippedChangelog } from './shipped-changelog.mjs';
import { publishablePackages } from './workspace-packages.mjs';

const console = globalThis.console;
const process = globalThis.process;

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const fixtureTemplate = join(repoRoot, 'tests/packaging/fixture');
const fixtureLockfile = join(fixtureTemplate, 'pnpm-lock.yaml');

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

// The link targets a markdown source names, in the three forms these documents
// use: inline `](target)`, a reference definition (which CommonMark lets sit
// under up to three spaces of indentation, and one inside a list item is
// indented), and the `href`/`src` attributes of the raw HTML that is legal in
// markdown and that GitHub renders. Angle brackets are stripped, and a title
// after the target is left behind by stopping at the first space. Fenced code
// blocks are removed before any of that, so a link written as an example is not
// read as a link.
//
// What it does not see, stated rather than implied, because this gate is the
// only thing standing between a shipped README and an unreachable link: an
// inline target containing parentheses, and a reference definition whose target
// is written `<with spaces>`. What it over-reads: a target inside an inline
// code span, or inside a code block indented by four spaces rather than fenced.
/**
 * @param {string} source
 * @returns {string[]}
 */
const linkTargets = (source) => {
  // A fence opens on a run of three or more backticks or tildes and closes on
  // the next run of the same character, so the run itself is what pairs them.
  const prose = source.replace(
    /^ {0,3}(`{3,}|~{3,})[\s\S]*?^ {0,3}\1[^\n]*$/gm,
    ''
  );

  return [
    ...[...prose.matchAll(/\]\(\s*([^()\s]+)/g)],
    ...[...prose.matchAll(/^ {0,3}\[[^\]]+\]:\s*(\S+)/gm)],
    ...[...prose.matchAll(/\b(?:href|src)\s*=\s*["']?([^"'>\s]+)/gi)]
  ].map(([, target]) => target.replace(/^<|>$/g, ''));
};

// Where a link that names this repository by url has to resolve. The url is
// absolute, so the path after it is repo-relative and is checked against the
// working tree rather than against the tarball -- which is why this reaches for
// `repoRoot` in the middle of a function that is otherwise reading tarball
// entries. Nothing here touches the network: a url on any other host is not
// checked at all, and a broken one there is not something a local gate can see.
const repositoryBlobUrl = 'https://github.com/pedrosousa13/playdeck/blob/main/';

// A relative link resolves against wherever its file landed, and for a consumer
// that is `node_modules` rather than this repository. One that climbs out of the
// package root, or that names a path the tarball does not carry, resolves to
// nothing there. npmjs.com is where that breakage is invisible: npm's renderer
// rewrites relative links through `repository.directory`, so the package page
// keeps working while the installed file does not, and nobody reading the page
// learns anything is wrong. Shipped documents name the repository by url
// instead, which moves the risk from a link that cannot resolve to a path that
// might not exist -- so both are checked here.
/**
 * @param {string} entry
 * @param {string} source
 * @param {readonly string[]} entries
 */
const unreachableLinks = (entry, source, entries) => {
  const dir = entry.includes('/') ? entry.replace(/\/[^/]*$/, '') : '';
  /** @type {string[]} */
  const problems = [];

  for (const target of linkTargets(source)) {
    if (target.startsWith(repositoryBlobUrl)) {
      const path = target.slice(repositoryBlobUrl.length).replace(/#.*$/, '');
      if (!existsSync(join(repoRoot, path))) {
        problems.push(
          `${entry} links to ${target}, which is not a path in this repository`
        );
      }
      continue;
    }

    // A fragment, a scheme (`https:`, `mailto:`) and a protocol-relative url
    // are each resolved by something other than the file's own location.
    if (
      target.startsWith('#') ||
      target.startsWith('//') ||
      /^[a-z][a-z0-9+.-]*:/i.test(target)
    ) {
      continue;
    }
    const path = posix.normalize(
      posix.join(dir, target.replace(/[#?].*$/, ''))
    );
    if (path === '..' || path.startsWith('../')) {
      problems.push(`${entry} links to ${target}, which escapes the package`);
    } else if (
      !entries.includes(path) &&
      !entries.some((name) => name.startsWith(`${path}/`))
    ) {
      problems.push(`${entry} links to ${target}, which is not in the tarball`);
    }
  }

  return problems;
};

// What ships is what the `files` field lets through, and that is a coarser
// filter than it looks: `dist` sweeps up whatever else the build left in the
// directory. Most of these are things a consumer should never receive. The
// markdown link check is the one that looks at files `files` never mentions at
// all -- npm ships the README and the LICENSE whatever that field says --
// while the rules at the end run in the other direction, naming something the
// tarball has to carry rather than something it must not.
/**
 * @param {string} tarball
 * @param {string} version
 */
const tarballProblems = (tarball, version) => {
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

  // Every markdown document the tarball carries, which is the README plus
  // whatever `files` added, rather than a list of package names to keep true.
  for (const entry of entries.filter((name) => name.endsWith('.md'))) {
    problems.push(
      ...unreachableLinks(entry, readTarballFile(tarball, entry), entries)
    );
  }

  // The ESM-only guard, read out of the tarball rather than out of the working
  // tree. `files` decides what a consumer receives and it is a coarse filter,
  // so a guard that is present in the repository and absent from the install is
  // exactly the case worth catching -- the export map would then point a
  // CommonJS consumer at a file that is not there.
  problems.push(
    ...guardProblems(
      JSON.parse(readTarballFile(tarball, 'package.json')),
      (entry) =>
        entries.includes(entry) ? readTarballFile(tarball, entry) : undefined
    )
  );

  // The changelog, and that it describes the version being packed. See
  // scripts/shipped-changelog.mjs for the rule and for why a heading rather
  // than a mention. The version comes from the caller's manifest entry rather
  // than from the tarball's own package.json, because the version this run is
  // packing is what the rest of the harness is checking against.
  problems.push(...changelogProblems(shippedChangelog(tarball), version));

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
      const contentProblems = tarballProblems(tarball, pkg.version);
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

      // These packages ship ESM only, and the esm-only profile stops attw from
      // reporting the legacy resolution modes they intentionally do not
      // support: `node10`, which ignores export maps entirely so nothing
      // written into one can reach it, and `node16-cjs`.
      //
      // What the `node16-cjs` mute covers changed when the `require` condition
      // landed, and the change is worth stating rather than inheriting. attw
      // resolves that condition, reaches the guard, and calls the resolution a
      // success: `node16 (from CJS) 🟢 (CJS)` for @playdeck/core under attw
      // 0.18.5, where the same package with an ESM-only map and no `require`
      // condition gave `⚠️ ESM (dynamic import only)`. So the profile is no
      // longer hiding a real problem on that row. It is hiding a green attw
      // has no way to see through, because resolving is all attw checks and
      // the file it resolved to throws on load.
      //
      // Nothing here leans on attw to keep that condition pointed at the
      // guard, which is why the green costs nothing. `tarballProblems` above
      // deep-equals the `require` condition against scripts/esm-only-guard.mjs
      // out of the packed tarball, and scripts/esm-only-guard.test.mjs
      // resolves and `require()`s every package on the running Node -- a map
      // that sent a CommonJS consumer to `dist` fails both of those.
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

// The fixture is copied out of the repository, so the root
// `pnpm-workspace.yaml` stops governing it -- no advisory floors, no
// `minimumReleaseAge` cooldown, none of its exclusions. This puts the root file
// itself in the temp directory, minus the member globs and plus the tarball
// overrides, so the one install that then executes what it resolved is held to
// the same rules as every other install here. See #336, and
// scripts/packaging-fixture.mjs for why it is derived rather than transcribed.
/**
 * @param {string} fixtureDir
 * @param {Readonly<Record<string, string>>} tarballSpecs
 */
const writeFixtureWorkspace = (fixtureDir, tarballSpecs) =>
  writeFileSync(
    join(fixtureDir, 'pnpm-workspace.yaml'),
    fixtureWorkspaceYaml(
      readFileSync(join(repoRoot, 'pnpm-workspace.yaml'), 'utf8'),
      tarballSpecs
    )
  );

// Regenerates `tests/packaging/fixture/pnpm-lock.yaml` from the fixture's own
// manifest, under the same synthesised workspace file the verification run
// uses -- so the versions it pins are the ones the advisory floors and the
// cooldown allow, and a lockfile resolved unfloored is never what gets
// replayed. Run it after changing the fixture's dependencies, or after a root
// floor moves one of them; delete the lockfile first to re-resolve the whole
// closure rather than only what the manifest changed.
//
// The `@playdeck/*` tarballs are deliberately absent: their specs are per-run
// temp paths, so anything they pin would be stale the moment it was written.
function updateFixtureLockfile() {
  const fixtureDir = mkdtempSync(join(tmpdir(), 'playdeck-packaging-lock-'));
  try {
    cpSync(fixtureTemplate, fixtureDir, { recursive: true });
    writeFixtureWorkspace(fixtureDir, {});
    run('pnpm', ['install', '--lockfile-only'], { cwd: fixtureDir });
    copyFileSync(join(fixtureDir, 'pnpm-lock.yaml'), fixtureLockfile);
    console.log(`\nWrote ${fixtureLockfile}`);
  } finally {
    rmSync(fixtureDir, { recursive: true, force: true });
  }
}

// The question `vite build` below never asks. A bundler resolves and
// transpiles; it never asks the compiler whether the shipped declarations
// satisfy a consumer, and the answer to that is decided by a setting the
// consumer owns rather than by anything in the tarball. scripts/resolution-
// modes.mjs holds the settings and what each one owes, and it is also what
// scripts/esm-only-guard.test.mjs runs -- so the set is one edit, and the two
// gates cannot come to disagree about which modes are claimed.
//
// The compiler is invoked from this repository's own node_modules, so the
// TypeScript version this gate reports on is the one the repo pins and the
// fixture's dependencies decide nothing about it. What it reads is the
// fixture's own sources against the fixture's own node_modules, and that is the
// packed tarballs. The modes that turn on the consumer manifest's `type` need
// it to be `module`, which the fixture manifest already declares; a fixture that
// stopped declaring it fails those modes rather than skipping them, because an
// ESM-only package resolved from a CommonJS consumer lands on the guard.
/**
 * @param {string} fixtureDir
 * @param {readonly string[]} packageNames
 */
const typecheckProblems = (fixtureDir, packageNames) => {
  // Every publishable package imported by name, written here rather than
  // committed to the fixture, so a package that starts shipping tomorrow is
  // covered without this file learning its name. `src/main.tsx` beside it is
  // the shaped half: it drives the API a consumer drives, through the JSX and
  // the stylesheet subpath the README hands them.
  writeFileSync(
    join(fixtureDir, 'src/publishable-packages.ts'),
    packageNames
      .map((name, index) => `import * as playdeck${index} from '${name}';\n`)
      .join('')
  );

  /** @type {Record<string, import('./resolution-modes.mjs').TypecheckResult>} */
  const results = {};
  for (const [mode, { compilerOptions, unsupported }] of Object.entries(
    resolutionModes
  )) {
    // A consumer changes their resolution setting and keeps the rest of their
    // configuration, so each mode is the fixture's own tsconfig with that one
    // group supplied rather than a configuration of this harness's design. The
    // fixture leaves that group unset for exactly this reason; a value there
    // would be overridden here and stand as a second, dead copy of the table.
    const config = join(fixtureDir, `tsconfig.${mode}.json`);
    writeFileSync(
      config,
      JSON.stringify({ extends: './tsconfig.json', compilerOptions }, null, 2)
    );

    // Labelled with what the mode owes, so the diagnostics an unsupported mode
    // is supposed to produce do not read as a failing run.
    console.log(`\n--- tsc: ${mode}${unsupported ? ' (must fail) ' : ' '}---`);
    results[mode] = tsc(config);
    console.log(results[mode].output || 'ok');
  }

  return resolutionProblems(packageNames, results);
};

/**
 * @param {string} config
 * @returns {import('./resolution-modes.mjs').TypecheckResult}
 */
const tsc = (config) => {
  try {
    execFileSync(join(repoRoot, 'node_modules/.bin/tsc'), ['-p', config], {
      encoding: 'utf8'
    });
    return { status: 0, output: '' };
  } catch (error) {
    // tsc reports diagnostics on stdout and exits non-zero, so the output is
    // the finding rather than the exit code.
    const failed = /** @type {{ status: number; stdout: string }} */ (
      /** @type {unknown} */ (error)
    );
    return { status: failed.status, output: failed.stdout };
  }
};

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

    writeFixtureWorkspace(fixtureDir, tarballSpecs);

    console.log('\n--- Installing packed tarballs into the fixture ---');
    // `--no-frozen-lockfile` is a necessity, not a convenience: the
    // `@playdeck/*` specs above are `file:` paths into a per-run temp directory
    // and carry the version under test, so no committed lockfile can satisfy
    // `--frozen-lockfile` exactly. Everything else is replayed from
    // `tests/packaging/fixture/pnpm-lock.yaml`, and the check below is what
    // proves it rather than assuming it.
    run('pnpm', ['install', '--no-frozen-lockfile'], { cwd: fixtureDir });

    const reresolved = reresolvedPackages(
      readFileSync(fixtureLockfile, 'utf8'),
      readFileSync(join(fixtureDir, 'pnpm-lock.yaml'), 'utf8')
    );
    if (reresolved.length > 0) {
      throw new Error(
        `The fixture install did not replay ${fixtureLockfile}. It resolved:\n` +
          `${reresolved.map((entry) => `  ${entry}`).join('\n')}\n` +
          'Either the fixture manifest changed without the lockfile being ' +
          'regenerated (node scripts/verify-packaging.mjs ' +
          '--update-fixture-lockfile), or pnpm stopped replaying it.'
      );
    }

    console.log('\n--- Type-checking the fixture against the tarballs ---');
    const resolutionFailures = typecheckProblems(
      fixtureDir,
      packages.map((pkg) => pkg.name)
    );
    if (resolutionFailures.length > 0) {
      throw new Error(
        'The packed artifacts did not resolve the way a consumer resolves ' +
          `them:\n${resolutionFailures.map((problem) => `  ${problem}`).join('\n')}`
      );
    }

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

    // The stylesheet subpath, end to end. The fixture imports it by the
    // specifier the README hands consumers, so the bundler had to reach it
    // through the installed package's export map -- a subpath `files` and
    // `exports` disagreed about fails the build before this runs. What is left
    // to establish is that what arrived is the theme, and the fixture's markup
    // sets `--playdeck-color-on-surface` above the player so this can read it
    // back. Reading a token the fixture set, rather than a shipped default,
    // keeps an empty or truncated stylesheet failing here while a change to the
    // theme's own palette does not.
    //
    // What this depends on, and the way it can go inert: nothing but theme.css
    // may declare a property that consults that token on the viewport. A
    // primitive that starts reading it inline -- which ADR-0001 blesses, and
    // `PosterImage` already does for `--playdeck-poster-fit` -- would colour
    // the element with no stylesheet present, and this check would pass on a
    // run where nothing arrived. Whoever tokenises that property has to move
    // this check to one theme.css alone still owns.
    const themedColor = await page
      .locator('[data-playdeck-part="viewport"]')
      .evaluate(
        (/** @type {Element} */ element) =>
          globalThis.getComputedStyle(element).color
      );
    if (themedColor !== 'rgb(1, 2, 3)') {
      throw new Error(
        '@playdeck/react/theme.css did not reach the page: the viewport ' +
          `should read its colour from the token the fixture sets, got ${themedColor}.`
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
  if (process.argv.includes('--update-fixture-lockfile')) {
    updateFixtureLockfile();
  } else {
    await main();
  }
} catch (error) {
  // Not every throw is an Error -- a spawned tool that rejects with a string
  // used to print an empty line and exit 1 with no reason given.
  console.error(`\n${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
