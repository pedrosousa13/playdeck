// hls.js's export map carries no `types` condition for its `./light` subpath,
// so `import('hls.js/light')` resolves to `any` — for this workbench and for
// every consumer. `packages/provider-hls/test/hls-light.d.ts` declares the same
// module for the same reason; neither is publishable, so a consumer still gets
// the `any`, and `loadHls`'s own type is what makes that harmless.
//
// Declared as the default entry's own shape rather than as `any`: the two
// builds export the same class, and what `hls-build.stories.tsx` drives is that
// one of them carries controllers the other does not.
declare module 'hls.js/light' {
  const Hls: typeof import('hls.js').default;
  export default Hls;
}
