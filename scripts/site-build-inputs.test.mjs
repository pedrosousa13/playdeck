import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath, URL } from 'node:url';

import {
  escapingImports,
  parseTurboJson,
  relativeImportSpecifiers,
  siteBuildInputGlobs,
  uncovered
} from './site-build-inputs.mjs';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));

// ---- relativeImportSpecifiers ----------------------------------------------

test('finds a named import, a side-effect import and a re-export, in one file', () => {
  const text = [
    "import { publishablePackages } from '../../../scripts/workspace-packages.mjs';",
    "import '../../styles/doc.css';",
    "export { guideDocument } from './guide-pages.mjs';"
  ].join('\n');
  assert.deepEqual(relativeImportSpecifiers(text), [
    '../../../scripts/workspace-packages.mjs',
    './guide-pages.mjs',
    '../../styles/doc.css'
  ]);
});

test('ignores a bare module specifier', () => {
  const text = [
    "import { getCollection } from 'astro:content';",
    "import react from '@playdeck/react';"
  ].join('\n');
  assert.deepEqual(relativeImportSpecifiers(text), []);
});

// ---- parseTurboJson / siteBuildInputGlobs ----------------------------------

test('drops a whole-line comment and parses the rest', () => {
  const text = [
    '{',
    '  "tasks": {',
    '    // a comment naming `../../examples/**`, never parsed as one',
    '    "@playdeck/site#build": { "inputs": ["$TURBO_DEFAULT$"] }',
    '  }',
    '}'
  ].join('\n');
  assert.deepEqual(parseTurboJson(text), {
    tasks: { '@playdeck/site#build': { inputs: ['$TURBO_DEFAULT$'] } }
  });
});

test('rewrites a package-relative glob to repository-relative, $TURBO_DEFAULT$ dropped', () => {
  const globs = siteBuildInputGlobs({
    tasks: {
      '@playdeck/site#build': {
        inputs: [
          '$TURBO_DEFAULT$',
          '../../examples/**',
          '../../packages/*/README.md'
        ]
      }
    }
  });
  assert.deepEqual(globs, ['examples/**', 'packages/*/README.md']);
});

test('throws on a task with no inputs array, naming the missing task', () => {
  assert.throws(
    () => siteBuildInputGlobs({ tasks: {} }),
    /@playdeck\/site#build.*inputs/
  );
});

// ---- uncovered --------------------------------------------------------------

test('a path no glob matches is reported; one a glob matches is not', () => {
  const globs = ['scripts/workspace-packages.mjs', 'packages/*/README.md'];
  assert.deepEqual(
    uncovered(
      [
        'scripts/workspace-packages.mjs',
        'packages/react/README.md',
        'scripts/readme-bytes.mjs'
      ],
      globs
    ),
    ['scripts/readme-bytes.mjs']
  );
});

test('"**" matches across a "/" and "*" does not', () => {
  assert.deepEqual(
    uncovered(
      ['docs/comparison/method.md', 'packages/react/dist/index.js'],
      ['docs/comparison/**', 'packages/*/README.md']
    ),
    ['packages/react/dist/index.js']
  );
});

// ---- against the real tree --------------------------------------------------
//
// #711's own regression, reproduced as an assertion rather than described:
// every relative import `apps/site/src` makes across its own boundary is one
// of `@playdeck/site#build`'s declared inputs. Falsified against the
// unfixed `turbo.json` below, rather than merely trusted to fail there.

test("every escaping import in apps/site is one of @playdeck/site#build's turbo.json inputs", () => {
  const turboJson = parseTurboJson(
    readFileSync(join(repoRoot, 'turbo.json'), 'utf8')
  );
  const globs = siteBuildInputGlobs(turboJson);
  const escapes = escapingImports(repoRoot);
  assert.deepEqual(
    uncovered(escapes, globs),
    [],
    'declare the path(s) above as input(s) of @playdeck/site#build in turbo.json'
  );
});
