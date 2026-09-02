// hls.js's export map carries no `types` condition for its `./light` subpath,
// so `import('hls.js/light')` is untyped wherever nothing declares it — which
// includes every consumer, since neither this file nor
// `packages/provider-hls/test/hls-light.d.ts` is publishable. `loadHls`'s own
// type is what makes that harmless out there: the `any` lands on a typed
// parameter. In here the declaration is what stops a bare import tripping
// `noImplicitAny`, so the import in `hls-build.stories.tsx` is typed.
//
// Declared as the default entry's own shape rather than as `any`: the two
// builds export the same class, and what `hls-build.stories.tsx` drives is that
// one of them carries controllers the other does not.
declare module 'hls.js/light' {
  const Hls: typeof import('hls.js').default;
  export default Hls;
}
