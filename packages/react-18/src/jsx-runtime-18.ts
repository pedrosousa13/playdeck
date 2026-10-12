// A drop-in replacement for `react/jsx-runtime` (and, for anything compiled
// against the dev transform, `react/jsx-dev-runtime`) that lets
// `../react/src` -- written and tested against React 19's ref-as-prop and
// callback-ref-cleanup semantics -- run unmodified on React 18.
//
// `packages/react-18/vite.config.ts` aliases the bare specifiers
// `react/jsx-runtime` and `react/jsx-dev-runtime` to this module for every
// importer EXCEPT this module itself (the alias plugin there checks the
// importer), so the imports immediately below reach React's own real
// runtime rather than looping back here.
//
// `react-shim-18.ts` is this module's sibling for the one case this file
// cannot reach on its own: a JSX element that TypeScript compiles to
// `React.createElement` instead of `jsx`/`jsxs` (see that file's header).
// Both apply the same `transform` from `shim-shared.ts`.
import { jsx as realJsx, jsxs as realJsxs, Fragment } from 'react/jsx-runtime';
import { jsxDEV as realJsxDEV } from 'react/jsx-dev-runtime';
import { transform } from './shim-shared.js';

export { Fragment };

export function jsx(type: unknown, props: unknown, key?: unknown): unknown {
  const [nextType, nextProps] = transform(type, props);
  return (realJsx as (t: unknown, p: unknown, k?: unknown) => unknown)(
    nextType,
    nextProps,
    key
  );
}

export function jsxs(type: unknown, props: unknown, key?: unknown): unknown {
  const [nextType, nextProps] = transform(type, props);
  return (realJsxs as (t: unknown, p: unknown, k?: unknown) => unknown)(
    nextType,
    nextProps,
    key
  );
}

export function jsxDEV(
  type: unknown,
  props: unknown,
  key?: unknown,
  ...rest: unknown[]
): unknown {
  const [nextType, nextProps] = transform(type, props);
  return (
    realJsxDEV as (
      t: unknown,
      p: unknown,
      k?: unknown,
      ...r: unknown[]
    ) => unknown
  )(nextType, nextProps, key, ...rest);
}
