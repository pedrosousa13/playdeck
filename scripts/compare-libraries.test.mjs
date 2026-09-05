import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  delta,
  excludedChunks,
  gzipBytes,
  kb,
  lineDiff,
  maskVolatile,
  normalizeEsbuildOutputs,
  notCounted,
  pinnedVersion,
  reachableChunks,
  renderResultsDoc,
  renderTable
} from './compare-libraries.mjs';

const scriptsDir = dirname(fileURLToPath(import.meta.url));

// Deliberately not a real `vite build` or `esbuild.build`: this file runs in
// the `static` CI job alongside `readme-bytes.test.mjs` and
// `bundle-budgets.test.mjs`, neither of which builds anything either, and for
// the same reason those give -- a fixture that has to be re-typed whenever a
// compared library's bundle moves would be the same rot one level down. What
// is exercised here is the graph logic and the rendering, against small
// hand-built chunk graphs and a small hand-built esbuild metafile, shaped
// like the real ones rather than the real libraries.

/**
 * @param {{ fileName: string; code?: string; isEntry?: boolean; imports?: string[]; dynamicImports?: string[]; moduleIds?: string[] }} overrides
 */
const chunk = (overrides) => ({
  code: '',
  isEntry: false,
  imports: [],
  dynamicImports: [],
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
    chunk({
      fileName: 'entry.js',
      isEntry: true,
      dynamicImports: ['youtube-provider.js']
    }),
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
    chunk({
      fileName: 'entry.js',
      isEntry: true,
      dynamicImports: ['native-provider.js', 'youtube-provider.js']
    }),
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

test('looks through a content-free shim to the real chunk it statically wraps', () => {
  // esbuild's own shape for Playdeck's native provider: the dynamic-import
  // target is a shim with no module of its own, which statically imports the
  // chunk esbuild actually put the provider's code in.
  const graph = [
    chunk({ fileName: 'entry.js', isEntry: true, dynamicImports: ['shim.js'] }),
    chunk({ fileName: 'shim.js', imports: ['real-code.js'], moduleIds: [] }),
    chunk({
      fileName: 'real-code.js',
      moduleIds: ['/pkg/provider-native/dist/index.js']
    })
  ];
  const kept = reachableChunks(graph, (c) =>
    c.moduleIds.some((id) => id.includes('/provider-native/'))
  );
  assert.deepEqual(kept.map((c) => c.fileName).sort(), [
    'entry.js',
    'real-code.js',
    'shim.js'
  ]);
});

test('does not accept a sibling merely because it shares a static dependency with a required chunk', () => {
  // The bug this regression test is named for: Playdeck's HLS adapter
  // statically imports the native provider's own chunk to reuse it, and an
  // earlier version of this function accepted the HLS adapter on that
  // account alone, because its transitive closure happened to contain the
  // chunk isRequired was really asking about.
  const graph = [
    chunk({
      fileName: 'entry.js',
      isEntry: true,
      dynamicImports: ['native-provider.js', 'hls-adapter.js']
    }),
    chunk({
      fileName: 'native-provider.js',
      moduleIds: ['/pkg/provider-native/dist/index.js']
    }),
    chunk({
      fileName: 'hls-adapter.js',
      // Reuses a helper from the native provider's own chunk -- a real static
      // import, not a dynamic one, and not a shim: this chunk carries its own
      // module too.
      imports: ['native-provider.js'],
      moduleIds: ['/pkg/provider-hls/dist/index.js']
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

test('is order-independent: the same graph is decided the same way whichever sibling is queued first', () => {
  const graphs = [
    [
      chunk({
        fileName: 'entry.js',
        isEntry: true,
        dynamicImports: ['native-provider.js', 'hls-adapter.js']
      }),
      chunk({
        fileName: 'native-provider.js',
        moduleIds: ['/pkg/provider-native/dist/index.js']
      }),
      chunk({
        fileName: 'hls-adapter.js',
        imports: ['native-provider.js'],
        moduleIds: ['/pkg/provider-hls/dist/index.js']
      })
    ],
    [
      chunk({
        fileName: 'entry.js',
        isEntry: true,
        // Same graph, dynamic imports listed in the opposite order.
        dynamicImports: ['hls-adapter.js', 'native-provider.js']
      }),
      chunk({
        fileName: 'hls-adapter.js',
        imports: ['native-provider.js'],
        moduleIds: ['/pkg/provider-hls/dist/index.js']
      }),
      chunk({
        fileName: 'native-provider.js',
        moduleIds: ['/pkg/provider-native/dist/index.js']
      })
    ]
  ];
  const isRequired = (/** @type {{ moduleIds: readonly string[] }} */ c) =>
    c.moduleIds.some((id) => id.includes('/provider-native/'));
  const results = graphs.map((graph) =>
    reachableChunks(graph, isRequired)
      .map((c) => c.fileName)
      .sort()
  );
  assert.deepEqual(results[0], results[1]);
  assert.deepEqual(results[0], ['entry.js', 'native-provider.js']);
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
    chunk({
      fileName: 'entry.js',
      isEntry: true,
      dynamicImports: [
        'native-provider.js',
        'youtube-provider.js',
        'vimeo-provider.js'
      ]
    }),
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

// ---- normalizeEsbuildOutputs -------------------------------------------------

test('splits one esbuild imports array by kind into imports and dynamicImports', () => {
  const outputs = {
    'out/entry.js': {
      entryPoint: 'entries/playdeck.tsx',
      imports: [
        { path: 'out/core.js', kind: 'import-statement' },
        { path: 'react', kind: 'import-statement' },
        { path: 'out/shim.js', kind: 'dynamic-import' }
      ],
      inputs: { 'entries/playdeck.tsx': {} }
    },
    'out/core.js': {
      imports: [],
      inputs: { '../../packages/core/dist/index.js': {} }
    },
    'out/shim.js': {
      imports: [{ path: 'out/core.js', kind: 'import-statement' }],
      inputs: {}
    }
  };
  const codeByOutput = {
    'out/entry.js': 'ENTRY_CODE',
    'out/core.js': 'CORE_CODE',
    'out/shim.js': 'SHIM_CODE'
  };
  const chunks = normalizeEsbuildOutputs(outputs, codeByOutput, 'out/entry.js');
  assert.deepEqual(chunks.map((c) => c.fileName).sort(), [
    'out/core.js',
    'out/entry.js',
    'out/shim.js'
  ]);

  const entryChunk = chunks.find((c) => c.fileName === 'out/entry.js');
  assert.equal(entryChunk?.isEntry, true);
  assert.equal(entryChunk?.code, 'ENTRY_CODE');
  assert.deepEqual(entryChunk?.imports, ['out/core.js', 'react']);
  assert.deepEqual(entryChunk?.dynamicImports, ['out/shim.js']);
  assert.deepEqual(entryChunk?.moduleIds, ['entries/playdeck.tsx']);

  const coreChunk = chunks.find((c) => c.fileName === 'out/core.js');
  assert.equal(coreChunk?.isEntry, false);
  assert.deepEqual(coreChunk?.moduleIds, ['../../packages/core/dist/index.js']);

  const shimChunk = chunks.find((c) => c.fileName === 'out/shim.js');
  assert.deepEqual(shimChunk?.moduleIds, []);
  assert.deepEqual(shimChunk?.imports, ['out/core.js']);
});

test('drops non-JS outputs, such as a CSS bundle esbuild emitted alongside', () => {
  const outputs = {
    'out/entry.js': {
      entryPoint: 'entries/video-js.tsx',
      imports: [],
      inputs: { 'entries/video-js.tsx': {} }
    },
    'out/entry.css': {
      imports: [],
      inputs: { 'video.css': {} }
    }
  };
  const chunks = normalizeEsbuildOutputs(
    outputs,
    { 'out/entry.js': 'CODE' },
    'out/entry.js'
  );
  assert.deepEqual(
    chunks.map((c) => c.fileName),
    ['out/entry.js']
  );
});

test('a normalized esbuild graph runs through reachableChunks exactly like a Vite one', () => {
  // The same shim/shared-code shape esbuild gives Playdeck's native provider
  // in the real build, expressed as a metafile fixture rather than a real
  // esbuild invocation.
  const outputs = {
    'out/entry.js': {
      entryPoint: 'entries/playdeck.tsx',
      imports: [{ path: 'out/core.js', kind: 'import-statement' }],
      inputs: { 'entries/playdeck.tsx': {} }
    },
    'out/core.js': {
      imports: [],
      inputs: { '../../packages/core/dist/index.js': {} }
    },
    'out/native-shim.js': {
      // The direct dynamic-import target -- no module of its own.
      imports: [
        { path: 'out/native-code.js', kind: 'import-statement' },
        { path: 'out/core.js', kind: 'import-statement' }
      ],
      inputs: {}
    },
    'out/native-code.js': {
      imports: [],
      inputs: { '../../packages/provider-native/dist/index.js': {} }
    },
    'out/youtube.js': {
      imports: [],
      inputs: { '../../packages/provider-youtube/dist/index.js': {} }
    }
  };
  // The dynamic-import edges live on the entry's own `imports` array in
  // esbuild's metafile shape (an `imports` entry can be either kind), so the
  // fixture adds them there rather than inventing a separate field esbuild
  // does not have.
  outputs['out/entry.js'].imports.push(
    { path: 'out/native-shim.js', kind: 'dynamic-import' },
    { path: 'out/youtube.js', kind: 'dynamic-import' }
  );

  const chunks = normalizeEsbuildOutputs(
    outputs,
    Object.fromEntries(Object.keys(outputs).map((key) => [key, key])),
    'out/entry.js'
  );
  const kept = reachableChunks(chunks, (c) =>
    c.moduleIds.some((id) => id.includes('/provider-native/'))
  );
  assert.deepEqual(kept.map((c) => c.fileName).sort(), [
    'out/core.js',
    'out/entry.js',
    'out/native-code.js',
    'out/native-shim.js'
  ]);
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

// ---- delta -----------------------------------------------------------------

test('signs a positive delta and rounds to one decimal', () => {
  assert.equal(delta(20430, 21197), '+3.8%');
});

test('signs a negative delta without a doubled minus', () => {
  assert.equal(delta(2970, 2400), '-19.2%');
});

test('a delta of exactly zero carries the positive sign', () => {
  assert.equal(delta(1000, 1000), '+0.0%');
});

// ---- renderTable ---------------------------------------------------------

test('pads every cell in a column to the widest, the way Prettier does', () => {
  const lines = renderTable([
    {
      name: 'Playdeck',
      version: '1.0.0',
      composition: 'core + native',
      bytes: 20430,
      esbuildBytes: 21197,
      notCountedChunks: 6,
      notCountedBytes: 62976
    },
    {
      name: 'Video.js',
      version: '8.24.0',
      composition: 'videojs()',
      bytes: 204390,
      esbuildBytes: 210790,
      notCountedChunks: 0,
      notCountedBytes: 0
    }
  ]).split('\n');

  assert.deepEqual(lines, [
    '| Library  | Version | Composition measured | Gzipped (Vite) | Gzipped (esbuild) | Delta | Not counted        |',
    '| -------- | ------- | -------------------- | -------------- | ----------------- | ----- | ------------------ |',
    '| Playdeck | 1.0.0   | core + native        | 19.95 KB       | 20.70 KB          | +3.8% | 6 chunks, 61.50 KB |',
    '| Video.js | 8.24.0  | videojs()            | 199.60 KB      | 205.85 KB         | +3.1% | 0                  |'
  ]);
});

// ---- renderResultsDoc: determinism and the date's role -----------------------

test('rendering the same input twice produces byte-identical output', () => {
  const data = {
    date: '2026-09-05',
    nodeVersion: 'v24.18.1',
    viteVersion: '8.1.5',
    esbuildVersion: '0.28.1',
    rows: [
      {
        name: 'Playdeck',
        version: '1.0.0',
        composition: 'core + native',
        bytes: 20430,
        esbuildBytes: 21197,
        notCountedChunks: 6,
        notCountedBytes: 62976
      }
    ]
  };
  assert.equal(renderResultsDoc(data), renderResultsDoc(data));
});

test('the date, Node, Vite and esbuild versions each appear in the rendered document', () => {
  const doc = renderResultsDoc({
    date: '2026-09-05',
    nodeVersion: 'v24.18.1',
    viteVersion: '8.1.5',
    esbuildVersion: '0.28.1',
    rows: []
  });
  assert.match(
    doc,
    /Measured 2026-09-05 on Node v24\.18\.1, Vite 8\.1\.5, esbuild\s+0\.28\.1/
  );
});

test('changing only the date changes the rendered document', () => {
  const base = {
    date: '2026-09-05',
    nodeVersion: 'v24.18.1',
    viteVersion: '8.1.5',
    esbuildVersion: '0.28.1',
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
    esbuildVersion: '0.28.1',
    rows: [
      {
        name: 'Playdeck',
        version: '1.0.0',
        composition: 'core + native',
        bytes: 20430,
        esbuildBytes: 21197,
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
    esbuildVersion: '0.28.1',
    rows: [
      {
        name: 'Playdeck',
        version: '1.0.0',
        composition: 'core + native',
        bytes: 20430,
        esbuildBytes: 21197,
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
    esbuildVersion: '0.28.1',
    rows: [
      {
        name: 'Video.js',
        version: '8.24.0',
        composition: 'videojs()',
        bytes: 204390,
        esbuildBytes: 210790,
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
    esbuildVersion: '0.28.1',
    rows: [
      {
        name: 'Video.js',
        version: '8.24.0',
        composition: 'videojs()',
        bytes: 204390,
        esbuildBytes: 210790,
        notCountedChunks: 0,
        notCountedBytes: 0
      }
    ]
  });
  const freshRun = renderResultsDoc({
    date: '2026-09-05',
    nodeVersion: 'v24.18.1',
    viteVersion: '8.1.5',
    esbuildVersion: '0.28.1',
    rows: [
      {
        name: 'Video.js',
        version: '8.24.0',
        composition: 'videojs()',
        bytes: 210000,
        esbuildBytes: 210790,
        notCountedChunks: 0,
        notCountedBytes: 0
      }
    ]
  });
  assert.notEqual(maskVolatile(checkedIn), maskVolatile(freshRun));
});

test('a changed esbuild figure alone still fails the masked comparison', () => {
  const checkedIn = renderResultsDoc({
    date: '2026-01-01',
    nodeVersion: 'v24.18.1',
    viteVersion: '8.1.5',
    esbuildVersion: '0.28.1',
    rows: [
      {
        name: 'Video.js',
        version: '8.24.0',
        composition: 'videojs()',
        bytes: 204390,
        esbuildBytes: 210790,
        notCountedChunks: 0,
        notCountedBytes: 0
      }
    ]
  });
  const freshRun = renderResultsDoc({
    date: '2026-09-05',
    nodeVersion: 'v24.18.1',
    viteVersion: '8.1.5',
    esbuildVersion: '0.28.1',
    rows: [
      {
        name: 'Video.js',
        version: '8.24.0',
        composition: 'videojs()',
        bytes: 204390,
        esbuildBytes: 220000,
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
    esbuildVersion: '0.28.1',
    rows: [
      {
        name: 'Vidstack',
        version: '1.15.6',
        composition: 'MediaPlayer + MediaProvider + DefaultVideoLayout',
        bytes: 92200,
        esbuildBytes: 94000,
        notCountedChunks: 9,
        notCountedBytes: 62976
      }
    ]
  });
  const freshRun = renderResultsDoc({
    date: '2026-09-05',
    nodeVersion: 'v24.18.1',
    viteVersion: '8.1.5',
    esbuildVersion: '0.28.1',
    rows: [
      {
        name: 'Vidstack',
        version: '1.15.6',
        composition: 'MediaPlayer + MediaProvider + DefaultVideoLayout',
        bytes: 92200,
        esbuildBytes: 94000,
        notCountedChunks: 10,
        notCountedBytes: 70000
      }
    ]
  });
  assert.notEqual(maskVolatile(checkedIn), maskVolatile(freshRun));
});

test('only the date and Node version are touched, so the Vite and esbuild versions still show up', () => {
  const doc = renderResultsDoc({
    date: '2026-09-05',
    nodeVersion: 'v24.18.1',
    viteVersion: '8.1.5',
    esbuildVersion: '0.28.1',
    rows: []
  });
  assert.equal(maskVolatile(doc).includes('2026-09-05'), false);
  assert.equal(maskVolatile(doc).includes('v24.18.1'), false);
  assert.equal(maskVolatile(doc).includes('8.1.5'), true);
  assert.equal(maskVolatile(doc).includes('0.28.1'), true);
});

// ---- lineDiff: what --check prints on failure --------------------------------

test('omits lines identical in both documents', () => {
  const before = 'a\nb\nc';
  const after = 'a\nb\nc';
  assert.deepEqual(lineDiff(before, after), []);
});

test('names one changed line as a deletion and an addition, not the whole document', () => {
  const before = 'a\nb\nc';
  const after = 'a\nx\nc';
  assert.deepEqual(lineDiff(before, after), ['- b', '+ x']);
});

test('one changed row in a table reports only that row, not the header or its neighbours', () => {
  // The shape this is actually for: results.md is a table with a shared
  // header and delimiter line above every row -- a positional diff would
  // still report only what changed here, since nothing shifts position, but
  // this pins the property an LCS diff is what buys back once a figure
  // changing width re-pads a whole column (see the next test).
  const before = [
    '| Library  | Gzipped   |',
    '| -------- | --------- |',
    '| Playdeck | 19.94 KB  |',
    '| Video.js | 199.64 KB |'
  ].join('\n');
  const after = [
    '| Library  | Gzipped   |',
    '| -------- | --------- |',
    '| Playdeck | 20.01 KB  |',
    '| Video.js | 199.64 KB |'
  ].join('\n');
  assert.deepEqual(lineDiff(before, after), [
    '- | Playdeck | 19.94 KB  |',
    '+ | Playdeck | 20.01 KB  |'
  ]);
});

test('a figure widening a whole column still reports only the row that changed value', () => {
  // Here the column genuinely re-pads (the header and delimiter widen too),
  // so a positional (same-index) comparison would report all four lines as
  // different. The LCS diff still finds the header, delimiter and untouched
  // row as common lines wherever they recur unchanged, and reports only the
  // one row whose value actually changed.
  const before = [
    'Intro line, unrelated to the table.',
    '| Library  | Gzipped   |',
    '| -------- | --------- |',
    '| Playdeck | 19.94 KB  |',
    '| Video.js | 199.64 KB |',
    '| Library  | Gzipped   |',
    '| -------- | --------- |',
    'Outro line, unrelated to the table.'
  ].join('\n');
  const after = [
    'Intro line, unrelated to the table.',
    '| Library  | Gzipped    |',
    '| -------- | ---------- |',
    '| Playdeck | 1999.94 KB |',
    '| Video.js | 199.64 KB  |',
    '| Library  | Gzipped   |',
    '| -------- | --------- |',
    'Outro line, unrelated to the table.'
  ].join('\n');
  assert.deepEqual(lineDiff(before, after), [
    '- | Library  | Gzipped   |',
    '- | -------- | --------- |',
    '- | Playdeck | 19.94 KB  |',
    '- | Video.js | 199.64 KB |',
    '+ | Library  | Gzipped    |',
    '+ | -------- | ---------- |',
    '+ | Playdeck | 1999.94 KB |',
    '+ | Video.js | 199.64 KB  |'
  ]);
});

test('reports a line added at the end as a pure addition', () => {
  const before = 'a\nb';
  const after = 'a\nb\nc';
  assert.deepEqual(lineDiff(before, after), ['+ c']);
});

test('reports a line removed from the end as a pure deletion', () => {
  const before = 'a\nb\nc';
  const after = 'a\nb';
  assert.deepEqual(lineDiff(before, after), ['- c']);
});

// ---- the CLI's own `--check` exit path ----------------------------------------

// Everything above tests a pure function. What no pure function reaches is the
// thing CI actually depends on: that `node scripts/compare-libraries.mjs
// --check` exits non-zero, and prints a diff, when the checked-in document is
// stale. These two tests spawn the real CLI to cover that, through the
// `PLAYDECK_COMPARE_DOC` / `PLAYDECK_COMPARE_STUB` seam that file's own
// `testSeam` documents -- a real run measures seven bundles against a
// `packages/*/dist` the `static` job never builds, which is neither fast nor
// available here.

/** @param {string} script @param {readonly string[]} args @param {Record<string, string>} env */
const runCli = (script, args, env) =>
  spawnSync(process.execPath, [join(scriptsDir, script), ...args], {
    encoding: 'utf8',
    env: { ...process.env, ...env }
  });

test('compare-libraries --check exits 0 on the document it just wrote', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'compare-libraries-cli-'));
  try {
    const doc = join(dir, 'results.md');
    const env = { PLAYDECK_COMPARE_DOC: doc, PLAYDECK_COMPARE_STUB: '1' };
    const written = runCli('compare-libraries.mjs', [], env);
    assert.equal(written.status, 0, written.stderr);
    const checked = runCli('compare-libraries.mjs', ['--check'], env);
    assert.equal(checked.status, 0, checked.stderr);
    assert.match(checked.stdout, /already matches a fresh run/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('compare-libraries --check exits non-zero and prints a diff when a figure is altered', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'compare-libraries-cli-'));
  try {
    const doc = join(dir, 'results.md');
    const env = { PLAYDECK_COMPARE_DOC: doc, PLAYDECK_COMPARE_STUB: '1' };
    runCli('compare-libraries.mjs', [], env);
    const before = await readFile(doc, 'utf8');
    await writeFile(doc, before.replace('1.00 KB', '9.99 KB'));
    const checked = runCli('compare-libraries.mjs', ['--check'], env);
    assert.notEqual(checked.status, 0);
    assert.match(checked.stderr, /- .*9\.99 KB/);
    assert.match(checked.stderr, /\+ .*1\.00 KB/);
    assert.match(checked.stderr, /no longer matches a fresh measurement/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

// ---- the control-bar row's own label ------------------------------------------

// `results.md` and `docs/comparison/method.md` both say the Playdeck control-bar
// row carries five of Media Chrome's seven controls. Nothing stopped that label
// from drifting away from the fixture it describes, which is exactly the kind of
// count `docs/agents/comments.md` warns goes stale in silence. This reads the
// fixture and holds the three of them together.

/**
 * The `Player.<Part>` names used inside the fixture's `<Player.Controls>`,
 * minus the icons a button swaps between and the `Time` displays -- what the
 * label means by "controls".
 * @param {string} source
 * @returns {string[]}
 */
const controlBarParts = (source) => {
  const open = source.indexOf('<Player.Controls>');
  const close = source.indexOf('</Player.Controls>');
  if (open === -1 || close === -1) {
    throw new Error('playdeck-control-bar.tsx has no <Player.Controls> block.');
  }
  const names = new Set(
    [...source.slice(open, close).matchAll(/<Player\.([A-Za-z]+)/g)].map(
      (match) => match[1]
    )
  );
  names.delete('Controls');
  names.delete('Time');
  return [...names].filter((name) => !name.endsWith('Icon')).sort();
};

test('the control-bar fixture still carries exactly the five parts both documents name', async () => {
  const repoRoot = join(scriptsDir, '..');
  const fixture = await readFile(
    join(repoRoot, 'tests/compare/entries/playdeck-control-bar.tsx'),
    'utf8'
  );
  assert.deepEqual(controlBarParts(fixture), [
    'FullscreenButton',
    'MuteButton',
    'PlayButton',
    'SeekSlider',
    'VolumeSlider'
  ]);

  const harness = await readFile(
    join(repoRoot, 'scripts/compare-libraries.mjs'),
    'utf8'
  );
  assert.match(harness, /5 of Media Chrome's 7 controls/);
  const method = await readFile(
    join(repoRoot, 'docs/comparison/method.md'),
    'utf8'
  );
  assert.match(method, /five of Media\s+Chrome's seven controls/);
});
