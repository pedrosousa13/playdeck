// @vitest-environment node
// Reads source files off disk and runs the compiler over them, so it needs a
// real `import.meta.url` path — which happy-dom's global `URL` cannot give.

import { readFile } from 'node:fs/promises';
import { fileURLToPath, URL } from 'node:url';
import ts from 'typescript';
import { expect, test } from 'vitest';

// `package.json`'s `exports` map offers `dist/index.d.ts` and nothing else, so
// a type that only `loader.ts` exports is a type no consumer can import — and
// neither `pnpm typecheck` nor `pnpm docs:check` notices, because both gaps
// are type-only and the docs export-coverage gate measures value exports.
// Round 1 shipped exactly that: ten event types exported from `loader.ts`,
// absent from the entry, and documented in the README as though they were
// public. Both sets below are derived; a list written down here would just be
// the copy that drifts next.
//
// The compiler rather than a regex, for the same reason
// `scripts/docs-examples.mjs` uses it: `export type { A, B } from './x.js'`,
// `export type A = …` and an aliased re-export are three different syntaxes
// for one fact, and only the checker reads all three the same way.

const sourcePath = (file: string): string =>
  fileURLToPath(new URL(`../src/${file}`, import.meta.url));

const entryPath = sourcePath('index.ts');
const loaderPath = sourcePath('loader.ts');

const program = ts.createProgram([entryPath, loaderPath], {
  ...ts.getDefaultCompilerOptions(),
  moduleResolution: ts.ModuleResolutionKind.Bundler,
  module: ts.ModuleKind.ESNext,
  target: ts.ScriptTarget.ES2022,
  skipLibCheck: true
});
const checker = program.getTypeChecker();

type Exported = { readonly name: string; readonly isValue: boolean };

const exportsOf = (path: string): readonly Exported[] => {
  const file = program.getSourceFile(path);
  if (!file) throw new Error(`Could not read ${path}`);
  const symbol = checker.getSymbolAtLocation(file);
  if (!symbol) throw new Error(`${path} is not a module`);
  return checker.getExportsOfModule(symbol).map((exported) => {
    const flags =
      exported.flags & ts.SymbolFlags.Alias
        ? checker.getAliasedSymbol(exported).flags
        : exported.flags;
    return {
      name: exported.getName(),
      isValue: (flags & ts.SymbolFlags.Value) !== 0
    };
  });
};

const entryExports = new Set(exportsOf(entryPath).map(({ name }) => name));

test('the package entry re-exports every type the loader declares', () => {
  // Types only. `WISTIA_PLAYER_TAG`, `API_READY_EVENT` and `readApiHandle` are
  // values this package uses on itself; publishing them would put three names
  // through the docs export-coverage gate for nobody's benefit.
  const missing = exportsOf(loaderPath)
    .filter(({ isValue, name }) => !isValue && !entryExports.has(name))
    .map(({ name }) => name);

  expect(missing).toEqual([]);
});

// The other half of the same drift: round 1's README rows described the event
// types as public while the entry did not export them, which is worse than the
// omission it replaced — a missing row says nothing, a wrong row asserts a
// falsehood. Every identifier the table names has to be a real export.
const readme = await readFile(new URL('../README.md', import.meta.url), 'utf8');

const exportsTableRows = (): readonly string[] => {
  const section = /\n## Exports\n([\s\S]*?)\n## /.exec(readme)?.[1];
  if (section === undefined) {
    throw new Error('README.md has no Exports section to check.');
  }
  const rows = section
    .split('\n')
    .filter(
      (line) => line.startsWith('|') && !/^\|[\s-]+\|[\s-]+\|$/.test(line)
    )
    .slice(1);
  if (rows.length === 0) throw new Error('The Exports table has no rows.');
  return rows;
};

test('the Exports table names only exports the entry actually has', () => {
  const documented = exportsTableRows().flatMap((row) =>
    [...(row.split('|')[1] ?? '').matchAll(/`([^`]+)`/g)].map(
      ([, name]) => name
    )
  );

  expect(documented.length).toBeGreaterThan(0);
  expect(documented.filter((name) => !entryExports.has(name))).toEqual([]);
});
