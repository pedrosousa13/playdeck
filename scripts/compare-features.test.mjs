import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import process from 'node:process';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  describeAnchor,
  describePlugin,
  evaluateAnchor,
  footnoteNumbers,
  globToRegExp,
  matchingFiles,
  maskVolatile,
  packageRoot,
  renderFeaturesDoc,
  renderFootnotes,
  renderTable,
  resolveExport,
  resolveForNode,
  verifyAllAnchors
} from './compare-features.mjs';

const scriptsDir = dirname(fileURLToPath(import.meta.url));

// Deliberately not the real installs: this file runs in the `static` CI job,
// which never installs `tests/compare`'s pinned libraries or builds
// `@playdeck/react`, and a fixture that has to be re-typed whenever a
// compared library's own file layout moves would be the same rot one level
// down. Every test below builds a tiny fake package tree under a temp
// directory shaped like this repository -- `<tmp>/packages/<name>` for a
// `@playdeck/*` module, `<tmp>/fixture/node_modules/<name>` for everything
// else -- and points `packageRoot`/`resolveExport`/`evaluateAnchor` at it
// through the `roots` parameter those three accept for exactly this reason.

/** @param {string} path @param {unknown} data */
const writeJson = (path, data) => writeFile(path, JSON.stringify(data));

/**
 * A fresh temp directory with `packages/` and `fixture/node_modules/`
 * already made, and the `roots` object that points there.
 */
const makeRoots = async () => {
  const dir = await mkdtemp(join(tmpdir(), 'compare-features-'));
  const repoRoot = join(dir, 'repo');
  const fixtureRoot = join(dir, 'fixture');
  await mkdir(join(repoRoot, 'packages'), { recursive: true });
  await mkdir(join(fixtureRoot, 'node_modules'), { recursive: true });
  return { dir, roots: { repoRoot, fixtureRoot } };
};

// ---- packageRoot ------------------------------------------------------------

test('resolves a @playdeck/* module under packages/, not node_modules', async () => {
  const { dir, roots } = await makeRoots();
  try {
    assert.equal(
      packageRoot('@playdeck/react', roots),
      join(roots.repoRoot, 'packages/react')
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('resolves an ordinary module under the fixture node_modules', async () => {
  const { dir, roots } = await makeRoots();
  try {
    assert.equal(
      packageRoot('video.js', roots),
      join(roots.fixtureRoot, 'node_modules/video.js')
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("resolves a scoped module's subpath to the same root as its bare package", async () => {
  const { dir, roots } = await makeRoots();
  try {
    assert.equal(
      packageRoot('@vidstack/react/player/layouts/default', roots),
      packageRoot('@vidstack/react', roots)
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

// ---- resolveExport -----------------------------------------------------------

test('resolves the bare package through a string "." export', async () => {
  const { dir, roots } = await makeRoots();
  try {
    const root = join(roots.fixtureRoot, 'node_modules/plain');
    await mkdir(root, { recursive: true });
    await writeJson(join(root, 'package.json'), {
      exports: { '.': './index.js' }
    });
    assert.equal(await resolveExport('plain', roots), join(root, 'index.js'));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('prefers the "import" condition over "default" and "require"', async () => {
  const { dir, roots } = await makeRoots();
  try {
    const root = join(roots.fixtureRoot, 'node_modules/dual');
    await mkdir(root, { recursive: true });
    await writeJson(join(root, 'package.json'), {
      exports: {
        '.': {
          require: './cjs.js',
          import: './esm.js',
          default: './fallback.js'
        }
      }
    });
    assert.equal(await resolveExport('dual', roots), join(root, 'esm.js'));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("recurses into a nested condition object, as @playdeck/react's does", async () => {
  const { dir, roots } = await makeRoots();
  try {
    const root = join(roots.repoRoot, 'packages/react');
    await mkdir(root, { recursive: true });
    await writeJson(join(root, 'package.json'), {
      exports: {
        '.': {
          import: { types: './index.d.ts', default: './index.js' },
          require: { types: './esm-only.d.cts', default: './esm-only.cjs' }
        }
      }
    });
    assert.equal(
      await resolveExport('@playdeck/react', roots),
      join(root, 'index.js')
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('resolves a subpath through a matching wildcard pattern', async () => {
  const { dir, roots } = await makeRoots();
  try {
    const root = join(roots.fixtureRoot, 'node_modules/wild');
    await mkdir(root, { recursive: true });
    await writeJson(join(root, 'package.json'), {
      exports: { './*': { import: './dist/*.js' } }
    });
    assert.equal(
      await resolveExport('wild/react/menu', roots),
      join(root, 'dist/react/menu.js')
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('falls back to "module" when a package has no exports map at all', async () => {
  const { dir, roots } = await makeRoots();
  try {
    const root = join(roots.fixtureRoot, 'node_modules/legacy');
    await mkdir(root, { recursive: true });
    await writeJson(join(root, 'package.json'), {
      main: './dist/legacy.cjs.js',
      module: './dist/legacy.es.js'
    });
    assert.equal(
      await resolveExport('legacy', roots),
      join(root, 'dist/legacy.es.js')
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('refuses a subpath on a package with no exports map', async () => {
  const { dir, roots } = await makeRoots();
  try {
    const root = join(roots.fixtureRoot, 'node_modules/legacy');
    await mkdir(root, { recursive: true });
    await writeJson(join(root, 'package.json'), { main: './dist/legacy.js' });
    await assert.rejects(
      () => resolveExport('legacy/sub', roots),
      /no "exports" map/
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

// ---- evaluateAnchor ----------------------------------------------------------

test('export anchor holds when the resolved module exports that name', async () => {
  const { dir, roots } = await makeRoots();
  try {
    const root = join(roots.fixtureRoot, 'node_modules/has-export');
    await mkdir(root, { recursive: true });
    await writeJson(join(root, 'package.json'), {
      exports: { '.': './index.js' }
    });
    await writeFile(join(root, 'index.js'), 'export const Widget = 1;\n');
    const result = await evaluateAnchor(
      { kind: 'export', module: 'has-export', name: 'Widget' },
      roots
    );
    assert.equal(result.holds, true);
    assert.match(result.detail, /exports `Widget`/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('export anchor does not hold when the export is missing', async () => {
  const { dir, roots } = await makeRoots();
  try {
    const root = join(roots.fixtureRoot, 'node_modules/no-export');
    await mkdir(root, { recursive: true });
    await writeJson(join(root, 'package.json'), {
      exports: { '.': './index.js' }
    });
    await writeFile(join(root, 'index.js'), 'export const Other = 1;\n');
    const result = await evaluateAnchor(
      { kind: 'export', module: 'no-export', name: 'Widget' },
      roots
    );
    assert.equal(result.holds, false);
    assert.match(result.detail, /does not export `Widget`/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('file and types anchors check literal inclusion in the named file', async () => {
  const { dir, roots } = await makeRoots();
  try {
    const root = join(roots.fixtureRoot, 'node_modules/has-file');
    await mkdir(root, { recursive: true });
    await writeFile(join(root, 'dist.js'), 'registerComponent("Chapters")\n');
    const present = await evaluateAnchor(
      {
        kind: 'file',
        module: 'has-file',
        path: 'dist.js',
        includes: 'Chapters'
      },
      roots
    );
    assert.equal(present.holds, true);
    const absent = await evaluateAnchor(
      {
        kind: 'types',
        module: 'has-file',
        path: 'dist.js',
        includes: 'Playlist'
      },
      roots
    );
    assert.equal(absent.holds, false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('package anchor holds when the dotted field resolves to a value', async () => {
  const { dir, roots } = await makeRoots();
  try {
    const root = join(roots.fixtureRoot, 'node_modules/has-field');
    await mkdir(root, { recursive: true });
    await writeJson(join(root, 'package.json'), {
      peerDependencies: { react: '^18 || ^19' }
    });
    const result = await evaluateAnchor(
      { kind: 'package', module: 'has-field', field: 'peerDependencies.react' },
      roots
    );
    assert.equal(result.holds, true);
    assert.match(result.detail, /\^18 \|\| \^19/);

    const missing = await evaluateAnchor(
      { kind: 'package', module: 'has-field', field: 'peerDependencies.vue' },
      roots
    );
    assert.equal(missing.holds, false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('absent-by-field holds only when the dotted field is undefined', async () => {
  const { dir, roots } = await makeRoots();
  try {
    const root = join(roots.fixtureRoot, 'node_modules/maybe-field');
    await mkdir(root, { recursive: true });
    await writeJson(join(root, 'package.json'), { style: './x.css' });
    const hasStyle = await evaluateAnchor(
      { kind: 'absent', module: 'maybe-field', field: 'style' },
      roots
    );
    assert.equal(hasStyle.holds, false);
    const noPeer = await evaluateAnchor(
      {
        kind: 'absent',
        module: 'maybe-field',
        field: 'peerDependencies.react'
      },
      roots
    );
    assert.equal(noPeer.holds, true);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('absent-in-tree holds only when no matched file contains the literal', async () => {
  const { dir, roots } = await makeRoots();
  try {
    const root = join(roots.fixtureRoot, 'node_modules/maybe-text');
    await mkdir(join(root, 'dist/nested'), { recursive: true });
    await writeFile(join(root, 'dist/one.js'), 'export const A = 1;\n');
    await writeFile(
      join(root, 'dist/nested/two.js'),
      'export const AirplayButton = 1;\n'
    );
    const present = await evaluateAnchor(
      {
        kind: 'absent-in-tree',
        module: 'maybe-text',
        glob: 'dist/**/*.js',
        includes: 'AirplayButton'
      },
      roots
    );
    assert.equal(present.holds, false);
    // The failure names the file the token was found in, not just that it
    // was: a `no` that stops holding has to be actionable.
    assert.match(present.detail, /dist\/nested\/two\.js/);
    const absent = await evaluateAnchor(
      {
        kind: 'absent-in-tree',
        module: 'maybe-text',
        glob: 'dist/**/*.js',
        includes: 'ChromecastButton'
      },
      roots
    );
    assert.equal(absent.holds, true);
    assert.match(absent.detail, /2 files/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('absent-in-tree searches every module it is given', async () => {
  const { dir, roots } = await makeRoots();
  try {
    const first = join(roots.repoRoot, 'packages/core/dist');
    const second = join(roots.repoRoot, 'packages/react/dist');
    await mkdir(first, { recursive: true });
    await mkdir(second, { recursive: true });
    await writeFile(join(first, 'index.js'), 'export const A = 1;\n');
    await writeFile(join(second, 'index.js'), 'export const Cast = 1;\n');
    const result = await evaluateAnchor(
      {
        kind: 'absent-in-tree',
        module: ['@playdeck/core', '@playdeck/react'],
        glob: '**/*.js',
        includes: 'Cast'
      },
      roots
    );
    assert.equal(result.holds, false);
    assert.match(result.detail, /@playdeck\/react/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('absent-in-tree with no glob match throws rather than holding vacuously', async () => {
  const { dir, roots } = await makeRoots();
  try {
    const root = join(roots.fixtureRoot, 'node_modules/empty-tree');
    await mkdir(root, { recursive: true });
    await writeFile(join(root, 'README.md'), 'nothing here\n');
    await assert.rejects(
      () =>
        evaluateAnchor(
          {
            kind: 'absent-in-tree',
            module: 'empty-tree',
            glob: 'dist/**/*.js',
            includes: 'Anything'
          },
          roots
        ),
      /absence nobody searched for/
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('absent-in-tree with no `includes` claims the glob matches nothing', async () => {
  const { dir, roots } = await makeRoots();
  try {
    const root = join(roots.fixtureRoot, 'node_modules/no-css');
    await mkdir(join(root, 'dist'), { recursive: true });
    await writeFile(join(root, 'dist/index.js'), 'export const A = 1;\n');
    const noStylesheet = await evaluateAnchor(
      { kind: 'absent-in-tree', module: 'no-css', glob: '**/*.css' },
      roots
    );
    assert.equal(noStylesheet.holds, true);
    await writeFile(join(root, 'dist/theme.css'), ':root{}\n');
    const nowHasOne = await evaluateAnchor(
      { kind: 'absent-in-tree', module: 'no-css', glob: '**/*.css' },
      roots
    );
    assert.equal(nowHasOne.holds, false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('imports-in-node holds on the expected outcome, either way', async () => {
  const { dir, roots } = await makeRoots();
  try {
    const loads = join(roots.fixtureRoot, 'node_modules/loads');
    await mkdir(loads, { recursive: true });
    await writeJson(join(loads, 'package.json'), {
      type: 'module',
      main: './index.js'
    });
    await writeFile(join(loads, 'index.js'), 'export const A = 1;\n');
    const ok = await evaluateAnchor(
      { kind: 'imports-in-node', module: 'loads', expect: 'imports' },
      roots
    );
    assert.equal(ok.holds, true);

    const breaks = join(roots.fixtureRoot, 'node_modules/breaks');
    await mkdir(breaks, { recursive: true });
    await writeJson(join(breaks, 'package.json'), {
      type: 'module',
      main: './index.js'
    });
    await writeFile(
      join(breaks, 'index.js'),
      'export const A = document.title;\n'
    );
    const threw = await evaluateAnchor(
      { kind: 'imports-in-node', module: 'breaks', expect: 'imports' },
      roots
    );
    assert.equal(threw.holds, false);
    assert.match(threw.detail, /throws when imported in plain Node/);
    const expectedToThrow = await evaluateAnchor(
      { kind: 'imports-in-node', module: 'breaks', expect: 'throws' },
      roots
    );
    assert.equal(expectedToThrow.holds, true);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

// ---- globToRegExp and matchingFiles -------------------------------------------

test('globToRegExp gives `*` one segment and `**/` any number', () => {
  assert.equal(globToRegExp('dist/**/*.js').test('dist/index.js'), true);
  assert.equal(globToRegExp('dist/**/*.js').test('dist/a/b/index.js'), true);
  assert.equal(globToRegExp('dist/**/*.js').test('dist/index.d.ts'), false);
  assert.equal(globToRegExp('dist/*.js').test('dist/a/index.js'), false);
  // A `.` in the pattern is a literal, not "any character".
  assert.equal(globToRegExp('**/*.d.ts').test('types/xdxts'), false);
});

test('matchingFiles walks the tree and never descends node_modules', async () => {
  const { dir } = await makeRoots();
  try {
    const root = join(dir, 'tree');
    await mkdir(join(root, 'dist/deep'), { recursive: true });
    await mkdir(join(root, 'node_modules/inner'), { recursive: true });
    await writeFile(join(root, 'dist/a.js'), '');
    await writeFile(join(root, 'dist/deep/b.js'), '');
    await writeFile(join(root, 'dist/deep/c.css'), '');
    await writeFile(join(root, 'node_modules/inner/d.js'), '');
    assert.deepEqual(await matchingFiles(root, ['**/*.js']), [
      'dist/a.js',
      'dist/deep/b.js'
    ]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

// ---- resolveForNode ------------------------------------------------------------

test('resolveForNode falls back to "main", never to "module"', async () => {
  const { dir, roots } = await makeRoots();
  try {
    const root = join(roots.fixtureRoot, 'node_modules/dual');
    await mkdir(root, { recursive: true });
    await writeJson(join(root, 'package.json'), {
      module: './dist/esm.js',
      main: './dist/cjs.js'
    });
    assert.equal(
      await resolveExport('dual', roots),
      join(root, './dist/esm.js')
    );
    assert.equal(
      await resolveForNode('dual', roots),
      join(root, './dist/cjs.js')
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

// ---- verifyAllAnchors ---------------------------------------------------------

test('verifyAllAnchors names every failing axis and library, not just the first', async () => {
  const { dir, roots } = await makeRoots();
  try {
    const root = join(roots.fixtureRoot, 'node_modules/lib');
    await mkdir(root, { recursive: true });
    await writeFile(join(root, 'dist.js'), 'export const Real = 1;\n');
    const axes = [
      {
        id: 'axis-a',
        label: 'Axis A',
        entries: {
          One: {
            status: /** @type {const} */ ('no'),
            anchor: /** @type {const} */ ({
              kind: 'absent-in-tree',
              module: 'lib',
              glob: '**/*.js',
              includes: 'Real'
            }),
            source: 'x'
          },
          Two: {
            status: /** @type {const} */ ('no'),
            anchor: /** @type {const} */ ({
              kind: 'absent-in-tree',
              module: 'lib',
              glob: '**/*.js',
              includes: 'Fake'
            }),
            source: 'x'
          }
        }
      }
    ];
    await assert.rejects(
      () => verifyAllAnchors(axes, [{ name: 'One' }, { name: 'Two' }], roots),
      (error) => {
        assert.ok(error instanceof Error);
        assert.match(error.message, /1 anchor/);
        assert.match(error.message, /axis-a \/ One/);
        return true;
      }
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('verifyAllAnchors refuses a plugin cell with no provenance, or an n/a cell with no note', async () => {
  const { dir, roots } = await makeRoots();
  try {
    const root = join(roots.fixtureRoot, 'node_modules/lib');
    await mkdir(root, { recursive: true });
    await writeFile(join(root, 'dist.js'), 'export const Real = 1;\n');
    const anchor = /** @type {const} */ ({
      kind: 'absent-in-tree',
      module: 'lib',
      glob: '**/*.js',
      includes: 'Fake'
    });
    const axes = [
      {
        id: 'axis-a',
        label: 'Axis A',
        entries: {
          One: {
            status: /** @type {const} */ ('plugin'),
            anchor,
            source: 'x'
          },
          Two: { status: /** @type {const} */ ('n/a'), anchor, source: 'x' }
        }
      }
    ];
    await assert.rejects(
      () => verifyAllAnchors(axes, [{ name: 'One' }, { name: 'Two' }], roots),
      (error) => {
        assert.ok(error instanceof Error);
        assert.match(error.message, /axis-a \/ One: a 'plugin' cell/);
        assert.match(error.message, /axis-a \/ Two: an 'n\/a' cell/);
        return true;
      }
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

// ---- describeAnchor ------------------------------------------------------------

test('describes each anchor kind in words', () => {
  assert.match(
    describeAnchor({ kind: 'export', module: 'x', name: 'Y' }),
    /`x` exports `Y`/
  );
  assert.match(
    describeAnchor({
      kind: 'absent-in-tree',
      module: 'x',
      glob: ['**/*.js', '**/*.d.ts'],
      includes: 'Y'
    }),
    /no file of `x` matching `\*\*\/\*\.js` or `\*\*\/\*\.d\.ts` contains `Y`/
  );
  assert.match(
    describeAnchor({ kind: 'absent-in-tree', module: 'x', glob: '**/*.css' }),
    /`x` ships no file matching `\*\*\/\*\.css`/
  );
  assert.match(
    describeAnchor({ kind: 'absent', module: 'x', field: 'style' }),
    /`x`'s `package.json` has no `style`/
  );
  assert.match(
    describeAnchor({ kind: 'imports-in-node', module: 'x', expect: 'imports' }),
    /importing `x` in plain Node, with no DOM globals, succeeds/
  );
});

// ---- describePlugin ------------------------------------------------------------

test('describePlugin prints the repository owner, or that none is published', () => {
  assert.match(
    describePlugin({
      name: 'videojs-youtube',
      repository: 'github.com/videojs/videojs-youtube',
      provenance: 'org-published'
    }),
    /npm `repository` github\.com\/videojs\/videojs-youtube, org-published/
  );
  assert.match(
    describePlugin({ name: 'videojs-mux', repository: null }),
    /declares no `repository` field/
  );
});

// ---- table and footnote rendering ---------------------------------------------

/** @type {readonly { id: string; label: string; entries: Record<string, import('./compare-features.mjs').Cell> }[]} */
const sampleAxes = [
  {
    id: 'axis-a',
    label: 'Axis A',
    entries: {
      Alpha: {
        status: 'yes',
        anchor: { kind: 'export', module: 'alpha', name: 'Thing' },
        source: 'alpha docs'
      },
      Beta: {
        status: 'no',
        anchor: {
          kind: 'absent-in-tree',
          module: 'beta',
          glob: '**/*.js',
          includes: 'Thing'
        },
        source: 'beta docs',
        note: 'Checked and absent.'
      }
    }
  },
  {
    id: 'axis-b',
    label: 'Axis B',
    entries: {
      Alpha: {
        status: 'plugin',
        anchor: { kind: 'package', module: 'alpha', field: 'style' },
        source: 'a plugin page',
        note: 'Via `some-plugin`.'
      },
      Beta: {
        status: 'partial',
        anchor: {
          kind: 'types',
          module: 'beta',
          path: 'index.d.ts',
          includes: 'Thing'
        },
        source: 'beta types'
      }
    }
  }
];
const sampleColumns = [{ name: 'Alpha' }, { name: 'Beta' }];

test('assigns footnote numbers in row-major table order', () => {
  const numberOf = footnoteNumbers(sampleAxes, sampleColumns);
  assert.equal(numberOf('axis-a', 'Alpha'), 1);
  assert.equal(numberOf('axis-a', 'Beta'), 2);
  assert.equal(numberOf('axis-b', 'Alpha'), 3);
  assert.equal(numberOf('axis-b', 'Beta'), 4);
});

test('renders a padded table with one footnote marker per cell', () => {
  const numberOf = footnoteNumbers(sampleAxes, sampleColumns);
  const table = renderTable(sampleAxes, sampleColumns, numberOf);
  const lines = table.split('\n');
  assert.equal(lines.length, 4); // header, delimiter, 2 rows
  assert.match(lines[0] ?? '', /\| Axis +\| Alpha +\| Beta +\|/);
  assert.match(lines[2] ?? '', /yes\[\^1\]/);
  assert.match(lines[2] ?? '', /no\[\^2\]/);
  assert.match(lines[3] ?? '', /plugin\[\^3\]/);
  assert.match(lines[3] ?? '', /partial\[\^4\]/);
  // Every row is padded to the same width as every other, Prettier-table style.
  const widths = lines.map((line) => line.length);
  assert.deepEqual(new Set(widths).size, 1);
});

test('renders one footnote per cell, carrying its note, anchor and source', () => {
  const numberOf = footnoteNumbers(sampleAxes, sampleColumns);
  const footnotes = renderFootnotes(sampleAxes, sampleColumns, numberOf);
  assert.match(footnotes, /\[\^1\]: \*\*Axis A — Alpha\*\*: yes\./);
  assert.match(footnotes, /`alpha` exports `Thing`/);
  assert.match(footnotes, /Source: alpha docs/);
  assert.match(
    footnotes,
    /\[\^2\]: \*\*Axis A — Beta\*\*: no\. Checked and absent\./
  );
  assert.match(
    footnotes,
    /\[\^3\]: \*\*Axis B — Alpha\*\*: plugin\. Via `some-plugin`\./
  );
});

test('renderTable throws by name when an axis has no entry for a column', () => {
  const brokenAxes = [{ id: 'broken', label: 'Broken', entries: {} }];
  assert.throws(
    () => renderTable(brokenAxes, sampleColumns, () => 1),
    /broken has no entry for Alpha/
  );
});

// ---- whole-document rendering and --check masking -----------------------------

test('maskVolatile replaces the date and nothing else', () => {
  const doc = "Measured 2026-09-05 against `tests/compare`'s pinned installs.";
  assert.equal(
    maskVolatile(doc),
    "Measured <date> against `tests/compare`'s pinned installs."
  );
});

test('two renders on different dates mask equal', () => {
  /** @param {string} date */
  const render = (date) =>
    renderFeaturesDoc({
      date,
      versions: [{ name: 'Alpha', version: '1.0.0' }],
      table: '| Axis |\n| --- |',
      footnotes: '[^1]: a footnote'
    });
  assert.equal(
    maskVolatile(render('2026-01-01')),
    maskVolatile(render('2026-09-05'))
  );
});

test('a changed table does not mask equal to the original', () => {
  const base = {
    versions: [{ name: 'Alpha', version: '1.0.0' }],
    footnotes: '[^1]: a footnote'
  };
  const before = renderFeaturesDoc({
    date: '2026-01-01',
    table: '| A |',
    ...base
  });
  const after = renderFeaturesDoc({
    date: '2026-09-05',
    table: '| B |',
    ...base
  });
  assert.notEqual(maskVolatile(before), maskVolatile(after));
});

// ---- the CLI's own `--check` exit path ----------------------------------------

// The same gap `compare-libraries.test.mjs` closes at its own end, for the same
// reason and through the same seam: no pure function reaches the CLI's exit
// code, and a real run evaluates every anchor across six installed packages and
// a `packages/*/dist` the `static` job never builds. `PLAYDECK_COMPARE_STUB`
// renders one fixed axis instead, so these two tests are about the exit path and
// nothing else.

/** @param {readonly string[]} args @param {Record<string, string>} env */
const runCli = (args, env) =>
  spawnSync(
    process.execPath,
    [join(scriptsDir, 'compare-features.mjs'), ...args],
    { encoding: 'utf8', env: { ...process.env, ...env } }
  );

test('compare-features --check exits 0 on the document it just wrote', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'compare-features-cli-'));
  try {
    const doc = join(dir, 'features.md');
    const env = { PLAYDECK_COMPARE_DOC: doc, PLAYDECK_COMPARE_STUB: '1' };
    const written = runCli([], env);
    assert.equal(written.status, 0, written.stderr);
    const checked = runCli(['--check'], env);
    assert.equal(checked.status, 0, checked.stderr);
    assert.match(checked.stdout, /already matches a fresh check/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('compare-features --check exits non-zero and prints a diff when a status is altered', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'compare-features-cli-'));
  try {
    const doc = join(dir, 'features.md');
    const env = { PLAYDECK_COMPARE_DOC: doc, PLAYDECK_COMPARE_STUB: '1' };
    runCli([], env);
    const before = await readFile(doc, 'utf8');
    await writeFile(doc, before.replace('yes[^1]', 'no[^1]'));
    const checked = runCli(['--check'], env);
    assert.notEqual(checked.status, 0);
    assert.match(checked.stderr, /- .*no\[\^1\]/);
    assert.match(checked.stderr, /\+ .*yes\[\^1\]/);
    assert.match(checked.stderr, /no longer matches a fresh check/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
