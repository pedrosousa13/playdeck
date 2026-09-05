#!/usr/bin/env node
// Measures Playdeck against a named set of React video libraries and writes
// docs/comparison/results.md -- the harness issue #543 asks for: one command,
// numbers nobody typed, versions and a date checked in beside them.
//
// The maintainer ruling on #543 draws a hard line this file does not cross:
// no claim about another library reaches apps/site, and this script writes
// only to docs/, which the site's build never reads. What it measures, and
// why, is written out at length in docs/comparison/method.md -- this header
// covers how, not why.
//
// ---- what "gzipped bytes" means here --------------------------------------
//
// Every row is bundled from one entry file under tests/compare/entries/
// through the same `vite build`, with React, ReactDOM and the JSX runtime
// marked external for every one of them alike -- none of them is charged for
// a dependency every one of them equally requires a consumer to already
// have. `write: false` keeps the build in memory, the same way
// readme-bytes.mjs's `minifiedGzipKilobytes` does, so this never touches disk
// and never risks measuring a stale dist/ left over from a previous run.
// Two of the six rows are Playdeck, measuring the same entry point's worth of
// primitives at two different control-bar compositions -- see the
// `libraries` array below and docs/comparison/method.md's "Equivalent
// composition per library" for which of the two is the fair comparison for
// which other row.
//
// ---- the esbuild cross-check ------------------------------------------------
//
// Every row is also bundled a second time, independently, with `esbuild`
// (`bundleEntryEsbuild`, normalised into this file's own `Chunk` shape by
// `normalizeEsbuildOutputs`) -- the same entry, the same externals, the same
// `reachableChunks` rule, a different bundler and a different minifier.
// `results.md`'s "Gzipped (esbuild)" column is that second figure, printed
// beside Vite's rather than instead of it: two independent tools agreeing on
// a number is evidence the number belongs to the library being measured and
// not to a quirk of one harness's own bundler, which is what
// docs/comparison/method.md's "What is measured" argues at more length, and
// is also where every row's actual Vite/esbuild delta is accounted for.
//
// A build without `build.lib` is used deliberately, and not the lib-mode
// config every other measurement in this repo reaches for: lib mode exists to
// produce one publishable file per format, and every library measured here
// (Playdeck included) code-splits a real consumer's page across several files
// on its own -- Playdeck's native provider loads through a dynamic
// `import()`, and so do react-player's non-file providers and part of
// Vidstack's default layout. An ordinary app build is what preserves that
// split as separate Rollup chunks instead of flattening it into one file, and
// `reachableChunks` below is what turns the split back into a single figure
// without pretending the split does not exist.
//
// ---- what counts as "reachable" --------------------------------------------
//
// A build's `output` array (with `write: false`, kept in memory rather than
// written) mixes chunks a browser is guaranteed to fetch with chunks a
// dynamic `import()` only reaches under conditions this fixture may never
// meet -- an alternate provider, a caption file, a menu nobody opened. Gzipping
// every chunk regardless would answer "what does this library ship in total",
// which is a real question and not this one: the axis here is "one MP4 URL
// with default controls", so a chunk this fixture's fixed inputs cannot
// reach must not be charged to it.
//
// `reachableChunks` keeps two kinds of chunk: the entry's own static import
// closure -- what loads with no interaction and no dynamic import ever
// resolving -- and whatever a library's own `requiredChunk` predicate names as
// unavoidable for this fixture specifically, matched against the chunk's
// `moduleIds` (the absolute paths of every source module Rollup folded into
// it). Playdeck is the one library measured here whose provider is itself
// behind a dynamic import that this fixture cannot avoid resolving: something
// has to attach to the `<video>` element for the MP4 to play at all, and for
// this fixture that is always `@playdeck/provider-native`. The other four
// libraries need no such addition -- see each entry file's own header comment,
// and docs/comparison/method.md's "Equivalent composition" section, for the
// reachability call made for it and why.
//
// ---- how the total is added -------------------------------------------------
//
// Each reachable chunk is gzipped on its own and the byte counts are summed,
// not concatenated-then-gzipped-once. A browser fetches and decompresses
// separate chunks separately, so summing the separate gzip sizes is what a
// network panel would show downloading; gzipping the concatenation would
// under-count by however much cross-chunk repetition gzip's own dictionary
// buys back, which is exactly what no browser ever gets to spend. This is the
// same reason `bundle-budgets.mjs` and `readme-bytes.mjs` gzip one file at a
// time and add the results rather than gzipping a concatenation of packages.

import { build } from 'vite';
import react from '@vitejs/plugin-react';
import { gzipSync } from 'node:zlib';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { join, relative } from 'node:path';
import { fileURLToPath, URL } from 'node:url';

const console = globalThis.console;
const process = globalThis.process;

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const fixtureRoot = join(repoRoot, 'tests/compare');
const RESULTS_PATH = 'docs/comparison/results.md';

// esbuild is a devDependency of tests/compare, not of the repository root
// (deliberately -- see docs/comparison/method.md's "What is measured" for
// why a second bundler lives there and not here), so it resolves from
// tests/compare's own node_modules rather than from this file's. Resolved
// through tests/compare's package.json rather than imported by bare
// specifier for that reason: a bare `import 'esbuild'` from this file would
// walk up from scripts/, past tests/compare, to this repository's own
// node_modules, and fail to find it there.
const esbuild = await import(
  createRequire(join(fixtureRoot, 'package.json')).resolve('esbuild')
);

// Marked external for every library alike -- see the file header. `import()`
// still resolves these names at runtime in a real page because the consumer's
// own bundler provides them; Rollup here is told the same thing a real
// consumer's bundler would already know.
const REACT_EXTERNALS = [
  'react',
  'react-dom',
  'react-dom/client',
  'react/jsx-runtime'
];

/**
 * One bundler-agnostic chunk. `imports` and `dynamicImports` both name other
 * chunks by `fileName` (or an external specifier no chunk in the graph has,
 * which every reader here drops rather than resolves): Vite's own `OutputChunk`
 * already carries both under these names, so the Vite path uses it unchanged;
 * `normalizeEsbuildOutputs` builds the esbuild equivalent from its metafile,
 * splitting one `imports` array by `kind` into these same two.
 * @typedef {{
 *   fileName: string;
 *   code: string;
 *   isEntry: boolean;
 *   imports: readonly string[];
 *   dynamicImports: readonly string[];
 *   moduleIds: readonly string[];
 * }} Chunk
 */

/**
 * One compared library. `composition` is prose, not a measurement, printed
 * beside the figure so a reader knows what the number is the size of without
 * opening the entry file; `requiredChunk` is the reachability call described
 * in this file's header, made once here rather than re-argued at call sites.
 * @type {readonly {
 *   name: string;
 *   package: string;
 *   entry: string;
 *   composition: string;
 *   requiredChunk: (chunk: Chunk) => boolean;
 * }[]}
 */
export const libraries = [
  {
    name: 'Playdeck',
    package: '@playdeck/react',
    entry: 'entries/playdeck.tsx',
    composition: 'core + primitives + native provider',
    requiredChunk: (chunk) =>
      chunk.moduleIds.some((id) => id.includes('/provider-native/'))
  },
  {
    name: 'Playdeck (control bar)',
    package: '@playdeck/react',
    entry: 'entries/playdeck-control-bar.tsx',
    composition:
      "core + primitives + native provider + control bar (5 of Media Chrome's 7 controls)",
    requiredChunk: (chunk) =>
      chunk.moduleIds.some((id) => id.includes('/provider-native/'))
  },
  {
    name: 'react-player',
    package: 'react-player',
    entry: 'entries/react-player.tsx',
    composition: 'default export, `controls`, html5 fallback player',
    requiredChunk: () => false
  },
  {
    name: 'Vidstack',
    package: '@vidstack/react',
    entry: 'entries/vidstack.tsx',
    composition: 'MediaPlayer + MediaProvider + DefaultVideoLayout',
    requiredChunk: () => false
  },
  {
    name: 'Media Chrome',
    package: 'media-chrome',
    entry: 'entries/media-chrome.tsx',
    composition: 'MediaController + a 7-button control bar',
    requiredChunk: () => false
  },
  {
    name: 'Video.js',
    package: 'video.js',
    entry: 'entries/video-js.tsx',
    composition: 'videojs() with `controls: true`, hand-wrapped',
    requiredChunk: () => false
  }
];

/**
 * The chunks a browser is guaranteed to fetch to run one library's fixture:
 * the entry's own static import closure, plus the static closure of every
 * dynamic-import target reachable from there whose own closure contains a
 * chunk `isRequired` accepts. See this file's header for what "guaranteed"
 * is standing in for.
 *
 * The second half is not "every chunk `isRequired` accepts" on its own,
 * which is what an earlier version of this function did and which happened
 * to hold only because Vite's chunker gave Playdeck's native provider one
 * chunk that was both the dynamic-import target and the code. esbuild's
 * chunker does not: it split the same provider into a tiny shim chunk that is
 * the actual `import()` target (no module of its own, so `isRequired` never
 * matches it) and a separate shared chunk holding the real code (which
 * `isRequired` does match, but which nothing dynamically imports directly --
 * only the shim does, and only the shim's own static import reaches it). A
 * rule that added chunks by matching them in isolation would keep the code
 * chunk and drop the shim that is the only thing standing between the entry
 * and it, undercounting the figure by exactly the shim's weight. Walking
 * dynamic-import targets and testing -- then keeping -- their whole static
 * closure is what stays correct under either chunking shape.
 *
 * A candidate whose closure does not match `isRequired` contributes nothing
 * and is not searched further: nothing downstream of a chunk this fixture
 * never causes to load can load either, so its own dynamic imports (hls.js
 * behind Playdeck's HLS adapter, say) are correctly left unreached without
 * this function ever having to name them.
 *
 * `imports` and `dynamicImports` can each name an external specifier
 * (`"react"`) alongside chunk file names -- `byFile` simply has no entry for
 * those, and the walk drops them rather than needing to tell the two apart
 * itself.
 * @param {readonly Chunk[]} chunks
 * @param {(chunk: Chunk) => boolean} isRequired
 * @returns {Chunk[]}
 */
export const reachableChunks = (chunks, isRequired) => {
  const entry = chunks.find((chunk) => chunk.isEntry);
  if (!entry) {
    throw new Error('The build produced no entry chunk.');
  }
  const byFile = new Map(chunks.map((chunk) => [chunk.fileName, chunk]));

  /** @type {Map<string, Chunk>} */
  const reachable = new Map();

  /**
   * The static closure of `fileName`, over chunks not already in
   * `reachable` -- so a closure computed for one candidate never re-walks
   * ground an earlier, accepted candidate already covered.
   * @param {string} fileName
   * @returns {Map<string, Chunk>}
   */
  const staticClosure = (fileName) => {
    /** @type {Map<string, Chunk>} */
    const closure = new Map();
    /** @param {string} name */
    const visit = (name) => {
      if (closure.has(name) || reachable.has(name)) return;
      const chunk = byFile.get(name);
      if (!chunk) return;
      closure.set(name, chunk);
      for (const imported of chunk.imports) visit(imported);
    };
    visit(fileName);
    return closure;
  };

  /**
   * Whether loading `fileName` is what makes a chunk `isRequired` accepts
   * load: judged on the chunk's own `moduleIds` first, and looked through
   * only when it has none of its own -- a bundler's content-free re-export
   * shim, whose identity for this purpose is whatever real chunk it
   * statically wraps (esbuild splits Playdeck's native provider into exactly
   * such a shim plus a separate shared chunk holding its real code; Vite
   * does not, and gives the provider one chunk that is both).
   *
   * A chunk that DOES carry its own modules is judged on those alone and is
   * never followed into what it imports here. That is load-bearing and not
   * an optimisation: Playdeck's HLS adapter statically imports the native
   * provider's own chunk to reuse a helper from it, and an earlier version
   * of this function that tested a candidate's whole transitive closure
   * against `isRequired` -- rather than the candidate's own modules first --
   * accepted the HLS adapter on exactly that account, because the adapter it
   * never chooses shared an edge with the provider it does. Two sibling
   * dynamic imports sharing a static dependency is not enough on its own to
   * make either one required; only a chunk's own modules, or an empty
   * shim's one real target, say that.
   * @param {string} fileName
   * @param {Set<string>} [visited]
   * @returns {boolean}
   */
  const isEffectivelyRequired = (fileName, visited = new Set()) => {
    if (visited.has(fileName)) return false;
    visited.add(fileName);
    const chunk = byFile.get(fileName);
    if (!chunk) return false;
    if (chunk.moduleIds.length > 0) return isRequired(chunk);
    return chunk.imports.some((imported) =>
      isEffectivelyRequired(imported, visited)
    );
  };

  for (const [name, chunk] of staticClosure(entry.fileName)) {
    reachable.set(name, chunk);
  }

  /** @type {string[]} */
  const frontier = [];
  for (const chunk of reachable.values())
    frontier.push(...chunk.dynamicImports);

  const decided = new Set();
  while (frontier.length > 0) {
    const target = /** @type {string} */ (frontier.shift());
    if (decided.has(target) || reachable.has(target)) continue;
    decided.add(target);

    if (!isEffectivelyRequired(target)) continue;

    for (const [name, chunk] of staticClosure(target)) {
      reachable.set(name, chunk);
      frontier.push(...chunk.dynamicImports);
    }
  }

  return [...reachable.values()];
};

/**
 * The complement of `reachableChunks`: every chunk the same build produced
 * that this fixture's fixed inputs cannot reach. This is what the results
 * table's "Not counted" column measures, from the same build the "Gzipped"
 * column comes from rather than a second one -- see
 * `docs/comparison/method.md` for what each library's excluded chunks
 * actually are, read from their `moduleIds` and code on the measurement
 * date.
 * @param {readonly Chunk[]} chunks
 * @param {(chunk: Chunk) => boolean} isRequired
 * @returns {Chunk[]}
 */
export const excludedChunks = (chunks, isRequired) => {
  const kept = new Set(
    reachableChunks(chunks, isRequired).map((chunk) => chunk.fileName)
  );
  return chunks.filter((chunk) => !kept.has(chunk.fileName));
};

/**
 * The sum of each chunk's own gzip size -- see the file header for why this
 * is a sum of separate gzips and not one gzip of the concatenation.
 * @param {readonly Chunk[]} chunks
 * @returns {number}
 */
export const gzipBytes = (chunks) =>
  chunks.reduce((sum, chunk) => sum + gzipSync(chunk.code).length, 0);

/**
 * @param {string} entryRelativePath Relative to tests/compare.
 * @returns {Promise<Chunk[]>}
 */
const bundleEntryVite = async (entryRelativePath) => {
  const result = await build({
    configFile: false,
    logLevel: 'silent',
    root: fixtureRoot,
    plugins: [react()],
    build: {
      write: false,
      sourcemap: false,
      emptyOutDir: false,
      rollupOptions: {
        input: join(fixtureRoot, entryRelativePath),
        external: REACT_EXTERNALS
      }
    }
  });
  const bundles = Array.isArray(result) ? result : [result];
  // Rollup's own `OutputChunk` already carries `fileName`, `code`, `isEntry`,
  // `imports`, `dynamicImports` and `moduleIds` under exactly these names, so
  // it is used as this file's `Chunk` unchanged -- unlike the esbuild path
  // below, which builds one because esbuild's metafile does not already
  // shape it this way.
  const chunks = bundles.flatMap((bundle) =>
    'output' in bundle
      ? bundle.output.flatMap((item) => (item.type === 'chunk' ? [item] : []))
      : []
  );
  if (chunks.length === 0) {
    throw new Error(
      `Building ${entryRelativePath} produced no chunk. Check that the entry still exists and still exports something a bundler cannot tree-shake away.`
    );
  }
  return chunks;
};

/**
 * @typedef {{ entryPoint?: string; imports: readonly { path: string; kind: string }[]; inputs: Record<string, unknown> }} EsbuildOutputMeta
 */

/**
 * esbuild's metafile plus the code of each output it names, turned into this
 * file's bundler-agnostic `Chunk` shape. Pure and independently testable,
 * deliberately taking the metafile and a `fileName -> code` map rather than
 * an esbuild `BuildResult` -- a test supplies a small fixture of both without
 * invoking esbuild at all, the same way this file's Vite-shaped tests never
 * call `vite build`.
 *
 * The only reasoning applied is splitting one esbuild `imports` array by
 * `kind` into two: `'import-statement'` entries become `imports`,
 * `'dynamic-import'` entries become `dynamicImports`. Everything downstream
 * -- `reachableChunks`, `excludedChunks`, `gzipBytes` -- reads the result
 * exactly as it reads a Vite chunk, which is the whole point of normalising
 * here rather than teaching those functions a second shape.
 *
 * Non-JS outputs (esbuild can emit a `.css` bundle alongside the JS one) are
 * dropped: neither bundler's byte figure counts CSS -- see
 * `docs/comparison/method.md`'s "What is measured".
 * @param {Record<string, EsbuildOutputMeta>} outputs `metafile.outputs`, keyed by output path.
 * @param {Record<string, string>} codeByOutput Each of those same keys mapped to its bundled code.
 * @param {string} entryOutput The key in `outputs` that is the entry chunk.
 * @returns {Chunk[]}
 */
export const normalizeEsbuildOutputs = (outputs, codeByOutput, entryOutput) =>
  Object.entries(outputs)
    .filter(([fileName]) => fileName.endsWith('.js'))
    .map(([fileName, meta]) => ({
      fileName,
      code: codeByOutput[fileName] ?? '',
      isEntry: fileName === entryOutput,
      imports: meta.imports
        .filter((imported) => imported.kind === 'import-statement')
        .map((imported) => imported.path),
      dynamicImports: meta.imports
        .filter((imported) => imported.kind === 'dynamic-import')
        .map((imported) => imported.path),
      moduleIds: Object.keys(meta.inputs)
    }));

/**
 * @param {string} entryRelativePath Relative to tests/compare.
 * @returns {Promise<Chunk[]>}
 */
const bundleEntryEsbuild = async (entryRelativePath) => {
  const entryAbsolute = join(fixtureRoot, entryRelativePath);
  const result = await esbuild.build({
    entryPoints: [entryAbsolute],
    bundle: true,
    splitting: true,
    format: 'esm',
    minify: true,
    write: false,
    metafile: true,
    outdir: 'out',
    jsx: 'automatic',
    absWorkingDir: fixtureRoot,
    external: REACT_EXTERNALS,
    logLevel: 'silent'
  });

  /** @type {Record<string, string>} */
  const codeByOutput = {};
  for (const file of result.outputFiles) {
    if (!file.path.endsWith('.js')) continue;
    codeByOutput[relative(fixtureRoot, file.path)] = file.text;
  }

  const entryInput = relative(fixtureRoot, entryAbsolute);
  const entryOutput = Object.entries(result.metafile.outputs).find(
    ([, meta]) => meta.entryPoint === entryInput
  )?.[0];
  if (entryOutput === undefined) {
    throw new Error(
      `Building ${entryRelativePath} with esbuild produced no output whose entryPoint is ${entryInput}.`
    );
  }

  const chunks = normalizeEsbuildOutputs(
    result.metafile.outputs,
    codeByOutput,
    entryOutput
  );
  if (chunks.length === 0) {
    throw new Error(
      `Building ${entryRelativePath} with esbuild produced no chunk.`
    );
  }
  return chunks;
};

/**
 * The version a library was measured at, read from its own installed
 * `package.json` rather than typed here -- the same refusal
 * `readme-bytes.mjs`'s `pinnedVersion` makes, for the same reason: a stale
 * install must not bake a figure for one version under another's name.
 * `tests/compare/package.json` pins every compared library to an exact
 * version (no `^`), so equality is the whole test; Playdeck's own
 * `workspace:*` pin names no version to check against; and reports the
 * installed one as-is.
 * @param {string} packageName
 * @param {string | undefined} declared
 * @param {string} installed
 * @returns {string}
 */
export const pinnedVersion = (packageName, declared, installed) => {
  if (declared === undefined) {
    throw new Error(
      `tests/compare/package.json no longer pins ${packageName}. Add it back, or drop the library from scripts/compare-libraries.mjs.`
    );
  }
  if (declared.startsWith('workspace:')) return installed;
  if (declared !== installed) {
    throw new Error(
      `${packageName} is installed at ${installed} but tests/compare/package.json pins ${declared}. Run \`pnpm install\` before measuring.`
    );
  }
  return installed;
};

/** @param {number} bytes @returns {string} */
export const kb = (bytes) => (bytes / 1024).toFixed(2);

/**
 * The "Not counted" cell for one row: how many chunks the build produced
 * that `reachableChunks` did not count, and their combined gzip size. `"0"`
 * on its own, not `"0 chunks, 0.00 KB"`, for the four libraries this fixture
 * excludes nothing from -- a bare zero is the whole answer there, and
 * spelling out a size for a set of zero chunks would read as a figure that
 * was measured rather than a count that was.
 * @param {number} count
 * @param {number} bytes
 * @returns {string}
 */
export const notCounted = (count, bytes) =>
  count === 0
    ? '0'
    : `${count} chunk${count === 1 ? '' : 's'}, ${kb(bytes)} KB`;

/**
 * esbuild's figure relative to Vite's for one row: `(esbuild - Vite) / Vite`,
 * signed and rounded to one decimal place. Generated so that the story
 * `docs/comparison/method.md` tells about the two bundlers agreeing, or not,
 * cites a number `pnpm compare:libraries:check` actually enforces rather
 * than one typed into prose the check cannot see -- see that document's
 * "Cross-checked with a second bundler" section, which names this column
 * rather than restating its own figures.
 * @param {number} viteBytes
 * @param {number} esbuildBytes
 * @returns {string}
 */
export const delta = (viteBytes, esbuildBytes) => {
  const percent = ((esbuildBytes - viteBytes) / viteBytes) * 100;
  return `${percent >= 0 ? '+' : ''}${percent.toFixed(1)}%`;
};

/**
 * `bytes` is Vite's figure and `esbuildBytes` is esbuild's, over the same
 * reachability rule applied to each bundler's own chunk graph -- see
 * `docs/comparison/method.md`'s "What is measured" for why a second, wholly
 * independent bundler is run over every row rather than trusted on Vite's
 * say-so alone.
 * @typedef {{
 *   name: string;
 *   version: string;
 *   composition: string;
 *   bytes: number;
 *   esbuildBytes: number;
 *   notCountedChunks: number;
 *   notCountedBytes: number;
 * }} Row
 */

/**
 * The table, padded the way Prettier pads a markdown table -- see
 * `readme-bytes.mjs`'s `renderTable` for why: emitting it any other way would
 * leave `pnpm format:check` and this generator undoing each other's work
 * forever.
 * @param {readonly Row[]} rows
 * @returns {string}
 */
export const renderTable = (rows) => {
  const header = [
    'Library',
    'Version',
    'Composition measured',
    'Gzipped (Vite)',
    'Gzipped (esbuild)',
    'Delta',
    'Not counted'
  ];
  const body = rows.map(
    ({
      name,
      version,
      composition,
      bytes,
      esbuildBytes,
      notCountedChunks,
      notCountedBytes
    }) => [
      name,
      version,
      composition,
      `${kb(bytes)} KB`,
      `${kb(esbuildBytes)} KB`,
      delta(bytes, esbuildBytes),
      notCounted(notCountedChunks, notCountedBytes)
    ]
  );
  const widths = header.map((_, column) =>
    Math.max(
      header[column]?.length ?? 0,
      ...body.map((cells) => cells[column]?.length ?? 0)
    )
  );
  /** @param {readonly string[]} cells */
  const line = (cells) =>
    `| ${cells.map((cell, column) => cell.padEnd(widths[column] ?? 0)).join(' | ')} |`;

  return [
    line(header),
    line(widths.map((width) => '-'.repeat(width))),
    ...body.map(line)
  ].join('\n');
};

/**
 * The whole generated file. A date and a Node version the caller passes in
 * rather than ones this function reads for itself, so the render stays pure
 * and testable: the same inputs always produce the same document, which is
 * what the determinism check relies on. `--check` additionally tolerates
 * both of those two tokens differing on their own -- see `maskVolatile` and
 * this script's `main` for why: a gate that fails on the calendar, or on
 * which Node this happens to run under, is a gate nobody can keep green, and
 * neither is what "re-running on unchanged inputs produces the same numbers"
 * asks for. The Vite and esbuild versions are not masked: both are pinned
 * inputs read from the lockfile, not facts about the machine running the
 * check.
 * @param {{ date: string; nodeVersion: string; viteVersion: string; esbuildVersion: string; rows: readonly Row[] }} data
 * @returns {string}
 */
export const renderResultsDoc = ({
  date,
  nodeVersion,
  viteVersion,
  esbuildVersion,
  rows
}) =>
  `<!--
  Generated by \`pnpm compare:libraries\`. Do not edit by hand -- rerun the
  command instead, and see docs/comparison/method.md for what each column
  means, what is not counted, and why.
-->

# React video library comparison: measured figures

Measured ${date} on Node ${nodeVersion}, Vite ${viteVersion}, esbuild
${esbuildVersion}, from \`tests/compare\`'s pinned installs. React, ReactDOM
and the JSX runtime are marked external for every library alike and excluded
from every figure below. "Gzipped (Vite)" and "Gzipped (esbuild)" are each the
sum of each reachable chunk's own gzip size from that bundler's own build, not
one gzip of their concatenation -- see \`scripts/compare-libraries.mjs\`'s
header for why, and its "What is measured" entry in \`docs/comparison/method.md\`
for what the two bundlers agreeing, or not, is evidence of. "Delta" is
esbuild's figure relative to Vite's, signed and rounded to one decimal.
"Not counted" is the chunks the Vite build produced but this fixture's fixed
inputs cannot reach, gzipped the same way -- see
\`docs/comparison/method.md\` for what each library's excluded chunks are.

${renderTable(rows)}

Regenerate with \`pnpm compare:libraries\` -- run \`pnpm build\` first; a
stale \`dist/\` changes Playdeck's rows and nothing else. The date above
records when this file was last regenerated; \`pnpm compare:libraries:check\`
does not police how old it is, only whether the figures, versions and
compositions below still match a fresh run. Re-run the command above to
bring the date current.
`;

/**
 * A rendered document with its "Measured <date> on Node <version>" line's
 * date and Node version both replaced by fixed placeholders, so two renders
 * taken on different days, or produced by different Node installs, compare
 * equal wherever every other line already does. Only \`--check\` reaches for
 * this: the write path in \`main\` below still stamps the real date and the
 * real \`process.version\` whenever it writes, and this is what keeps
 * \`--check\` from failing on the two tokens that are expected to move
 * between runs on otherwise unchanged inputs -- CI runs a different Node
 * minor than a local checkout does, and both must read as the same document.
 * The Vite version stays comparable: it is resolved from the lockfile this
 * repository pins, not from the machine the check happens to run on.
 * @param {string} doc
 * @returns {string}
 */
export const maskVolatile = (doc) =>
  doc.replace(
    /Measured \d{4}-\d{2}-\d{2} on Node v\d+\.\d+\.\d+,/,
    'Measured <date> on Node <node-version>,'
  );

/**
 * The minimal line-level difference between two documents, as an LCS
 * (longest common subsequence) diff: a line present only in `before` is
 * prefixed `-`, a line present only in `after` is prefixed `+`, and a line
 * identical in both is omitted. LCS rather than a positional
 * (line-by-line-at-the-same-index) comparison because this file's table is
 * padded to the widest cell in each column -- one figure gaining a digit can
 * shift every cell in that column, and a positional diff would then report
 * every row as different instead of naming the one figure that actually
 * changed.
 * @param {string} before
 * @param {string} after
 * @returns {string[]}
 */
export const lineDiff = (before, after) => {
  const a = before.split('\n');
  const b = after.split('\n');
  const n = a.length;
  const m = b.length;

  /** @type {number[][]} */
  const lcs = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i][j] =
        a[i] === b[j]
          ? (lcs[i + 1]?.[j + 1] ?? 0) + 1
          : Math.max(lcs[i + 1]?.[j] ?? 0, lcs[i]?.[j + 1] ?? 0);
    }
  }

  /** @type {string[]} */
  const out = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      i += 1;
      j += 1;
      continue;
    }
    if ((lcs[i + 1]?.[j] ?? 0) >= (lcs[i]?.[j + 1] ?? 0)) {
      out.push(`- ${a[i]}`);
      i += 1;
    } else {
      out.push(`+ ${b[j]}`);
      j += 1;
    }
  }
  while (i < n) {
    out.push(`- ${a[i]}`);
    i += 1;
  }
  while (j < m) {
    out.push(`+ ${b[j]}`);
    j += 1;
  }
  return out;
};

/** @param {string} path @returns {Promise<Record<string, unknown>>} */
const readJson = async (path) =>
  JSON.parse(await readFile(join(repoRoot, path), 'utf8'));

/**
 * @returns {Promise<{ date: string; nodeVersion: string; viteVersion: string; esbuildVersion: string; rows: Row[] }>}
 */
const measure = async () => {
  const manifest = /** @type {{ devDependencies?: Record<string, string> }} */ (
    await readJson('tests/compare/package.json')
  );
  const viteManifest = /** @type {{ version: string }} */ (
    await readJson('node_modules/vite/package.json')
  );
  const esbuildInstalled = /** @type {{ version: string }} */ (
    await readJson('tests/compare/node_modules/esbuild/package.json')
  ).version;
  const esbuildVersion = pinnedVersion(
    'esbuild',
    manifest.devDependencies?.esbuild,
    esbuildInstalled
  );

  /** @type {Row[]} */
  const rows = [];
  for (const library of libraries) {
    const chunks = await bundleEntryVite(library.entry);
    const reachable = reachableChunks(chunks, library.requiredChunk);
    const bytes = gzipBytes(reachable);
    const excluded = excludedChunks(chunks, library.requiredChunk);

    const esbuildChunks = await bundleEntryEsbuild(library.entry);
    const esbuildBytes = gzipBytes(
      reachableChunks(esbuildChunks, library.requiredChunk)
    );

    const installed = /** @type {{ version: string }} */ (
      await readJson(
        `tests/compare/node_modules/${library.package}/package.json`
      )
    ).version;
    const version = pinnedVersion(
      library.package,
      manifest.devDependencies?.[library.package],
      installed
    );
    rows.push({
      name: library.name,
      version,
      composition: library.composition,
      bytes,
      esbuildBytes,
      notCountedChunks: excluded.length,
      notCountedBytes: gzipBytes(excluded)
    });
  }

  return {
    date: new Date().toISOString().slice(0, 10),
    esbuildVersion,
    nodeVersion: process.version,
    viteVersion: viteManifest.version,
    rows
  };
};

const main = async () => {
  const check = process.argv.includes('--check');
  const data = await measure();
  const after = renderResultsDoc(data);
  const path = join(repoRoot, RESULTS_PATH);

  let before = '';
  try {
    before = await readFile(path, 'utf8');
  } catch (error) {
    if (
      !(error instanceof Error) ||
      /** @type {NodeJS.ErrnoException} */ (error).code !== 'ENOENT'
    ) {
      throw error;
    }
  }

  if (check) {
    const maskedBefore = maskVolatile(before);
    const maskedAfter = maskVolatile(after);
    if (maskedBefore === maskedAfter) {
      console.log(
        `${RESULTS_PATH} already matches a fresh run (ignoring the measurement date and Node version).`
      );
      return;
    }
    // Printed before the error below, not folded into its message: a thrown
    // Error's message is one line by convention elsewhere in this repo's
    // gate scripts, and the diff can be many.
    for (const line of lineDiff(maskedBefore, maskedAfter)) {
      console.error(line);
    }
    throw new Error(
      `${RESULTS_PATH} no longer matches a fresh measurement -- run \`pnpm compare:libraries\`.`
    );
  }

  if (before === after) {
    console.log(`${RESULTS_PATH} already matches a fresh run.`);
    return;
  }
  await mkdir(join(repoRoot, 'docs/comparison'), { recursive: true });
  await writeFile(path, after);
  console.log(`Wrote ${RESULTS_PATH} from a fresh measurement.`);
};

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    await main();
  } catch (error) {
    console.error(
      `\n${error instanceof Error ? error.message : String(error)}`
    );
    process.exit(1);
  }
}
