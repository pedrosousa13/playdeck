#!/usr/bin/env node
// Keeps the docs' code examples honest: every `ts`/`tsx`/`css` block inside an
// `example:` marker is generated from a real file in `examples/`. The ts/tsx
// ones are compiled by the `examples` tsconfig project against the built
// declarations; the css ones are mounted by the story they document, which
// imports the same file with Vite's `?raw`. Prose and code cannot drift,
// because the code is not written in the prose.
//
// `?raw` and not `?inline`, deliberately: a production Storybook build runs
// `?inline` css through the minifier, so the story's docs page would print the
// example as one comment-less line while the fence generated here kept the
// readable source. `?raw` is unprocessed, which is what keeps the two surfaces
// byte-identical. Do not "fix" it back.

import { readFile, readdir, writeFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { fileURLToPath, URL } from 'node:url';
import ts from 'typescript';

const console = globalThis.console;
const process = globalThis.process;
const repoRoot = fileURLToPath(new URL('..', import.meta.url));

/**
 * @typedef {'ts' | 'tsx' | 'css'} Language
 * @typedef {{ source: string; language: Language }} Fixture
 */

/** @type {Record<string, Language>} */
const LANGUAGES = { '.ts': 'ts', '.tsx': 'tsx', '.css': 'css' };

// `.mdx` cannot carry HTML comments — MDX 2 parses them as JSX and fails — so
// the two syntaxes differ. Storybook's MDX is v3.
export const MARKERS = {
  md: {
    open: /^<!-- example:([a-z0-9-]+) -->$/,
    close: /^<!-- \/example -->$/,
    ignore: /^<!-- example:ignore\b.*-->$/
  },
  mdx: {
    open: /^\{\/\* example:([a-z0-9-]+) \*\/\}$/,
    close: /^\{\/\* \/example \*\/\}$/,
    ignore: /^\{\/\* example:ignore\b.*\*\/\}$/
  }
};

/**
 * The fixtures a directory listing holds, keyed by the name a marker carries.
 *
 * That name is the bare filename: `MARKERS` allows `[a-z0-9-]` only, so it can
 * hold neither an extension nor a directory, and `play-button.css` alongside a
 * `play-button.tsx` would otherwise be a silent last-one-wins. Two files that
 * would answer to one name is an error, which is what keeps the flat directory
 * safe now that it holds more than one language.
 * @param {readonly { file: string; source: string }[]} entries
 * @returns {Map<string, Fixture>}
 */
export const indexFixtures = (entries) => {
  /** @type {Map<string, Fixture>} */
  const fixtures = new Map();
  /** @type {Map<string, string>} */
  const files = new Map();

  for (const { file, source } of entries) {
    const language = LANGUAGES[extname(file)];
    if (!language) continue;
    const name = file.slice(0, -extname(file).length);
    const taken = files.get(name);
    if (taken !== undefined) {
      throw new Error(
        `examples/${taken} and examples/${file} would both answer to the marker example:${name}. Rename one.`
      );
    }
    files.set(name, file);
    fixtures.set(name, { source, language });
  }

  return fixtures;
};

/**
 * The sources of the fixtures the `examples` tsconfig project compiles.
 *
 * Export coverage is measured over these and not over every fixture: a
 * stylesheet is tokenised the same way, so a css file with the word `Poster` in
 * a comment would satisfy that export's coverage requirement while no example
 * that actually compiles uses it.
 * @param {Map<string, Fixture>} fixtures
 * @returns {string[]}
 */
export const compilingSources = (fixtures) =>
  [...fixtures.values()]
    .filter((fixture) => fixture.language !== 'css')
    .map((fixture) => fixture.source);

/**
 * The 1-based line numbers of `ts`/`tsx`/`css` fences that no `example:` region
 * generates and no `example:ignore` comment excuses.
 *
 * Without this, the gate only checks what is already inside a marker: a new
 * hand-written example added next to a generated one is backed by no file — so
 * nothing compiles it, nothing mounts it — and nothing complains. That is the
 * exact hole this whole mechanism exists to close, so an unmarked fence is a
 * failure and an exception has to say why.
 * @param {string} text
 * @param {'md' | 'mdx'} syntax
 * @returns {number[]}
 */
export const ungatedFences = (text, syntax) => {
  const marker = MARKERS[syntax];
  const lines = text.split('\n');
  /** @type {number[]} */
  const ungated = [];
  let inRegion = false;
  let excused = false;

  for (const [index, line] of lines.entries()) {
    if (marker.open.test(line)) inRegion = true;
    else if (marker.close.test(line)) inRegion = false;
    else if (marker.ignore.test(line)) excused = true;
    else if (/^```(tsx?|css)$/.test(line)) {
      if (!inRegion && !excused) ungated.push(index + 1);
      excused = false;
    }
  }

  return ungated;
};

/**
 * @param {string} text
 * @param {'md' | 'mdx'} syntax
 * @param {Map<string, Fixture>} fixtures
 * @returns {string}
 */
export const renderDoc = (text, syntax, fixtures) => {
  const marker = MARKERS[syntax];
  const lines = text.split('\n');
  /** @type {string[]} */
  const out = [];

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? '';
    const opened = marker.open.exec(line);
    if (!opened) {
      out.push(line);
      continue;
    }

    const name = opened[1] ?? '';
    const fixture = fixtures.get(name);
    if (!fixture) {
      throw new Error(
        `Marker example:${name} has no fixture named "${name}" in examples/.`
      );
    }

    const end = lines.findIndex(
      (candidate, at) => at > index && marker.close.test(candidate)
    );
    if (end === -1) {
      throw new Error(`Marker example:${name} is never closed.`);
    }

    out.push(
      line,
      '',
      `\`\`\`${fixture.language}`,
      fixture.source.trimEnd(),
      '```',
      '',
      lines[end] ?? ''
    );
    index = end;
  }

  return out.join('\n');
};

/**
 * The fixture names a document references, in order.
 * @param {string} text
 * @param {'md' | 'mdx'} syntax
 * @returns {string[]}
 */
export const markerNames = (text, syntax) =>
  text
    .split('\n')
    .map((line) => MARKERS[syntax].open.exec(line)?.[1])
    .filter((name) => name !== undefined);

/**
 * Whole-identifier matching, never substring: `Time` must not be satisfied by
 * the word "sometimes".
 * @param {Map<string, readonly string[]>} exportsByPackage
 * @param {readonly string[]} fixtureSources
 * @returns {{ package: string; name: string }[]}
 */
export const uncoveredExports = (exportsByPackage, fixtureSources) => {
  /** @type {Set<string>} */
  const tokens = new Set();
  for (const source of fixtureSources) {
    for (const token of source.match(/[A-Za-z_$][\w$]*/g) ?? []) {
      tokens.add(token);
    }
  }

  /** @type {{ package: string; name: string }[]} */
  const missing = [];
  for (const [pkg, names] of exportsByPackage) {
    for (const name of names) {
      if (!tokens.has(name)) missing.push({ package: pkg, name });
    }
  }
  return missing;
};

/** @type {readonly { name: string; entry: string }[]} */
const packages = [
  { name: '@reely/core', entry: 'packages/core/src/index.ts' },
  { name: '@reely/react', entry: 'packages/react/src/index.tsx' },
  {
    name: '@reely/provider-native',
    entry: 'packages/provider-native/src/index.ts'
  },
  { name: '@reely/provider-hls', entry: 'packages/provider-hls/src/index.ts' },
  {
    name: '@reely/provider-youtube',
    entry: 'packages/provider-youtube/src/index.ts'
  },
  {
    name: '@reely/provider-vimeo',
    entry: 'packages/provider-vimeo/src/index.ts'
  },
  {
    name: '@reely/provider-wistia',
    entry: 'packages/provider-wistia/src/index.ts'
  }
];

/**
 * The public VALUE exports of each package entry, resolved by the compiler
 * rather than grepped: `packages/react/src/index.tsx` re-exports the icon set
 * with `export *`, while `useActivation` and `loadProvider` are exported from
 * their own modules and deliberately absent from the public entry. A grep gets
 * both of those wrong, in opposite directions.
 * @returns {Map<string, readonly string[]>}
 */
export const publicValueExports = () => {
  const program = ts.createProgram(
    packages.map((pkg) => join(repoRoot, pkg.entry)),
    {
      ...ts.getDefaultCompilerOptions(),
      jsx: ts.JsxEmit.ReactJSX,
      allowJs: false
    }
  );
  const checker = program.getTypeChecker();

  /** @type {Map<string, readonly string[]>} */
  const result = new Map();
  for (const pkg of packages) {
    const file = program.getSourceFile(join(repoRoot, pkg.entry));
    if (!file) throw new Error(`Could not read ${pkg.entry}`);
    const symbol = checker.getSymbolAtLocation(file);
    if (!symbol) throw new Error(`${pkg.entry} is not a module`);
    result.set(
      pkg.name,
      checker
        .getExportsOfModule(symbol)
        .filter((exported) => {
          const flags =
            exported.flags & ts.SymbolFlags.Alias
              ? checker.getAliasedSymbol(exported).flags
              : exported.flags;
          return (flags & ts.SymbolFlags.Value) !== 0;
        })
        .map((exported) => exported.getName())
        .sort()
    );
  }
  return result;
};

// Explicit, not a glob: a glob would silently start gating a file nobody meant
// to gate, and silently stop gating one that was renamed.
/** @type {readonly string[]} */
const docs = [
  'README.md',
  'packages/core/README.md',
  'packages/react/README.md',
  'packages/provider-native/README.md',
  'packages/provider-hls/README.md',
  'packages/provider-youtube/README.md',
  'packages/provider-vimeo/README.md',
  'packages/provider-wistia/README.md',
  'docs/third-party-requests.md',
  'apps/storybook/stories/CapabilitiesMatrix.mdx',
  'apps/storybook/stories/Contract.mdx',
  'apps/storybook/stories/Theme.mdx'
];

/** @returns {Promise<Map<string, Fixture>>} */
const readFixtures = async () => {
  const dir = join(repoRoot, 'examples');
  const files = (await readdir(dir))
    .sort()
    .filter((file) => extname(file) in LANGUAGES);
  return indexFixtures(
    await Promise.all(
      files.map(async (file) => ({
        file,
        source: await readFile(join(dir, file), 'utf8')
      }))
    )
  );
};

const main = async () => {
  const check = process.argv.includes('--check');
  const fixtures = await readFixtures();
  if (fixtures.size === 0) {
    throw new Error(
      'No fixtures found in examples/ — refusing to blank the docs.'
    );
  }

  /** @type {string[]} */
  const drifted = [];
  /** @type {string[]} */
  const ungated = [];
  /** @type {Set<string>} */
  const referenced = new Set();
  for (const doc of docs) {
    const path = join(repoRoot, doc);
    const syntax = doc.endsWith('.mdx') ? 'mdx' : 'md';
    const before = await readFile(path, 'utf8');
    for (const name of markerNames(before, syntax)) referenced.add(name);
    for (const line of ungatedFences(before, syntax)) {
      ungated.push(`${doc}:${line}`);
    }
    const after = renderDoc(before, syntax, fixtures);
    if (before === after) continue;
    if (check) drifted.push(doc);
    else await writeFile(path, after);
  }

  // A fixture no document references is not documentation: it compiles, it
  // satisfies the export coverage below, and nobody ever reads it.
  const orphans = [...fixtures.keys()].filter((name) => !referenced.has(name));

  const uncovered = uncoveredExports(
    publicValueExports(),
    compilingSources(fixtures)
  );

  if (!check) {
    console.log(`Rewrote ${docs.length} docs from ${fixtures.size} fixtures.`);
  }
  if (
    drifted.length > 0 ||
    ungated.length > 0 ||
    orphans.length > 0 ||
    uncovered.length > 0
  ) {
    const reasons = [
      ...drifted.map(
        (doc) => `  ${doc} is out of date — run \`pnpm docs:examples\`.`
      ),
      ...ungated.map(
        (where) =>
          `  ${where} is a ts/tsx/css block no fixture generates — wrap it in an example: marker, or precede it with an example:ignore comment saying why not.`
      ),
      ...orphans.map(
        (name) =>
          `  examples/${name} is referenced by no doc — add an example:${name} marker, or delete it.`
      ),
      ...uncovered.map(
        ({ package: pkg, name }) =>
          `  ${pkg} exports \`${name}\`, which no fixture in examples/ uses.`
      )
    ];
    throw new Error(`Docs examples check failed:\n${reasons.join('\n')}`);
  }
};

// Only when run as a command. docs-examples.test.mjs imports this module for
// its pure functions, and importing it must not rewrite the docs.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    await main();
  } catch (error) {
    // Not every throw is an Error — a rejection carrying a string would
    // otherwise print an empty line and exit 1 with no reason given.
    console.error(
      `\n${error instanceof Error ? error.message : String(error)}`
    );
    process.exit(1);
  }
}
