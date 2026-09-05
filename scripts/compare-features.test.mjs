import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  describeAnchor,
  evaluateAnchor,
  footnoteNumbers,
  maskVolatile,
  packageRoot,
  renderFeaturesDoc,
  renderFootnotes,
  renderTable,
  resolveExport,
  verifyAllAnchors
} from './compare-features.mjs';

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

test('absent-by-name holds only when the file does not contain the literal', async () => {
  const { dir, roots } = await makeRoots();
  try {
    const root = join(roots.fixtureRoot, 'node_modules/maybe-text');
    await mkdir(root, { recursive: true });
    await writeFile(join(root, 'dist.js'), 'export const AirplayButton = 1;\n');
    const present = await evaluateAnchor(
      {
        kind: 'absent',
        module: 'maybe-text',
        name: 'AirplayButton',
        path: 'dist.js'
      },
      roots
    );
    assert.equal(present.holds, false);
    const absent = await evaluateAnchor(
      {
        kind: 'absent',
        module: 'maybe-text',
        name: 'ChromecastButton',
        path: 'dist.js'
      },
      roots
    );
    assert.equal(absent.holds, true);
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
              kind: 'absent',
              module: 'lib',
              name: 'Real',
              path: 'dist.js'
            }),
            source: 'x'
          },
          Two: {
            status: /** @type {const} */ ('no'),
            anchor: /** @type {const} */ ({
              kind: 'absent',
              module: 'lib',
              name: 'Fake',
              path: 'dist.js'
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

// ---- describeAnchor ------------------------------------------------------------

test('describes each anchor kind in words', () => {
  assert.match(
    describeAnchor({ kind: 'export', module: 'x', name: 'Y' }),
    /`x` exports `Y`/
  );
  assert.match(
    describeAnchor({ kind: 'absent', module: 'x', name: 'Y', path: 'z.js' }),
    /`x`'s `z.js` has no `Y`/
  );
  assert.match(
    describeAnchor({ kind: 'absent', module: 'x', field: 'style' }),
    /`x`'s `package.json` has no `style`/
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
          kind: 'absent',
          module: 'beta',
          name: 'Thing',
          path: 'dist.js'
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
