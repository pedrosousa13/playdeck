import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath, URL } from 'node:url';
import { clientBoundaryProblems } from './client-boundary.mjs';
import { publishablePackages } from './workspace-packages.mjs';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));

// The manifests are the shapes these packages actually publish, trimmed to the
// fields the rule reads: a React package with the ESM-only guard's two nested
// conditions, and a framework-neutral one beside it. Written out here rather
// than read off the repository, because what is under test is the judgement
// and not today's manifests -- scripts/verify-packaging.mjs runs the same
// function over the packed tarballs, which is where the real ones are held to
// it.
const reactManifest = {
  name: '@playdeck/react',
  peerDependencies: { react: '>=19 <20', 'react-dom': '>=19 <20' },
  exports: {
    '.': {
      import: { types: './dist/index.d.ts', default: './dist/index.js' },
      require: { types: './esm-only.d.cts', default: './esm-only.cjs' }
    }
  }
};

const neutralManifest = {
  name: '@playdeck/core',
  exports: {
    '.': {
      import: { types: './dist/index.d.ts', default: './dist/index.js' },
      require: { types: './esm-only.d.cts', default: './esm-only.cjs' }
    }
  }
};

/**
 * A package whose only readable file is the one the `import` condition points
 * at. Passing `undefined` is the package that ships no such file, which is
 * what a `files` field or an `exports` map that stopped agreeing with the build
 * looks like from here.
 * @param {string | undefined} entry
 * @returns {(name: string) => string | undefined}
 */
const shipping = (entry) => (name) =>
  name === 'dist/index.js' ? entry : undefined;

const bundle = 'import { useState as e } from "react";\nexport { e };\n';

test('reports a React package whose entry does not open with the directive', () => {
  assert.deepEqual(clientBoundaryProblems(reactManifest, shipping(bundle)), [
    "names react as a peer dependency, and dist/index.js does not open with a 'use client' directive, so a React Server Component importing this package fails to build"
  ]);
});

test('accepts a React package whose entry opens with the directive', () => {
  assert.deepEqual(
    clientBoundaryProblems(reactManifest, shipping(`"use client";\n${bundle}`)),
    []
  );
});

// The scoping, and the half of the rule with no visible effect when it is
// working: @playdeck/core and the provider packages import no React API, so a
// directive on them would push framework-neutral code across a boundary and
// stop server code calling them at all. A rule that reached every package
// would still pass every other assertion in this file.
test('leaves a package that does not build on React alone', () => {
  assert.deepEqual(
    clientBoundaryProblems(neutralManifest, shipping(bundle)),
    []
  );
  assert.deepEqual(
    clientBoundaryProblems(
      { ...neutralManifest, peerDependencies: { 'hls.js': '^1' } },
      shipping(bundle)
    ),
    []
  );
});

// A directive keeps its meaning behind comments and blank lines, and a bundler
// is free to emit either above it -- a banner, a license header, a sourcemap
// comment. Accepting those is deliberate rather than incidental, so tightening
// the match to the first character of the file has to fail here.
test('accepts a directive behind comments and blank lines', () => {
  for (const prologue of [
    '// @playdeck/react\n',
    '/* @playdeck/react */\n\n',
    '\n\n',
    '/*\n * a banner\n */\n// and a line comment\n\n'
  ]) {
    assert.deepEqual(
      clientBoundaryProblems(
        reactManifest,
        shipping(`${prologue}"use client";\n${bundle}`)
      ),
      [],
      prologue
    );
  }
});

// A directive is only a directive in the prologue. Anywhere after the first
// statement it is an ordinary string expression that no bundler acts on, and
// it is indistinguishable from the real thing to anything that searches the
// file rather than anchoring at the top -- so a chunk that demoted it would
// pass a looser rule while failing in a consumer's build.
test('does not accept a directive that is not the leading statement', () => {
  assert.equal(
    clientBoundaryProblems(reactManifest, shipping(`${bundle}"use client";\n`))
      .length,
    1
  );
  assert.equal(
    clientBoundaryProblems(
      reactManifest,
      shipping(`const banner = "x";\n"use client";\n${bundle}`)
    ).length,
    1
  );
});

// The file read is the one the `import` condition names, so a map pointed at
// something the package does not ship reports the missing file rather than
// reporting nothing. Silence there would be the worst answer available: the
// directive would be present in the repository, absent from the install, and
// the gate would say the boundary was declared.
test('reports an import entry the package does not ship', () => {
  assert.deepEqual(clientBoundaryProblems(reactManifest, shipping(undefined)), [
    'names react as a peer dependency, and its import entry ./dist/index.js is not in the tarball'
  ]);
});

test('reports an exports map with no import entry at all', () => {
  assert.deepEqual(
    clientBoundaryProblems(
      { ...reactManifest, exports: { './theme.css': './theme.css' } },
      shipping(bundle)
    ),
    [
      'names react as a peer dependency, and its exports "." has no import entry for the directive to sit on'
    ]
  );
});

// The rule scopes itself, which is what makes it silently disableable: drop
// `peerDependencies.react` from a manifest and every case above still passes
// while the real package stops being checked at all. So this asserts the
// scoping catches something, not only that nothing it caught is wrong. The
// ESM-only guard's own suite holds its rule against the real manifests for the
// same reason.
test('the rule covers a package this repository actually publishes', () => {
  const covered = publishablePackages(repoRoot).filter(
    (pkg) =>
      JSON.parse(readFileSync(join(pkg.path, 'package.json'), 'utf8'))
        .peerDependencies?.react !== undefined
  );
  assert.notDeepEqual(covered, []);
});

test('every publishable package satisfies the rule', () => {
  for (const pkg of publishablePackages(repoRoot)) {
    const manifest = JSON.parse(
      readFileSync(join(pkg.path, 'package.json'), 'utf8')
    );
    assert.deepEqual(
      clientBoundaryProblems(manifest, (entry) => {
        try {
          return readFileSync(join(pkg.path, entry), 'utf8');
        } catch {
          return undefined;
        }
      }),
      [],
      pkg.name
    );
  }
});
