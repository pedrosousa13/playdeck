/*
 * `import href from 'some.css?url'` — Vite's asset-URL form, which emits the
 * file as its own hashed asset and hands back its address rather than putting
 * a byte of it in the importing chunk.
 *
 * Declared here rather than picked up from `vite/client`, because
 * `apps/site/tsconfig.json` sets `types: []` on purpose: nothing under this
 * package reaches a Node or Vite global, and pulling in a whole ambient
 * package to type one import would let every other global in it resolve here
 * too. One module pattern, written where the one file that uses it can be read
 * beside it — `BenchIsland.tsx`, which loads `@playdeck/react/theme.css` this
 * way so the skin switch can add and remove a real stylesheet.
 */
declare module '*.css?url' {
  const href: string;
  export default href;
}
