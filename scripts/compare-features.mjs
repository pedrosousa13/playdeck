#!/usr/bin/env node
// Compares Playdeck against the same libraries scripts/compare-libraries.mjs
// bundles, but on features rather than bytes -- issue #638. Bytes come out of
// a bundler; features do not, so this file's whole job is refusing the
// "impression" that would otherwise fill that gap. Every cell in
// docs/comparison/features.md is a claim `tests/compare/features.mjs` makes in
// writing, with a mechanical anchor this script re-checks on every run --
// never a summary of what this script itself observed while measuring.
//
// The maintainer ruling repeated on #638 is "make sure data is 100% correct
// and bias free", made concrete two ways: the axis list is the UNION of what
// each compared library advertises about itself (never Playdeck's own
// feature list, which would make the table an argument for Playdeck before a
// reader reaches row one), and every cell traces to something this script can
// re-verify against the installed package, never a paraphrase of a doc page
// nobody re-reads. `docs/comparison/method.md`'s "Features" section explains
// the axis list's construction and every axis that was tried and dropped;
// this header covers only how the check runs.
//
// ---- anchors -----------------------------------------------------------
//
// `tests/compare/features.mjs` encodes each axis as data, not prose: one
// entry per library, each an anchor this script evaluates against the
// installed package rather than trusting. The kinds, matched to what a
// package can expose:
//
//   { kind: 'export',   module, name }            -- a named runtime export
//   { kind: 'file',     module, path, includes }  -- a built file's own text
//   { kind: 'types',    module, path, includes }  -- same check, over a .d.ts
//   { kind: 'package',  module, field }           -- a package.json field
//   { kind: 'absent',   module, field }           -- a package.json field NOT set
//   { kind: 'absent-in-tree', module, glob, includes? }
//                                                 -- a token in NO file the
//                                                    glob matches, or (with no
//                                                    `includes`) no matching
//                                                    file at all
//   { kind: 'imports-in-node', module, expect }   -- importing the package in
//                                                    plain Node, no DOM
//
// A cell of 'yes', 'partial' or 'plugin' is anchored by one of the first
// four: something the installed package still has to say for itself. `file`
// and `types` run the same check; the kind is kept distinct because a reader
// scanning the source column benefits from knowing whether a claim rests on
// shipped code or on its type declarations.
//
// ---- why 'absent-in-tree' and not a single-file grep ----------------------
//
// A cell of 'no' is anchored by an absence, and an absence is only worth as
// much as the ground it was searched over. An earlier version of this data
// searched one file per `no` cell, which made the standard of evidence differ
// by column without saying so: video.js's `no` cells were checked against its
// whole 700 KB bundle, while several of Media Chrome's and Vidstack's were
// checked against a barrel `index.d.ts` that is a list of import names and
// nothing else -- a file the searched-for token could not have appeared in
// whatever the library did. `absent-in-tree` removes that difference: it
// walks every file a glob matches under the package and holds only if the
// token is in none of them, so a `no` costs the same evidence in every
// column, Playdeck's included. It refuses to hold vacuously in the other
// direction too: a glob that matches no file at all throws rather than
// reporting an absence nobody searched for.
//
// With no `includes`, the anchor's claim is the glob's own emptiness -- "this
// package ships no file matching this pattern" -- which is what a cell like
// "ships no stylesheet of its own" actually rests on.
//
// ---- why 'imports-in-node' -----------------------------------------------
//
// SSR is the one axis where a text search cannot answer the question it is
// standing in for. Reading one library's shipped code for a `"use client"`
// string and another's for an `isServer` helper is two different questions
// wearing one axis label, and the answers are not comparable. This anchor
// asks the property directly and identically for every column: import the
// package in this plain Node process, which has no `window` and no
// `document`, and record either that it loaded or the error it threw.
//
// `module` is resolved two ways. A `@playdeck/*` package is this repository's
// own workspace source: `packages/<name>` relative to the repo root, built by
// `pnpm build` like every other measurement here needs it to be. Everything
// else resolves under `tests/compare/node_modules/<module>` -- literally, by
// joining the path, the same fixture scripts/compare-libraries.mjs bundles
// from, so a feature claim and a byte figure are read from the same install.
// `module` may carry a subpath (`media-chrome/react`,
// `@vidstack/react/player/layouts/default`) for a package whose feature lives
// behind one; `resolveExport` below walks that package's own `exports` map
// (or its `module`/`main` field, for the one measured package with no
// `exports` map at all) to find the file a bare `import()` of that specifier
// would actually resolve to, rather than this script guessing a dist path
// only the package's own map is the source of truth for.
//
// ---- why this fails loudly ----------------------------------------------
//
// A cell that says 'yes' and stays 'yes' after the library removes the export
// it names is the one failure mode this entire design exists to prevent --
// see the issue's own framing, "a stale 'yes'". So every anchor in
// `tests/compare/features.mjs` is evaluated on every run, `main` refuses to
// write `docs/comparison/features.md` if even one does not hold, and the
// message names every failing axis and library at once rather than the
// first: one library's version bump can move several axes in the same run,
// and finding that out one `pnpm compare:features` at a time is the slow way.

import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL, URL } from 'node:url';

import { lineDiff } from './line-diff.mjs';

const console = globalThis.console;
const process = globalThis.process;

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const fixtureRoot = join(repoRoot, 'tests/compare');
const FEATURES_PATH = 'docs/comparison/features.md';

/**
 * One compared library, in the column order `results.md` already uses.
 * `module` is what `packageRoot` below resolves to a directory, and `version`
 * is read from that directory's own `package.json` -- never typed here --
 * for the same reason `compare-libraries.mjs`'s `pinnedVersion` reads
 * installed versions rather than trusting a manifest: a stale install must
 * not bake a figure, or here a claim, for one version under another's name.
 * @type {readonly { name: string; module: string }[]}
 */
export const libraries = [
  { name: 'Playdeck', module: '@playdeck/react' },
  { name: 'react-player', module: 'react-player' },
  { name: 'Vidstack', module: '@vidstack/react' },
  { name: 'Media Chrome', module: 'media-chrome' },
  { name: 'Video.js', module: 'video.js' },
  { name: 'Video.js 10 (beta)', module: '@videojs/react' }
];

/**
 * The directory a bare `import()` of `module` resolves packages from --
 * never a specific file, so every anchor kind can join its own `path` (or, for
 * `export`, its own subpath resolution) onto the same root. See this file's
 * header for why `@playdeck/*` and everything else resolve differently.
 *
 * `roots` is a seam for `compare-features.test.mjs` alone: production code
 * never passes it, so every call resolves against this repository's real
 * `packages/` and `tests/compare/node_modules/`, and the tests that do pass
 * it point both at a temporary directory shaped like this repository instead
 * of needing a real install to exercise the resolution logic.
 * @param {string} module A bare specifier, optionally with a subpath
 * (`media-chrome/react`).
 * @param {{ repoRoot?: string; fixtureRoot?: string }} [roots]
 * @returns {string}
 */
export const packageRoot = (module, roots = {}) => {
  const repo = roots.repoRoot ?? repoRoot;
  const fixture = roots.fixtureRoot ?? fixtureRoot;
  if (module.startsWith('@playdeck/')) {
    return join(repo, 'packages', module.slice('@playdeck/'.length));
  }
  const scoped = module.startsWith('@');
  const segments = module.split('/');
  const name = scoped ? segments.slice(0, 2).join('/') : (segments[0] ?? '');
  return join(fixture, 'node_modules', name);
};

/**
 * The subpath of `module` past its package name -- `.` for the package
 * itself, `./react` for `media-chrome/react`. What `resolveExport` looks up
 * in that package's own `exports` map.
 * @param {string} module
 * @returns {string}
 */
const subpathOf = (module) => {
  const scoped = module.startsWith('@');
  const segments = module.split('/');
  const rest = segments.slice(scoped ? 2 : 1);
  return rest.length === 0 ? '.' : `./${rest.join('/')}`;
};

/** @param {string} path @returns {Promise<Record<string, unknown>>} */
const readJson = async (path) => JSON.parse(await readFile(path, 'utf8'));

/**
 * One condition tree from a package's `exports` map, walked to a file. Node's
 * own condition list is longer; these four are the ones the measured
 * packages' own maps actually use (`import`/`default` for the ordinary case,
 * `require` for a CJS-only reader, `node` as one more common fallback), tried
 * in the order a bundler resolving an ordinary `import` would prefer them.
 * Recurses because a condition can itself hold another condition object
 * (`@playdeck/react`'s `"import": { "types": ..., "default": ... }`) rather
 * than a bare file string.
 * @param {unknown} node
 * @returns {string | undefined}
 */
const pickCondition = (node) => {
  if (typeof node === 'string') return node;
  if (node == null || typeof node !== 'object') return undefined;
  const record = /** @type {Record<string, unknown>} */ (node);
  for (const condition of ['import', 'default', 'node', 'require']) {
    if (condition in record) {
      const picked = pickCondition(record[condition]);
      if (picked !== undefined) return picked;
    }
  }
  return undefined;
};

/**
 * The file a bare `import(module)` resolves to, read from the package's own
 * `exports` map rather than a dist path this script guesses at -- see this
 * file's header. Falls back to one of the package's own top-level entry
 * fields for the one measured package (`video.js`) whose `package.json` has
 * no `exports` map at all; that fallback only ever applies to the bare
 * package (subpath `.`), because a package with no `exports` map publishes no
 * subpaths for Node to resolve either.
 *
 * `fallbackFields` is which of those top-level fields to try, in order, and
 * it is a parameter rather than a constant because the two callers are asking
 * two different questions. A bundler prefers `module` (the ESM build) and
 * falls back to `main`, which is what every anchor that reads shipped code
 * wants. Node itself has no `module` condition at all and reads `main` only,
 * which is what `resolveForNode` -- and so the `imports-in-node` anchor --
 * has to follow if its answer is to be about the package rather than about
 * this script's own preferences. For `video.js` the two differ: `module` is
 * `dist/video.es.js`, whose extensionless `import 'global/window'` only a
 * bundler resolves, and `main` is the CJS build Node actually loads.
 * @param {string} module
 * @param {{ repoRoot?: string; fixtureRoot?: string }} [roots] See `packageRoot`.
 * @param {readonly ('module' | 'main')[]} [fallbackFields]
 * @returns {Promise<string>}
 */
export const resolveExport = async (
  module,
  roots = {},
  fallbackFields = ['module', 'main']
) => {
  const root = packageRoot(module, roots);
  const subpath = subpathOf(module);
  const manifest =
    /** @type {{ exports?: unknown; module?: string; main?: string }} */ (
      await readJson(join(root, 'package.json'))
    );

  if (manifest.exports && typeof manifest.exports === 'object') {
    const exportsMap = /** @type {Record<string, unknown>} */ (
      manifest.exports
    );
    const direct = exportsMap[subpath];
    if (direct !== undefined) {
      const resolved = pickCondition(direct);
      if (resolved !== undefined) return join(root, resolved);
    }
    for (const [pattern, value] of Object.entries(exportsMap)) {
      const star = pattern.indexOf('*');
      if (star === -1) continue;
      const prefix = pattern.slice(0, star);
      const suffix = pattern.slice(star + 1);
      if (!subpath.startsWith(prefix) || !subpath.endsWith(suffix)) continue;
      const captured = subpath.slice(
        prefix.length,
        subpath.length - suffix.length
      );
      const template = pickCondition(value);
      if (template !== undefined) {
        return join(root, template.replace('*', captured));
      }
    }
    throw new Error(
      `${module}'s package.json exports no subpath matching "${subpath}".`
    );
  }

  if (subpath !== '.') {
    throw new Error(
      `${module} has no "exports" map, so its only resolvable specifier is the bare package -- not "${subpath}".`
    );
  }
  const entry = fallbackFields
    .map((field) => manifest[field])
    .find((value) => value !== undefined);
  if (entry === undefined) {
    throw new Error(
      `${module}'s package.json has no "exports" map and none of ${fallbackFields.map((field) => `"${field}"`).join(', ')} to resolve.`
    );
  }
  return join(root, entry);
};

/**
 * The file Node itself loads for `import(module)`: the same `exports` walk,
 * but falling back to `main` alone, never `module`. See `resolveExport`'s
 * `fallbackFields` for why the distinction is load-bearing rather than
 * pedantic.
 * @param {string} module
 * @param {{ repoRoot?: string; fixtureRoot?: string }} [roots] See `packageRoot`.
 * @returns {Promise<string>}
 */
export const resolveForNode = async (module, roots = {}) =>
  resolveExport(module, roots, ['main']);

/**
 * One glob pattern as a regular expression over a `/`-separated relative
 * path. Deliberately small: `**` crosses directory boundaries, `*` does not,
 * and everything else is literal. That is the whole vocabulary
 * `tests/compare/features.mjs` uses (`dist/**\/*.d.ts`, `**\/*.css`), and a
 * fuller glob dialect here would be code no anchor exercises.
 * @param {string} pattern
 * @returns {RegExp}
 */
export const globToRegExp = (pattern) => {
  let source = '';
  for (let index = 0; index < pattern.length; index += 1) {
    const character = pattern[index];
    if (character === '*') {
      if (pattern[index + 1] === '*') {
        // `**/` also matches zero directories, so `dist/**/*.js` matches
        // `dist/index.js` as well as `dist/react/index.js`.
        if (pattern[index + 2] === '/') {
          source += '(?:[^/]+/)*';
          index += 2;
        } else {
          source += '.*';
          index += 1;
        }
      } else {
        source += '[^/]*';
      }
      continue;
    }
    source += character.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${source}$`);
};

/**
 * Every file under `root` whose path relative to it matches one of
 * `patterns`, as relative `/`-separated paths, sorted so a failure message
 * names the same file on every run. `node_modules` is never descended into: a
 * package's own nested install is a different package's shipped code, and
 * charging it to this one would be the opposite of the evidentiary standard
 * `absent-in-tree` exists to hold.
 * @param {string} root
 * @param {readonly string[]} patterns
 * @returns {Promise<string[]>}
 */
export const matchingFiles = async (root, patterns) => {
  const expressions = patterns.map(globToRegExp);
  /** @type {string[]} */
  const found = [];
  /** @param {string} relativeDir */
  const walk = async (relativeDir) => {
    const entries = await readdir(join(root, relativeDir), {
      withFileTypes: true
    });
    for (const entry of entries) {
      if (entry.name === 'node_modules') continue;
      const relativePath = relativeDir
        ? `${relativeDir}/${entry.name}`
        : entry.name;
      if (entry.isDirectory()) {
        await walk(relativePath);
        continue;
      }
      if (!entry.isFile()) continue;
      if (expressions.some((expression) => expression.test(relativePath))) {
        found.push(relativePath);
      }
    }
  };
  await walk('');
  return found.sort();
};

/**
 * @typedef {{ kind: 'export'; module: string; name: string }} ExportAnchor
 * @typedef {{ kind: 'file' | 'types'; module: string; path: string; includes: string }} FileAnchor
 * @typedef {{ kind: 'package'; module: string; field: string }} PackageAnchor
 * @typedef {{ kind: 'absent'; module: string; field: string }} AbsentFieldAnchor
 * @typedef {{ kind: 'absent-in-tree'; module: string | readonly string[]; glob: string | readonly string[]; includes?: string }} AbsentInTreeAnchor
 * @typedef {{ kind: 'imports-in-node'; module: string; expect: 'imports' | 'throws' }} ImportsInNodeAnchor
 * @typedef {ExportAnchor | FileAnchor | PackageAnchor | AbsentFieldAnchor | AbsentInTreeAnchor | ImportsInNodeAnchor} Anchor
 */

/**
 * An `absent-in-tree` anchor's `glob` as a list -- one pattern or several,
 * written whichever way reads better at the call site.
 * @param {AbsentInTreeAnchor} anchor
 * @returns {readonly string[]}
 */
const globList = (anchor) =>
  typeof anchor.glob === 'string' ? [anchor.glob] : anchor.glob;

/**
 * An `absent-in-tree` anchor's `module` as a list. More than one is what a
 * claim about Playdeck needs: a consumer installs `@playdeck/react` and gets
 * `@playdeck/core` with it, so "Playdeck has no X" is only searched where a
 * reader would look for X if it were only searched in both.
 * @param {AbsentInTreeAnchor} anchor
 * @returns {readonly string[]}
 */
const moduleList = (anchor) =>
  typeof anchor.module === 'string' ? [anchor.module] : anchor.module;

/** @param {readonly string[]} globs @returns {string} */
const describeGlobs = (globs) =>
  globs.map((glob) => `\`${glob}\``).join(' or ');

/** @param {readonly string[]} modules @returns {string} */
const describeModules = (modules) =>
  modules.map((module) => `\`${module}\``).join(' and ');

/**
 * A dotted path (`peerDependencies.react`) walked through a plain object,
 * stopping at the first missing segment.
 * @param {Record<string, unknown>} object
 * @param {string} field
 * @returns {unknown}
 */
const walkField = (object, field) =>
  field.split('.').reduce(
    /** @param {unknown} value @param {string} key */
    (value, key) =>
      value != null && typeof value === 'object'
        ? /** @type {Record<string, unknown>} */ (value)[key]
        : undefined,
    /** @type {unknown} */ (object)
  );

/**
 * One anchor, checked against the installed package and reduced to whether it
 * holds plus a human-readable reason -- the reason is what a failure message
 * and a footnote both print, so it is worded as a fact about the check
 * ("exports X") rather than about the cell ("is yes").
 * @param {Anchor} anchor
 * @param {{ repoRoot?: string; fixtureRoot?: string }} [roots] See `packageRoot`.
 * @returns {Promise<{ holds: boolean; detail: string }>}
 */
export const evaluateAnchor = async (anchor, roots = {}) => {
  if (anchor.kind === 'export') {
    const entry = await resolveExport(anchor.module, roots);
    const namespace = /** @type {Record<string, unknown>} */ (
      await import(pathToFileURL(entry).href)
    );
    const holds =
      anchor.name in namespace && namespace[anchor.name] !== undefined;
    return {
      holds,
      detail: `\`${anchor.module}\` ${holds ? 'exports' : 'does not export'} \`${anchor.name}\``
    };
  }

  if (anchor.kind === 'file' || anchor.kind === 'types') {
    const text = await readFile(
      join(packageRoot(anchor.module, roots), anchor.path),
      'utf8'
    );
    const holds = text.includes(anchor.includes);
    return {
      holds,
      detail: `\`${anchor.module}\`'s \`${anchor.path}\` ${holds ? 'includes' : 'does not include'} \`${anchor.includes}\``
    };
  }

  if (anchor.kind === 'package') {
    const manifest = await readJson(
      join(packageRoot(anchor.module, roots), 'package.json')
    );
    const value = walkField(manifest, anchor.field);
    return {
      holds: value !== undefined,
      detail: `\`${anchor.module}\`'s \`package.json\` ${value === undefined ? 'has no' : 'declares'} \`${anchor.field}\`${value === undefined ? '' : ` (\`${JSON.stringify(value)}\`)`}`
    };
  }

  if (anchor.kind === 'absent') {
    const manifest = await readJson(
      join(packageRoot(anchor.module, roots), 'package.json')
    );
    const value = walkField(manifest, anchor.field);
    return {
      holds: value === undefined,
      detail: `\`${anchor.module}\`'s \`package.json\` ${value === undefined ? 'has no' : 'declares'} \`${anchor.field}\``
    };
  }

  if (anchor.kind === 'imports-in-node') {
    const entry = await resolveForNode(anchor.module, roots);
    /** @type {string | undefined} */
    let thrown;
    try {
      await import(pathToFileURL(entry).href);
    } catch (error) {
      thrown =
        error instanceof Error ? error.message.split('\n')[0] : String(error);
    }
    const imported = thrown === undefined;
    return {
      holds: imported === (anchor.expect === 'imports'),
      detail: imported
        ? `\`${anchor.module}\` imports in plain Node with no DOM globals`
        : `\`${anchor.module}\` throws when imported in plain Node with no DOM globals: ${thrown}`
    };
  }

  // anchor.kind === 'absent-in-tree'
  const treeAnchor = /** @type {AbsentInTreeAnchor} */ (
    /** @type {unknown} */ (anchor)
  );
  const globs = globList(treeAnchor);
  const modules = moduleList(treeAnchor);
  const named = describeModules(modules);
  /** @type {{ module: string; root: string; file: string }[]} */
  const files = [];
  for (const module of modules) {
    const root = packageRoot(module, roots);
    for (const file of await matchingFiles(root, globs)) {
      files.push({ module, root, file });
    }
  }

  if (treeAnchor.includes === undefined) {
    return {
      holds: files.length === 0,
      detail: `${named} ships ${files.length === 0 ? 'no file' : `${files.length} file${files.length === 1 ? '' : 's'}`} matching ${describeGlobs(globs)}`
    };
  }

  // A glob that matches nothing would make every token "absent" from it --
  // the vacuous hold this anchor kind exists to rule out. See the file
  // header.
  if (files.length === 0) {
    throw new Error(
      `${modules.join(' and ')} have no file matching ${globs.join(' or ')}, so an absence found in them would be an absence nobody searched for.`
    );
  }

  /** @type {{ module: string; file: string } | undefined} */
  let hit;
  for (const found of files) {
    const text = await readFile(join(found.root, found.file), 'utf8');
    if (text.includes(treeAnchor.includes)) {
      hit = found;
      break;
    }
  }
  return {
    holds: hit === undefined,
    detail:
      hit === undefined
        ? `none of ${named}'s ${files.length} file${files.length === 1 ? '' : 's'} matching ${describeGlobs(globs)} contains \`${treeAnchor.includes}\``
        : `\`${hit.module}\`'s \`${hit.file}\` contains \`${treeAnchor.includes}\``
  };
};

/**
 * @typedef {{ name: string; repository: string; provenance: 'org-published' | 'third-party' } | { name: string; repository: null }} PluginProvenance
 * @typedef {{ status: 'yes' | 'partial' | 'no' | 'plugin' | 'n/a'; anchor: Anchor; source: string; note?: string; plugin?: PluginProvenance }} Cell
 * @typedef {{ id: string; label: string; entries: Record<string, Cell> }} Axis
 */

/**
 * The status vocabulary, defined once here and at length in
 * `docs/comparison/method.md`'s "Features" section, so a reader and this
 * generator cannot drift apart on what a cell means:
 *
 * - `yes`     -- the library ships a ready-made UI part for this axis.
 * - `partial` -- the library exposes the axis in its own API or state, but
 *                ships no UI part to drive it, or its UI part covers only
 *                some of the axis. It never encodes provider-specific
 *                unavailability: that a YouTube iframe cannot enter
 *                picture-in-picture is true of every library that embeds
 *                one, so it belongs in the cell's note, in every column
 *                alike.
 * - `no`      -- neither, and an absence this generator checked.
 * - `plugin`  -- only through a documented plugin outside the package, whose
 *                own npm `repository` owner the cell records.
 * - `n/a`     -- the axis cannot apply to this library at all, with the note
 *                saying why. Distinct from `no`, which is a library that
 *                could have shipped the thing and did not.
 */
const STATUS_LABEL = /** @type {Record<Cell['status'], string>} */ ({
  yes: 'yes',
  partial: 'partial',
  no: 'no',
  plugin: 'plugin',
  'n/a': 'n/a'
});

/**
 * The table, padded the way every other generator in this repository pads a
 * markdown table -- see `readme-bytes.mjs`'s `renderTable` for why: emitting
 * it any other way would leave `pnpm format:check` and this generator undoing
 * each other's work forever. Cells carry a footnote marker rather than the
 * anchor itself, so the table stays scannable and every claim still has a
 * citation directly below it.
 * @param {readonly Axis[]} axes
 * @param {readonly { name: string }[]} columns
 * @param {(axisId: string, libraryName: string) => number} footnoteNumber
 * @returns {string}
 */
export const renderTable = (axes, columns, footnoteNumber) => {
  const header = ['Axis', ...columns.map((c) => c.name)];
  const body = axes.map((axis) => [
    axis.label,
    ...columns.map((column) => {
      const cell = axis.entries[column.name];
      if (!cell) {
        throw new Error(`${axis.id} has no entry for ${column.name}.`);
      }
      const n = footnoteNumber(axis.id, column.name);
      return `${STATUS_LABEL[cell.status]}[^${n}]`;
    })
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
 * Anchor kinds in words, for a footnote's citation line -- what a reader
 * cannot get from the table cell alone.
 * @param {Anchor} anchor
 * @returns {string}
 */
export const describeAnchor = (anchor) => {
  if (anchor.kind === 'export') {
    return `mechanical check: \`${anchor.module}\` exports \`${anchor.name}\``;
  }
  if (anchor.kind === 'file' || anchor.kind === 'types') {
    return `mechanical check: \`${anchor.module}\`'s \`${anchor.path}\` includes \`${anchor.includes}\``;
  }
  if (anchor.kind === 'package') {
    return `mechanical check: \`${anchor.module}\`'s \`package.json\` declares \`${anchor.field}\``;
  }
  if (anchor.kind === 'absent') {
    return `mechanical check: \`${anchor.module}\`'s \`package.json\` has no \`${anchor.field}\``;
  }
  if (anchor.kind === 'imports-in-node') {
    return `mechanical check: importing \`${anchor.module}\` in plain Node, with no DOM globals, ${anchor.expect === 'imports' ? 'succeeds' : 'throws'}`;
  }
  // See the matching cast in `evaluateAnchor`: not narrowed automatically.
  const treeAnchor = /** @type {AbsentInTreeAnchor} */ (
    /** @type {unknown} */ (anchor)
  );
  const globs = globList(treeAnchor);
  const named = describeModules(moduleList(treeAnchor));
  return treeAnchor.includes === undefined
    ? `mechanical check: ${named} ships no file matching ${describeGlobs(globs)}`
    : `mechanical check: no file of ${named} matching ${describeGlobs(globs)} contains \`${treeAnchor.includes}\``;
};

/**
 * A `plugin` cell's provenance, in one sentence and one vocabulary for every
 * column: the plugin's name, the owner of the GitHub repository its own npm
 * manifest points at, and one of two words derived from that owner -- never
 * an adjective ("official", "community") a reader cannot check. Where the
 * published manifest has no `repository` field at all, that is what the
 * footnote says, rather than a guess at who stands behind it.
 * @param {PluginProvenance} plugin
 * @returns {string}
 */
export const describePlugin = (plugin) =>
  plugin.repository === null
    ? `Plugin \`${plugin.name}\`: its published npm manifest declares no \`repository\` field, so no owner is recorded here.`
    : `Plugin \`${plugin.name}\`: npm \`repository\` ${plugin.repository}, ${plugin.provenance}.`;

/**
 * The footnotes list, one entry per cell, in the same order the table numbers
 * them.
 * @param {readonly Axis[]} axes
 * @param {readonly { name: string }[]} columns
 * @param {(axisId: string, libraryName: string) => number} footnoteNumber
 * @returns {string}
 */
export const renderFootnotes = (axes, columns, footnoteNumber) =>
  axes
    .flatMap((axis) =>
      columns.map((column) => {
        const cell = axis.entries[column.name];
        const n = footnoteNumber(axis.id, column.name);
        const note = cell.note ? ` ${cell.note}` : '';
        const provenance = cell.plugin ? ` ${describePlugin(cell.plugin)}` : '';
        return `[^${n}]: **${axis.label} — ${column.name}**: ${STATUS_LABEL[cell.status]}.${note}${provenance} ${describeAnchor(cell.anchor)}. Source: ${cell.source}`;
      })
    )
    .join('\n\n');

/**
 * Assigns each (axis, library) pair a stable footnote number, in table
 * (row-major) order -- the order `renderTable` and `renderFootnotes` both
 * walk, so number N in the table is footnote N below it.
 * @param {readonly Axis[]} axes
 * @param {readonly { name: string }[]} columns
 * @returns {(axisId: string, libraryName: string) => number}
 */
export const footnoteNumbers = (axes, columns) => {
  /** @type {Map<string, number>} */
  const numbers = new Map();
  let n = 0;
  for (const axis of axes) {
    for (const column of columns) {
      n += 1;
      numbers.set(`${axis.id} ${column.name}`, n);
    }
  }
  return (axisId, libraryName) => {
    const found = numbers.get(`${axisId} ${libraryName}`);
    if (found === undefined) {
      throw new Error(`No footnote assigned for ${axisId} / ${libraryName}.`);
    }
    return found;
  };
};

/**
 * The whole generated file.
 * @param {{ date: string; versions: readonly { name: string; version: string }[]; table: string; footnotes: string }} data
 * @returns {string}
 */
export const renderFeaturesDoc = ({ date, versions, table, footnotes }) =>
  `<!--
  Generated by \`pnpm compare:features\`. Do not edit by hand -- rerun the
  command instead, and see docs/comparison/method.md's "Features" section for
  how the axis list was built and why each dropped axis was dropped.
-->

# React video library comparison: features

This table is **sourced and checked, not measured**: unlike
\`docs/comparison/results.md\`, which puts every library through the same
bundler and reads a number back, nothing here comes out of a build. Every cell
is a claim \`tests/compare/features.mjs\` makes in writing, anchored to
something this script re-verifies against the installed package on every run
-- an export, a line in a shipped file, a type declaration, a \`package.json\`
field, a token found in none of the files a glob matches across the package,
or importing the package in plain Node with no DOM globals. A claim whose
anchor no longer holds fails \`pnpm compare:features:check\` rather than
sitting here stale.

A cell reads \`yes\` where the library ships a ready-made UI part for that
axis, \`partial\` where it exposes the axis in its own API or state with no UI
part to drive it, \`no\` where it does neither, \`plugin\` where a documented
plugin outside the package is the answer, and \`n/a\` where the axis cannot
apply to that library at all. A status never encodes which of a library's
providers can do the thing -- a YouTube iframe cannot enter picture-in-picture
under any of these libraries -- so that limit is written in the footnote
instead, for every column alike. \`docs/comparison/method.md\`'s "Features"
section has the full rule.

Measured ${date} against \`tests/compare\`'s pinned installs:
${versions.map((v) => `\`${v.name}\` ${v.version}`).join(', ')}.

${table}

${footnotes}

Regenerate with \`pnpm compare:features\`. \`pnpm compare:features:check\` fails
if a fresh check of every anchor in \`tests/compare/features.mjs\` would
produce a different table than the one above; it does not police how old the
date on this file is on its own.
`;

/**
 * A rendered document with its "Measured <date>" line's date replaced by a
 * fixed placeholder -- see \`compare-libraries.mjs\`'s \`maskVolatile\` for why:
 * two renders taken on different days must compare equal wherever every other
 * line already does, so \`--check\` never fails purely because the calendar
 * moved.
 * @param {string} doc
 * @returns {string}
 */
export const maskVolatile = (doc) =>
  doc.replace(/Measured \d{4}-\d{2}-\d{2} against/, 'Measured <date> against');

/**
 * @returns {Promise<{ axes: readonly Axis[] }>}
 */
const loadFeatures = async () => {
  const module = /** @type {{ axes?: readonly Axis[] }} */ (
    await import(pathToFileURL(join(fixtureRoot, 'features.mjs')).href)
  );
  if (!module.axes) {
    throw new Error('tests/compare/features.mjs does not export `axes`.');
  }
  return { axes: module.axes };
};

/**
 * Every anchor in every axis, evaluated. Throws one error naming every axis
 * and library whose anchor did not hold, rather than the first -- see this
 * file's header for why.
 * @param {readonly Axis[]} axes
 * @param {readonly { name: string }[]} columns
 * @param {{ repoRoot?: string; fixtureRoot?: string }} [roots] See `packageRoot`.
 * @returns {Promise<void>}
 */
export const verifyAllAnchors = async (axes, columns, roots = {}) => {
  /** @type {string[]} */
  const failures = [];
  for (const axis of axes) {
    for (const column of columns) {
      const cell = axis.entries[column.name];
      if (!cell) {
        failures.push(`  ${axis.id} / ${column.name}: no entry.`);
        continue;
      }
      if (cell.status === 'plugin' && !cell.plugin) {
        failures.push(
          `  ${axis.id} / ${column.name}: a 'plugin' cell must carry \`plugin\` provenance.`
        );
      }
      if (cell.status === 'n/a' && !cell.note) {
        failures.push(
          `  ${axis.id} / ${column.name}: an 'n/a' cell must carry a \`note\` saying why the axis does not apply.`
        );
      }
      try {
        const { holds, detail } = await evaluateAnchor(cell.anchor, roots);
        if (!holds) {
          failures.push(
            `  ${axis.id} / ${column.name}: anchor does not hold -- ${detail}.`
          );
        }
      } catch (error) {
        failures.push(
          `  ${axis.id} / ${column.name}: anchor threw -- ${error instanceof Error ? error.message : String(error)}`
        );
      }
    }
  }
  if (failures.length > 0) {
    throw new Error(
      `${failures.length} anchor${failures.length === 1 ? '' : 's'} in tests/compare/features.mjs no longer hold:\n${failures.join('\n')}`
    );
  }
};

/**
 * The two environment variables that exist for `compare-features.test.mjs`
 * alone, and are never set by `pnpm compare:features` or by CI. Together they
 * let a test exercise the one path no unit test of a pure function can reach
 * -- the CLI's own exit code and printed diff when the checked-in document is
 * stale -- in milliseconds:
 *
 *   PLAYDECK_COMPARE_DOC   read and write this file instead of the
 *                          checked-in `docs/comparison/features.md`.
 *   PLAYDECK_COMPARE_STUB  skip loading and evaluating every anchor, and
 *                          render one fixed axis instead.
 *
 * The alternative was a test that evaluates every anchor in
 * `tests/compare/features.mjs`, which reads several thousand files across six
 * installed packages and a `packages/*\/dist` the `static` CI job -- the one
 * that runs `pnpm test:audit-unit` -- never builds. That test would be slow
 * where it ran at all, and would be measuring the anchors rather than this
 * file's exit path.
 * @returns {{ docPath: string; stub: boolean }}
 */
const testSeam = () => ({
  docPath: process.env.PLAYDECK_COMPARE_DOC ?? join(repoRoot, FEATURES_PATH),
  stub: process.env.PLAYDECK_COMPARE_STUB !== undefined
});

/**
 * One axis and one column, with an anchor nothing evaluates. See `testSeam`.
 * @returns {{ axes: readonly Axis[]; columns: readonly { name: string; module: string }[]; versions: readonly { name: string; version: string }[] }}
 */
const stubFeatures = () => ({
  axes: [
    {
      id: 'stub',
      label: 'A fixed axis, checked by nothing',
      entries: {
        Stub: {
          status: /** @type {const} */ ('yes'),
          anchor: /** @type {const} */ ({
            kind: 'export',
            module: 'stub',
            name: 'Stub'
          }),
          source: 'nothing was read'
        }
      }
    }
  ],
  columns: [{ name: 'Stub', module: 'stub' }],
  versions: [{ name: 'Stub', version: '0.0.0' }]
});

const main = async () => {
  const check = process.argv.includes('--check');
  const { docPath, stub } = testSeam();

  const { axes, columns, versions } = stub
    ? stubFeatures()
    : await (async () => {
        const loaded = await loadFeatures();
        await verifyAllAnchors(loaded.axes, libraries);
        return {
          axes: loaded.axes,
          columns: libraries,
          versions: await Promise.all(
            libraries.map(async (library) => {
              const manifest = /** @type {{ version: string }} */ (
                await readJson(
                  join(packageRoot(library.module), 'package.json')
                )
              );
              return { name: library.name, version: manifest.version };
            })
          )
        };
      })();

  const footnoteNumber = footnoteNumbers(axes, columns);
  const table = renderTable(axes, columns, footnoteNumber);
  const footnotes = renderFootnotes(axes, columns, footnoteNumber);
  const after = renderFeaturesDoc({
    date: new Date().toISOString().slice(0, 10),
    versions,
    table,
    footnotes
  });

  const path = docPath;
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
        `${FEATURES_PATH} already matches a fresh check (ignoring the measurement date).`
      );
      return;
    }
    // Printed before the error below, not folded into its message, for the
    // reason `compare-libraries.mjs` gives at the same point: a thrown
    // Error's message is one line by convention in this repo's gate scripts,
    // and the diff can be many.
    for (const line of lineDiff(maskedBefore, maskedAfter)) {
      console.error(line);
    }
    throw new Error(
      `${FEATURES_PATH} no longer matches a fresh check -- run \`pnpm compare:features\`.`
    );
  }

  if (before === after) {
    console.log(`${FEATURES_PATH} already matches a fresh check.`);
    return;
  }
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, after);
  console.log(`Wrote ${FEATURES_PATH} from a fresh check.`);
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
