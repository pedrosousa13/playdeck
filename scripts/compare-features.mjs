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
// each of the five libraries advertises about itself (never Playdeck's own
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
// installed package rather than trusting. Five kinds, matched to what a
// package can expose:
//
//   { kind: 'export',  module, name }           -- a named runtime export
//   { kind: 'file',     module, path, includes } -- a built file's own text
//   { kind: 'types',    module, path, includes } -- same check, over a .d.ts
//   { kind: 'package',  module, field }          -- a package.json field
//   { kind: 'absent',   module, name, path }     -- a name NOT in that file
//   { kind: 'absent',   module, field }          -- a package.json field NOT set
//
// A cell of 'yes', 'partial' or 'plugin' is anchored by one of the first
// four: something the installed package still has to say for itself. A cell
// of 'no' is anchored by 'absent', which the two forms above make into a
// check rather than an assertion -- "no export found" without one of these is
// exactly the bare impression #638 rules out. `file` and `types` run the same
// check; the kind is kept distinct because a reader scanning the source
// column benefits from knowing whether a claim rests on shipped code or on
// its type declarations.
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

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL, URL } from 'node:url';

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
  { name: 'Video.js', module: 'video.js' }
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
 * own condition list is longer; these four are the ones the four measured
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
 * file's header. Falls back to the package's `module` (ESM) or `main` (CJS)
 * field for the one measured package (`video.js`) whose `package.json` has no
 * `exports` map at all; that fallback only ever applies to the bare package
 * (subpath `.`), because a package with no `exports` map publishes no
 * subpaths for Node to resolve either.
 * @param {string} module
 * @param {{ repoRoot?: string; fixtureRoot?: string }} [roots] See `packageRoot`.
 * @returns {Promise<string>}
 */
export const resolveExport = async (module, roots = {}) => {
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
  const entry = manifest.module ?? manifest.main;
  if (entry === undefined) {
    throw new Error(
      `${module}'s package.json has no "exports", "module" or "main" field to resolve.`
    );
  }
  return join(root, entry);
};

/**
 * @typedef {{ kind: 'export'; module: string; name: string }} ExportAnchor
 * @typedef {{ kind: 'file' | 'types'; module: string; path: string; includes: string }} FileAnchor
 * @typedef {{ kind: 'package'; module: string; field: string }} PackageAnchor
 * @typedef {{ kind: 'absent'; module: string; name: string; path: string } | { kind: 'absent'; module: string; field: string }} AbsentAnchor
 * @typedef {ExportAnchor | FileAnchor | PackageAnchor | AbsentAnchor} Anchor
 */

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

  // anchor.kind === 'absent'
  if ('field' in anchor) {
    const manifest = await readJson(
      join(packageRoot(anchor.module, roots), 'package.json')
    );
    const value = walkField(manifest, anchor.field);
    return {
      holds: value === undefined,
      detail: `\`${anchor.module}\`'s \`package.json\` ${value === undefined ? 'has no' : 'declares'} \`${anchor.field}\``
    };
  }
  // Not narrowed automatically: `FileAnchor.kind` is itself a two-literal
  // union, and checkJs does not subtract it from `Anchor` just because both
  // of its literals were ruled out above. Everything else already has been.
  const nameAnchor =
    /** @type {{ kind: 'absent'; module: string; name: string; path: string }} */ (
      anchor
    );
  const text = await readFile(
    join(packageRoot(nameAnchor.module, roots), nameAnchor.path),
    'utf8'
  );
  const holds = !text.includes(nameAnchor.name);
  return {
    holds,
    detail: `\`${nameAnchor.module}\`'s \`${nameAnchor.path}\` ${holds ? 'has no' : 'has a'} \`${nameAnchor.name}\``
  };
};

/**
 * @typedef {{ status: 'yes' | 'partial' | 'no' | 'plugin'; anchor: Anchor; source: string; note?: string }} Cell
 * @typedef {{ id: string; label: string; entries: Record<string, Cell> }} Axis
 */

const STATUS_LABEL = /** @type {Record<Cell['status'], string>} */ ({
  yes: 'yes',
  partial: 'partial',
  no: 'no',
  plugin: 'plugin'
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
  if ('field' in anchor) {
    return `mechanical check: \`${anchor.module}\`'s \`package.json\` has no \`${anchor.field}\``;
  }
  // See the matching cast in `evaluateAnchor`: not narrowed automatically.
  const nameAnchor =
    /** @type {{ kind: 'absent'; module: string; name: string; path: string }} */ (
      anchor
    );
  return `mechanical check: \`${nameAnchor.module}\`'s \`${nameAnchor.path}\` has no \`${nameAnchor.name}\``;
};

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
        return `[^${n}]: **${axis.label} — ${column.name}**: ${STATUS_LABEL[cell.status]}.${note} ${describeAnchor(cell.anchor)}. Source: ${cell.source}`;
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
field, or a named absence. A claim whose anchor no longer holds fails
\`pnpm compare:features:check\` rather than sitting here stale.

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

const main = async () => {
  const check = process.argv.includes('--check');
  const { axes } = await loadFeatures();
  await verifyAllAnchors(axes, libraries);

  const versions = await Promise.all(
    libraries.map(async (library) => {
      const manifest = /** @type {{ version: string }} */ (
        await readJson(join(packageRoot(library.module), 'package.json'))
      );
      return { name: library.name, version: manifest.version };
    })
  );

  const footnoteNumber = footnoteNumbers(axes, libraries);
  const table = renderTable(axes, libraries, footnoteNumber);
  const footnotes = renderFootnotes(axes, libraries, footnoteNumber);
  const after = renderFeaturesDoc({
    date: new Date().toISOString().slice(0, 10),
    versions,
    table,
    footnotes
  });

  const path = join(repoRoot, FEATURES_PATH);
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
    if (maskVolatile(before) === maskVolatile(after)) {
      console.log(
        `${FEATURES_PATH} already matches a fresh check (ignoring the measurement date).`
      );
      return;
    }
    throw new Error(
      `${FEATURES_PATH} no longer matches a fresh check -- run \`pnpm compare:features\`.`
    );
  }

  if (before === after) {
    console.log(`${FEATURES_PATH} already matches a fresh check.`);
    return;
  }
  await mkdir(join(repoRoot, 'docs/comparison'), { recursive: true });
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
