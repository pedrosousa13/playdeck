import assert from 'node:assert/strict';
import test from 'node:test';

import {
  excludedChunks,
  gzipBytes,
  kb,
  maskVolatile,
  notCounted,
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

// ---- excludedChunks: the complement, from the same build --------------------

test('is empty when every chunk is reachable', () => {
  const graph = [
    chunk({ fileName: 'entry.js', isEntry: true, imports: ['shared.js'] }),
    chunk({ fileName: 'shared.js', imports: [] })
  ];
  assert.deepEqual(
    excludedChunks(graph, () => false),
    []
  );
});

test('names exactly the chunks reachableChunks left out', () => {
  const graph = [
    chunk({ fileName: 'entry.js', isEntry: true, imports: [] }),
    chunk({
      fileName: 'native-provider.js',
      moduleIds: ['/pkg/provider-native/dist/index.js']
    }),
    chunk({
      fileName: 'youtube-provider.js',
      moduleIds: ['/pkg/provider-youtube/dist/index.js']
    }),
    chunk({
      fileName: 'vimeo-provider.js',
      moduleIds: ['/pkg/provider-vimeo/dist/index.js']
    })
  ];
  /** @param {{ moduleIds: readonly string[] }} c */
  const isRequired = (c) =>
    c.moduleIds.some((id) => id.includes('/provider-native/'));
  const excluded = excludedChunks(graph, isRequired);
  assert.deepEqual(excluded.map((c) => c.fileName).sort(), [
    'vimeo-provider.js',
    'youtube-provider.js'
  ]);
  // The two sets never overlap and never drop a chunk between them.
  const reachable = reachableChunks(graph, isRequired);
  assert.equal(reachable.length + excluded.length, graph.length);
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

// ---- notCounted ------------------------------------------------------------

test('renders a bare 0 when nothing was excluded', () => {
  assert.equal(notCounted(0, 0), '0');
});

test('names the chunk count and its gzipped size when something was excluded', () => {
  assert.equal(notCounted(1, 1024), '1 chunk, 1.00 KB');
  assert.equal(notCounted(9, 62976), '9 chunks, 61.50 KB');
});

// ---- renderTable ---------------------------------------------------------

test('pads every cell in a column to the widest, the way Prettier does', () => {
  const lines = renderTable([
    {
      name: 'Playdeck',
      version: '1.0.0',
      composition: 'core + native',
      bytes: 20430,
      notCountedChunks: 6,
      notCountedBytes: 62976
    },
    {
      name: 'Video.js',
      version: '8.24.0',
      composition: 'videojs()',
      bytes: 204390,
      notCountedChunks: 0,
      notCountedBytes: 0
    }
  ]).split('\n');

  assert.deepEqual(lines, [
    '| Library  | Version | Composition measured | Gzipped   | Not counted        |',
    '| -------- | ------- | -------------------- | --------- | ------------------ |',
    '| Playdeck | 1.0.0   | core + native        | 19.95 KB  | 6 chunks, 61.50 KB |',
    '| Video.js | 8.24.0  | videojs()            | 199.60 KB | 0                  |'
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
        bytes: 20430,
        notCountedChunks: 6,
        notCountedBytes: 62976
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

// ---- maskVolatile: what `--check` is allowed to ignore -----------------------

test('masks the date so two renders taken on different days compare equal', () => {
  const base = {
    date: '2026-09-05',
    nodeVersion: 'v24.18.1',
    viteVersion: '8.1.5',
    rows: [
      {
        name: 'Playdeck',
        version: '1.0.0',
        composition: 'core + native',
        bytes: 20430,
        notCountedChunks: 6,
        notCountedBytes: 62976
      }
    ]
  };
  const older = renderResultsDoc(base);
  const later = renderResultsDoc({ ...base, date: '2026-09-12' });
  assert.notEqual(older, later);
  assert.equal(maskVolatile(older), maskVolatile(later));
});

test('masks the Node version so two renders on different Node installs compare equal', () => {
  // The case #543's follow-up review named directly: CI runs Node 22 while a
  // local checkout may not, and neither is a fact about the figures below.
  const base = {
    date: '2026-09-05',
    nodeVersion: 'v22.14.0',
    viteVersion: '8.1.5',
    rows: [
      {
        name: 'Playdeck',
        version: '1.0.0',
        composition: 'core + native',
        bytes: 20430,
        notCountedChunks: 6,
        notCountedBytes: 62976
      }
    ]
  };
  const ci = renderResultsDoc(base);
  const local = renderResultsDoc({ ...base, nodeVersion: 'v24.18.1' });
  assert.notEqual(ci, local);
  assert.equal(maskVolatile(ci), maskVolatile(local));
});

test('a checked-in document with an older date but identical content matches a fresh render once masked', () => {
  const data = {
    date: '2026-01-01',
    nodeVersion: 'v24.18.1',
    viteVersion: '8.1.5',
    rows: [
      {
        name: 'Video.js',
        version: '8.24.0',
        composition: 'videojs()',
        bytes: 204390,
        notCountedChunks: 0,
        notCountedBytes: 0
      }
    ]
  };
  const checkedIn = renderResultsDoc(data);
  const freshRun = renderResultsDoc({ ...data, date: '2026-09-05' });
  assert.equal(maskVolatile(checkedIn), maskVolatile(freshRun));
});

test('a changed byte figure still fails the masked comparison', () => {
  const checkedIn = renderResultsDoc({
    date: '2026-01-01',
    nodeVersion: 'v24.18.1',
    viteVersion: '8.1.5',
    rows: [
      {
        name: 'Video.js',
        version: '8.24.0',
        composition: 'videojs()',
        bytes: 204390,
        notCountedChunks: 0,
        notCountedBytes: 0
      }
    ]
  });
  const freshRun = renderResultsDoc({
    date: '2026-09-05',
    nodeVersion: 'v24.18.1',
    viteVersion: '8.1.5',
    rows: [
      {
        name: 'Video.js',
        version: '8.24.0',
        composition: 'videojs()',
        bytes: 210000,
        notCountedChunks: 0,
        notCountedBytes: 0
      }
    ]
  });
  assert.notEqual(maskVolatile(checkedIn), maskVolatile(freshRun));
});

test('a changed "Not counted" figure still fails the masked comparison', () => {
  const checkedIn = renderResultsDoc({
    date: '2026-01-01',
    nodeVersion: 'v24.18.1',
    viteVersion: '8.1.5',
    rows: [
      {
        name: 'Vidstack',
        version: '1.15.6',
        composition: 'MediaPlayer + MediaProvider + DefaultVideoLayout',
        bytes: 92200,
        notCountedChunks: 9,
        notCountedBytes: 62976
      }
    ]
  });
  const freshRun = renderResultsDoc({
    date: '2026-09-05',
    nodeVersion: 'v24.18.1',
    viteVersion: '8.1.5',
    rows: [
      {
        name: 'Vidstack',
        version: '1.15.6',
        composition: 'MediaPlayer + MediaProvider + DefaultVideoLayout',
        bytes: 92200,
        notCountedChunks: 10,
        notCountedBytes: 70000
      }
    ]
  });
  assert.notEqual(maskVolatile(checkedIn), maskVolatile(freshRun));
});

test('only the date and Node version are touched, so the Vite version still shows up', () => {
  const doc = renderResultsDoc({
    date: '2026-09-05',
    nodeVersion: 'v24.18.1',
    viteVersion: '8.1.5',
    rows: []
  });
  assert.equal(maskVolatile(doc).includes('2026-09-05'), false);
  assert.equal(maskVolatile(doc).includes('v24.18.1'), false);
  assert.equal(maskVolatile(doc).includes('8.1.5'), true);
});
