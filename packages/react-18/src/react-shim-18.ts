// `jsx-runtime-18.ts` wraps `jsx`/`jsxs`/`jsxDEV`, but TypeScript's JSX
// transform does not always compile to one of those: an element with a
// spread attribute that is not the very last thing before an explicit `key`
// compiles to `React.createElement` instead, because the transform cannot
// then guarantee the spread does not itself carry a `key` that should lose
// to the explicit one. `viewport-media.tsx`'s native `<video>` is exactly
// this shape -- `{...passthrough}` precedes `key={sourceKey(source)}` -- and
// it is also the one element carrying `mediaRef`, the merged ref callback
// that most needs `shim-shared.ts`'s wrapping. Confirmed empirically: built
// without this module, the bundle's only `createElement` call is that one
// `<video>`, and `wrapHostRef` is never reached for it -- the element renders
// correctly (React 18 tolerates an unwrapped React-19-shaped callback ref,
// just louder: "Unexpected return value from a callback ref", logged once
// per mount) but the shim's whole purpose for that one ref is defeated.
//
// `packages/react-18/vite.config.ts` and `vitest.config.ts` both alias the
// bare specifier `react` to this module for every importer under
// `../react/src` -- never for this module's own (unaliased) import of the
// real `react` below, and never for any other importer (this package's own
// `entry.tsx`, or a test file), which need no `createElement` wrapping and
// get the real `react` directly.
export * from 'react';
import { createElement as realCreateElement } from 'react';
import { transform } from './shim-shared.js';

export function createElement(
  type: unknown,
  config: unknown,
  ...children: unknown[]
): unknown {
  const [nextType, nextProps] = transform(type, config);
  return (
    realCreateElement as (
      t: unknown,
      p: unknown,
      ...c: unknown[]
    ) => unknown
  )(nextType, nextProps, ...children);
}
