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
// Every library is bundled from one entry file under tests/compare/entries/
// through the same `vite build`, with React, ReactDOM and the JSX runtime
// marked external for every one of them alike -- none of the five libraries
// is charged for a dependency every one of them equally requires a consumer
// to already have. `write: false` keeps the build in memory, the same way
// readme-bytes.mjs's `minifiedGzipKilobytes` does, so this never touches disk
// and never risks measuring a stale dist/ left over from a previous run.
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
import { join } from 'node:path';
import { fileURLToPath, URL } from 'node:url';

const console = globalThis.console;
const process = globalThis.process;

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const fixtureRoot = join(repoRoot, 'tests/compare');
const RESULTS_PATH = 'docs/comparison/results.md';

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
 * @typedef {{
 *   fileName: string;
 *   code: string;
 *   isEntry: boolean;
 *   imports: readonly string[];
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
 * the entry's own static import closure, plus every chunk `isRequired`
 * accepts. See this file's header for what "guaranteed" is standing in for.
 *
 * `imports` can name an external specifier (`"react"`) alongside chunk file
 * names -- `byFile` simply has no entry for those, and the walk drops them
 * rather than needing to tell the two apart itself.
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

  /** @type {Set<string>} */
  const reachable = new Set();
  /** @param {string} fileName */
  const visitStatic = (fileName) => {
    if (reachable.has(fileName)) return;
    const chunk = byFile.get(fileName);
    if (!chunk) return;
    reachable.add(fileName);
    for (const imported of chunk.imports) visitStatic(imported);
  };
  visitStatic(entry.fileName);

  for (const chunk of chunks) {
    if (isRequired(chunk)) reachable.add(chunk.fileName);
  }

  return [...reachable].map((fileName) => {
    const chunk = byFile.get(fileName);
    if (!chunk) throw new Error(`Unreachable: ${fileName} has no chunk.`);
    return chunk;
  });
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
const bundleEntry = async (entryRelativePath) => {
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
 * @typedef {{ name: string; version: string; composition: string; bytes: number }} Row
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
  const header = ['Library', 'Version', 'Composition measured', 'Gzipped'];
  const body = rows.map(({ name, version, composition, bytes }) => [
    name,
    version,
    composition,
    `${kb(bytes)} KB`
  ]);
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
 * The whole generated file. A date the caller passes in rather than one this
 * function reads for itself, so the render stays pure and testable: the same
 * inputs always produce the same document, which is what `--check` and the
 * determinism check both rely on. A date that has simply gone stale since the
 * file was last generated is meant to fail `--check` -- see this script's
 * `main` for why that is a feature and not a bug here.
 * @param {{ date: string; nodeVersion: string; viteVersion: string; rows: readonly Row[] }} data
 * @returns {string}
 */
export const renderResultsDoc = ({ date, nodeVersion, viteVersion, rows }) =>
  `<!--
  Generated by \`pnpm compare:libraries\`. Do not edit by hand -- rerun the
  command instead, and see docs/comparison/method.md for what each column
  means, what is not counted, and why.
-->

# React video library comparison: measured figures

Measured ${date} on Node ${nodeVersion}, Vite ${viteVersion}, from
\`tests/compare\`'s pinned installs. React, ReactDOM and the JSX runtime are
marked external for every library alike and excluded from every figure below.
"Gzipped" is the sum of each reachable chunk's own gzip size, not one gzip of
their concatenation -- see \`scripts/compare-libraries.mjs\`'s header for why.

${renderTable(rows)}

Regenerate with \`pnpm compare:libraries\`. \`pnpm compare:libraries:check\`
fails if this file no longer matches a fresh run, which includes the date
above going stale -- an undated benchmark is a claim with an expiry date
(\`docs/agents/comments.md\`), and a dated one that nobody has re-run since is
not much better.
`;

/** @param {string} path @returns {Promise<Record<string, unknown>>} */
const readJson = async (path) =>
  JSON.parse(await readFile(join(repoRoot, path), 'utf8'));

/**
 * @returns {Promise<{ date: string; nodeVersion: string; viteVersion: string; rows: Row[] }>}
 */
const measure = async () => {
  const manifest = /** @type {{ devDependencies?: Record<string, string> }} */ (
    await readJson('tests/compare/package.json')
  );
  const viteManifest = /** @type {{ version: string }} */ (
    await readJson('node_modules/vite/package.json')
  );

  /** @type {Row[]} */
  const rows = [];
  for (const library of libraries) {
    const chunks = await bundleEntry(library.entry);
    const bytes = gzipBytes(reachableChunks(chunks, library.requiredChunk));
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
      bytes
    });
  }

  return {
    date: new Date().toISOString().slice(0, 10),
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

  if (before === after) {
    if (!check) console.log(`${RESULTS_PATH} already matches a fresh run.`);
    return;
  }
  if (check) {
    throw new Error(
      `${RESULTS_PATH} no longer matches a fresh measurement -- run \`pnpm compare:libraries\`.`
    );
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
