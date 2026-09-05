import assert from 'node:assert/strict';
import test from 'node:test';

import {
  gzipBytes,
  kb,
  pinnedVersion,
  reachableChunks,
  renderResultsDoc,
  renderTable
} from './compare-libraries.mjs';

// Deliberately not a real `vite build`: this file runs in the `static` CI job
// alongside `readme-bytes.test.mjs` and `bundle-budgets.test.mjs`, neither of
// which builds anything either, and for the same reason those give -- a
// fixture that has to be re-typed whenever a compared library's bundle moves
// would be the same rot one level down. What is exercised here is the graph
// logic and the rendering, against small hand-built chunk graphs shaped like
// the real ones (an entry with a static import, and a dynamically-imported
// provider chunk identified by its `moduleIds`) rather than the real
// libraries.

/**
 * @param {{ fileName: string; code?: string; isEntry?: boolean; imports?: string[]; moduleIds?: string[] }} overrides
 */
const chunk = (overrides) => ({
  code: '',
  isEntry: false,
  imports: [],
  moduleIds: [],
  ...overrides
});

// ---- reachableChunks --------------------------------------------------------

test('keeps the entry and its static import closure', () => {
  const graph = [
    chunk({ fileName: 'entry.js', isEntry: true, imports: ['shared.js'] }),
    chunk({ fileName: 'shared.js', imports: [] })
  ];
  const kept = reachableChunks(graph, () => false);
  assert.deepEqual(kept.map((c) => c.fileName).sort(), [
    'entry.js',
    'shared.js'
  ]);
});

test('drops external specifiers from the static walk rather than throwing', () => {
  // "react" appears in `imports` the way Rollup lists an externalised
  // specifier, and there is no chunk for it in the graph.
  const graph = [
    chunk({ fileName: 'entry.js', isEntry: true, imports: ['react'] })
  ];
  const kept = reachableChunks(graph, () => false);
  assert.deepEqual(
    kept.map((c) => c.fileName),
    ['entry.js']
  );
});

test('drops a dynamically-imported chunk the fixture never needs', () => {
  const graph = [
    chunk({ fileName: 'entry.js', isEntry: true, imports: [] }),
    chunk({
      fileName: 'youtube-provider.js',
      moduleIds: ['/pkg/provider-youtube/dist/index.js']
    })
  ];
  const kept = reachableChunks(graph, (c) =>
    c.moduleIds.some((id) => id.includes('/provider-native/'))
  );
  assert.deepEqual(
    kept.map((c) => c.fileName),
    ['entry.js']
  );
});

test('keeps a dynamically-imported chunk requiredChunk names as unavoidable', () => {
  const graph = [
    chunk({ fileName: 'entry.js', isEntry: true, imports: [] }),
    chunk({
      fileName: 'native-provider.js',
      moduleIds: ['/pkg/provider-native/dist/index.js']
    }),
    chunk({
      fileName: 'youtube-provider.js',
      moduleIds: ['/pkg/provider-youtube/dist/index.js']
    })
  ];
  const kept = reachableChunks(graph, (c) =>
    c.moduleIds.some((id) => id.includes('/provider-native/'))
  );
  assert.deepEqual(kept.map((c) => c.fileName).sort(), [
    'entry.js',
    'native-provider.js'
  ]);
});

test('throws when the graph has no entry chunk', () => {
  const graph = [chunk({ fileName: 'orphan.js' })];
  assert.throws(() => reachableChunks(graph, () => false), /no entry chunk/);
});

// ---- gzipBytes ---------------------------------------------------------------

test('sums separate gzip sizes rather than gzipping the concatenation', () => {
  const a = chunk({ fileName: 'a.js', code: 'x'.repeat(1000) });
  const b = chunk({ fileName: 'b.js', code: 'x'.repeat(1000) });
  const separate = gzipBytes([a, b]);
  const concatenated = gzipBytes([
    chunk({ fileName: 'ab.js', code: a.code + b.code })
  ]);
  // Repeating the same 1000-byte run twice compresses far better as one gzip
  // stream than as two -- if this ever stopped holding, summing separately
  // would no longer be the more conservative (i.e. larger) figure.
  assert.ok(separate > concatenated);
});

// ---- pinnedVersion -----------------------------------------------------------

test('reports the installed version when it matches the pin', () => {
  assert.equal(pinnedVersion('react-player', '3.4.0', '3.4.0'), '3.4.0');
});

test('refuses a mismatched pin', () => {
  assert.throws(
    () => pinnedVersion('react-player', '3.4.0', '3.3.0'),
    /installed at 3\.3\.0 but tests\/compare\/package\.json pins 3\.4\.0/
  );
});

test('refuses a package tests/compare/package.json no longer pins', () => {
  assert.throws(
    () => pinnedVersion('react-player', undefined, '3.4.0'),
    /no longer pins react-player/
  );
});

test('a workspace pin reports the installed version unchecked', () => {
  assert.equal(
    pinnedVersion('@playdeck/react', 'workspace:*', '1.0.0'),
    '1.0.0'
  );
});

// ---- kb ------------------------------------------------------------------

test('formats bytes as kilobytes to two decimal places', () => {
  assert.equal(kb(1024), '1.00');
  assert.equal(kb(2048 + 512), '2.50');
  assert.equal(kb(0), '0.00');
});

// ---- renderTable ---------------------------------------------------------

test('pads every cell in a column to the widest, the way Prettier does', () => {
  const lines = renderTable([
    {
      name: 'Playdeck',
      version: '1.0.0',
      composition: 'core + native',
      bytes: 20430
    },
    {
      name: 'Video.js',
      version: '8.24.0',
      composition: 'videojs()',
      bytes: 204390
    }
  ]).split('\n');

  assert.deepEqual(lines, [
    '| Library  | Version | Composition measured | Gzipped   |',
    '| -------- | ------- | -------------------- | --------- |',
    '| Playdeck | 1.0.0   | core + native        | 19.95 KB  |',
    '| Video.js | 8.24.0  | videojs()            | 199.60 KB |'
  ]);
});

// ---- renderResultsDoc: determinism and the date's role -----------------------

test('rendering the same input twice produces byte-identical output', () => {
  const data = {
    date: '2026-09-05',
    nodeVersion: 'v24.18.1',
    viteVersion: '8.1.5',
    rows: [
      {
        name: 'Playdeck',
        version: '1.0.0',
        composition: 'core + native',
        bytes: 20430
      }
    ]
  };
  assert.equal(renderResultsDoc(data), renderResultsDoc(data));
});

test('the date, Node and Vite versions each appear in the rendered document', () => {
  const doc = renderResultsDoc({
    date: '2026-09-05',
    nodeVersion: 'v24.18.1',
    viteVersion: '8.1.5',
    rows: []
  });
  assert.match(doc, /Measured 2026-09-05 on Node v24\.18\.1, Vite 8\.1\.5/);
});

test('changing only the date changes the rendered document', () => {
  const base = {
    date: '2026-09-05',
    nodeVersion: 'v24.18.1',
    viteVersion: '8.1.5',
    rows: []
  };
  assert.notEqual(
    renderResultsDoc(base),
    renderResultsDoc({ ...base, date: '2026-09-06' })
  );
});
