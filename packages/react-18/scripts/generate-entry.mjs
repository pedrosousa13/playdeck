// Generates `src/entry.tsx` from `../react/src/index.tsx`'s own exports,
// read through the TypeScript checker rather than a hand list, so the set of
// components wrapped in `forwardRef` tracks `../react/src` automatically as
// it grows.
//
// A value export is wrapped in `forwardRef` exactly when the checker resolves
// its first parameter's type to a type that itself has an own-or-inherited
// `ref` member -- the same question TypeScript answers for a consumer writing
// `<Export ref={...} />`. Every component typed through `ComponentPropsWithRef<T>`
// or an explicit `readonly ref?: Ref<T>` field answers yes, icons included
// (`IconProps` is `SVGProps<SVGSVGElement>`, which carries `ref` the same way).
// `PosterImage` is the one export that answers no: its props type is built
// from `ImgHTMLAttributes<HTMLImageElement>` directly, which carries no `ref`
// member at all, so wrapping it would add a `forwardRef` that forwards
// nothing a consumer could ever pass in the first place. Every other value
// export -- `normalizePoster`, `useActiveCues`, `usePlayerActions`,
// `usePlayerState` -- takes no props argument at all and passes straight
// through unwrapped.
import ts from 'typescript';
import { format, resolveConfig } from 'prettier';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath, URL } from 'node:url';
import console from 'node:console';
import process from 'node:process';

const here = fileURLToPath(new URL('.', import.meta.url));
const sourceIndexPath = fileURLToPath(
  new URL('../../react/src/index.tsx', import.meta.url)
);
const reactPackageDir = fileURLToPath(new URL('../../react', import.meta.url));

/**
 * `../react/src/index.tsx`'s own exports, read through a `tsc` program
 * rooted at that one file -- not this package's own `tsconfig.json`, which
 * would also need `../react/src` inside its `rootDir` to compile it at all
 * (see `scripts/copy-assets.mjs`'s header for the same constraint on
 * declaration emit).
 * @returns {{ checker: ts.TypeChecker, sourceFile: ts.SourceFile, exports: ts.Symbol[] }}
 */
const readSourceExports = () => {
  const configPath = ts.findConfigFile(
    reactPackageDir,
    ts.sys.fileExists,
    'tsconfig.json'
  );
  if (!configPath) {
    throw new Error(
      `generate-entry: found no tsconfig.json under ${reactPackageDir}`
    );
  }
  const configFile = ts.readConfigFile(configPath, ts.sys.readFile);
  const parsed = ts.parseJsonConfigFileContent(
    configFile.config,
    ts.sys,
    reactPackageDir
  );
  const program = ts.createProgram([sourceIndexPath], parsed.options);
  const checker = program.getTypeChecker();
  const sourceFile = program.getSourceFile(sourceIndexPath);
  if (!sourceFile) {
    throw new Error(`generate-entry: tsc did not load ${sourceIndexPath}`);
  }
  const moduleSymbol = checker.getSymbolAtLocation(sourceFile);
  if (!moduleSymbol) {
    throw new Error(
      `generate-entry: ${sourceIndexPath} resolved to no module symbol -- is it missing exports entirely?`
    );
  }
  return {
    checker,
    sourceFile,
    exports: checker.getExportsOfModule(moduleSymbol)
  };
};

/**
 * `exp`, resolved past the alias every `export { X } from '...'` and
 * `export type { X } from '...'` statement creates -- `exp.valueDeclaration`
 * is only ever set on the ALIASED symbol (the real `const`, `function` or
 * type declaration), never on the alias itself.
 * @param {ts.TypeChecker} checker
 * @param {ts.Symbol} exp
 */
const resolveAlias = (checker, exp) =>
  exp.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(exp) : exp;

const { checker, exports } = readSourceExports();

const typeNames = [];
const passthroughValueNames = [];
const wrappedValueNames = [];
const notWrappedValueNames = [];

for (const rawExport of exports) {
  const name = rawExport.escapedName;
  const resolved = resolveAlias(checker, rawExport);

  if (!resolved.valueDeclaration) {
    // A type alias or interface: nothing to wrap, re-exported as a type.
    typeNames.push(name);
    continue;
  }

  const type = checker.getTypeOfSymbolAtLocation(
    resolved,
    resolved.valueDeclaration
  );
  const signatures = type.getCallSignatures();
  const firstParam = signatures[0]?.getParameters()[0];
  const acceptsRef =
    firstParam !== undefined &&
    checker
      .getTypeOfSymbolAtLocation(firstParam, firstParam.valueDeclaration)
      .getProperty('ref') !== undefined;

  if (signatures.length === 0 || firstParam === undefined) {
    // Takes no props argument at all: a hook or a plain helper function.
    passthroughValueNames.push(name);
  } else if (acceptsRef) {
    wrappedValueNames.push(name);
  } else {
    notWrappedValueNames.push(name);
  }
}

typeNames.sort();
passthroughValueNames.push(...notWrappedValueNames);
passthroughValueNames.sort();
wrappedValueNames.sort();

if (wrappedValueNames.length === 0) {
  throw new Error(
    'generate-entry: resolved zero ref-accepting exports out of ' +
      sourceIndexPath +
      ' -- the checker likely stopped resolving its exports the way this script expects.'
  );
}

const lines = [];
lines.push(
  // Carried over from `../react/src/index.tsx`'s own first line. A
  // directive only hoists out of the chunk that opens with it; `index.tsx`
  // is a transitively-imported module in THIS package's build, not the lib
  // entry Vite reads, so without repeating it here, nothing in the output
  // bundle would open with it at all and an RSC build consuming this
  // package would fail the same way scripts/client-boundary.mjs's check
  // exists to catch for @playdeck/react (confirmed: scripts/verify-packaging.mjs's
  // `use client` check fails against this package without this line).
  "'use client';",
  '',
  "// GENERATED by scripts/generate-entry.mjs from ../react/src/index.tsx's",
  '// own exports, read through the TypeScript checker -- do not hand-edit.',
  "// Re-run the package's build to regenerate after `../react/src/index.tsx`",
  "// changes its exports or any export's own props type.",
  "import { forwardRef, type ReactNode } from 'react';",
  "import * as Source from '../../react/src/index.js';",
  '',
  'export type {',
  ...typeNames.map((name) => `  ${name},`),
  "} from '../../react/src/index.js';",
  ''
);

for (const name of passthroughValueNames) {
  lines.push(`export const ${name} = Source.${name};`);
}

lines.push(
  '',
  '// Every export above whose own props type carries a `ref` member needs a',
  "// real `forwardRef` component at this public boundary: a consumer's own",
  '// JSX is compiled by their own, unshimmed React 18 jsx-runtime, which',
  '// never hands a plain function component a `ref` prop at all (see',
  '// ../src/shim-shared.ts for the equivalent problem one level down, inside',
  "// ../react/src's own compiled output). `PosterImage` is the one export",
  '// whose props type carries no `ref` member, so it is listed above instead.',
  '// Which exports land in which list is computed, not hand-maintained --',
  "// see this script's header."
);
lines.push(
  // `C` carries the ORIGINAL export's own signature (`Root`'s, notably, is
  // generic over `ConsumerProviders`) all the way through to the returned
  // value, via the `as unknown as C` below -- a plain `forwardRef` call
  // cannot stay generic over its own render function's props, so the cast
  // is what lets `Player.Root<MyProviders>` still resolve the way calling
  // `../react/src`'s own `Root` would. `forwardRef`'s own prop/ref typing is
  // deliberately bypassed (`Record<string, unknown>`, not `Parameters<C>[0]`)
  // rather than threaded through generically: a conditional type over a
  // not-yet-resolved generic parameter (`PropsWithoutRef<Parameters<C>[0]>`)
  // does not simplify the way a concrete props type does, and every
  // simplification tried here either failed as `never` or needed the same
  // `unknown` escape hatch one call earlier.
  'const wrapWithForwardRef = <C extends (props: never) => ReactNode>(',
  '  Component: C,',
  '  displayName: string',
  '): C => {',
  '  const Wrapped = forwardRef((props: Record<string, unknown>, ref: unknown) =>',
  '    (Component as unknown as (props: Record<string, unknown>) => ReactNode)({',
  '      ...props,',
  '      ref',
  '    })',
  '  );',
  '  (Wrapped as { displayName?: string }).displayName = displayName;',
  '  return Wrapped as unknown as C;',
  '};',
  ''
);

for (const name of wrappedValueNames) {
  lines.push(
    `export const ${name} = wrapWithForwardRef(Source.${name}, '${name}');`
  );
}

lines.push('');

const checkMode = process.argv.includes('--check');
const entryPath = fileURLToPath(new URL('../src/entry.tsx', `file://${here}`));
// Formatted here, with the repo's own resolved Prettier config, rather than
// relying on a separate `pnpm format` pass to catch up afterwards: a
// generated file this script writes unformatted would fail `pnpm format:check`
// on every build until someone remembered to format it by hand.
const prettierConfig = (await resolveConfig(entryPath)) ?? {};
const generated = await format(lines.join('\n'), {
  ...prettierConfig,
  filepath: entryPath
});

if (checkMode) {
  const committed = readFileSync(entryPath, 'utf8');
  if (committed !== generated) {
    console.error(
      'generate-entry --check: packages/react-18/src/entry.tsx is out of date ' +
        'with ../react/src/index.tsx. Run `pnpm --filter @playdeck/react-18 generate-entry` ' +
        'and commit the result.'
    );
    process.exit(1);
  }
  console.log(
    'generate-entry --check: packages/react-18/src/entry.tsx is up to date.'
  );
} else {
  writeFileSync(entryPath, generated);
  console.log(
    `generate-entry: wrapped ${wrappedValueNames.length} component export(s), ` +
      `passed through ${passthroughValueNames.length} value export(s), ` +
      `forwarded ${typeNames.length} type export(s).`
  );
}
