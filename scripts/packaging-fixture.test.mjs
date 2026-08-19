import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath, URL } from 'node:url';
import { parse } from 'yaml';
import {
  fixtureWorkspaceYaml,
  reresolvedPackages
} from './packaging-fixture.mjs';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const rootWorkspaceYaml = readFileSync(
  join(repoRoot, 'pnpm-workspace.yaml'),
  'utf8'
);

// The fixture installs into an OS temp directory, so the root
// `pnpm-workspace.yaml` stops governing it -- that is the whole of #336. The
// synthesised file has to carry every setting the root one carries, and this
// asserts it key by key against the real file rather than against a list
// written out here: a floor added to the root tomorrow is covered without
// anyone remembering to edit this test.
test('carries every root workspace setting except the member globs', () => {
  const root = parse(rootWorkspaceYaml);
  const fixture = parse(fixtureWorkspaceYaml(rootWorkspaceYaml, {}));

  assert.equal(fixture.packages, undefined);
  for (const [key, value] of Object.entries(root)) {
    if (key === 'packages') continue;
    assert.deepEqual(fixture[key], value, key);
  }
});

// The tarball overrides go into the same `overrides:` mapping as the floors,
// which is the one merge in this file that can go wrong quietly: replacing the
// mapping rather than extending it would leave the fixture install unfloored
// and still pass every other assertion here.
test('adds the tarball overrides alongside the root advisory floors', () => {
  const specs = {
    '@playdeck/core': 'file:/tmp/playdeck-core-0.1.0.tgz',
    '@playdeck/react': 'file:/tmp/playdeck-react-0.1.0.tgz'
  };
  const fixture = parse(fixtureWorkspaceYaml(rootWorkspaceYaml, specs));

  assert.deepEqual(fixture.overrides, {
    ...parse(rootWorkspaceYaml).overrides,
    ...specs
  });
});

// A lockfile the fixture install quietly ignores is worse than no lockfile at
// all: the gate would read as pinned and re-resolve anyway. The install is
// `--no-frozen-lockfile` by necessity -- the `@playdeck/*` specs are `file:`
// paths into a per-run temp directory and carry the version under test, so no
// committed lockfile can ever satisfy `--frozen-lockfile` -- which leaves this
// comparison as the thing that proves the replay actually happened.
const lockfile = (/** @type {readonly string[]} */ keys) =>
  `lockfileVersion: '9.0'\n\npackages:\n\n${keys
    .map(
      (key) =>
        `  ${JSON.stringify(key)}:\n    resolution: {integrity: sha512-x}\n`
    )
    .join('\n')}`;

test('reports a locked package the install resolved to another version', () => {
  assert.deepEqual(
    reresolvedPackages(
      lockfile(['nanoid@3.3.17', '@vitejs/plugin-react@6.0.4']),
      lockfile(['nanoid@3.3.18', '@vitejs/plugin-react@6.0.4'])
    ),
    ['nanoid@3.3.18']
  );
});

// What the packed tarballs bring with them cannot be in a lockfile generated
// without the tarballs, so a name the committed lockfile never pinned is not a
// re-resolution. `@vimeo/player` and `hls.js` are exact-pinned in the packages'
// own manifests; `native-promise-only` and `weakmap-polyfill` arrive under
// `@vimeo/player` and are the residual gap.
test('ignores the packages the packed tarballs drag in', () => {
  assert.deepEqual(
    reresolvedPackages(
      lockfile(['react@19.2.8']),
      lockfile([
        'react@19.2.8',
        '@playdeck/react@file:../tarballs/playdeck-react-0.1.0.tgz',
        '@vimeo/player@2.30.4',
        'native-promise-only@0.8.1'
      ])
    ),
    []
  );
});

// A committed lockfile that went missing, or one truncated to a header, would
// otherwise make this check vacuous and report a clean run -- the same failure
// shape `parseAuditOutput` refuses in scripts/audit.mjs.
test('refuses a committed lockfile with no packages in it', () => {
  assert.throws(
    () =>
      reresolvedPackages(
        "lockfileVersion: '9.0'\n",
        lockfile(['react@19.2.8'])
      ),
    /committed lockfile/
  );
});

// The committed lockfile is what closes the first of #336's three gaps, and it
// is generated rather than written, so these assertions are about it still
// matching what generated it. `pnpm test:packages` would keep passing with a
// stale one -- the fixture install replays whatever it is given.
test('the fixture lockfile pins the fixture manifest under the root floors', () => {
  const manifest = JSON.parse(
    readFileSync(join(repoRoot, 'tests/packaging/fixture/package.json'), 'utf8')
  );
  const lock = parse(
    readFileSync(
      join(repoRoot, 'tests/packaging/fixture/pnpm-lock.yaml'),
      'utf8'
    )
  );

  // Generated with the root's advisory floors applied, not without them: a
  // lockfile resolved unfloored would pin the vulnerable version and then be
  // replayed faithfully.
  assert.deepEqual(lock.overrides, parse(rootWorkspaceYaml).overrides);

  const importer = lock.importers['.'];
  for (const [field, deps] of [
    ['dependencies', manifest.dependencies],
    ['devDependencies', manifest.devDependencies]
  ]) {
    for (const [name, specifier] of Object.entries(deps)) {
      assert.equal(importer[field]?.[name]?.specifier, specifier, name);
    }
  }

  // The four direct dependencies are exact-pinned in the manifest already.
  // What #336 is about is the closure under them, which floated free of every
  // lockfile in this repository.
  assert.ok(
    Object.keys(lock.packages).length > 20,
    `Expected the transitive closure, got ${Object.keys(lock.packages).length} package(s).`
  );
});

// The fixture install runs in an OS temp directory, so corepack resolves pnpm
// from the fixture's own manifest and nothing above it. Without this field it
// resolved to whatever pnpm is latest that day: pnpm 10.34.5 and pnpm 11.20.0
// happen to write the same lockfile for this fixture today, but a release that
// bumps `lockfileVersion` re-resolves the whole closure instead of replaying
// it, which would turn the pinning #336 asks for back into a fresh install.
test('the fixture pins the same pnpm the repository does', () => {
  const fixture = JSON.parse(
    readFileSync(join(repoRoot, 'tests/packaging/fixture/package.json'), 'utf8')
  );
  const root = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8'));

  assert.equal(fixture.packageManager, root.packageManager);
});
