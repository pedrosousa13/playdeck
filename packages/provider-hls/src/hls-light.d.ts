// hls.js's export map carries no `types` condition for its `./light` subpath,
// so `import('hls.js/light')` resolves to `any` — for this package and for
// every consumer. That costs a consumer nothing, because `loadHls` and the
// `build` option it stands in for (`index.ts`) are both typed, and the `any`
// lands on a typed parameter, but a bare import here trips `noImplicitAny`.
//
// Declared as the default entry's own shape rather than as `any`: the two
// builds export the same class, and the point of `hlsBuildLoaders`
// (`adapter-values.ts`) is that one of them carries controllers the other
// does not. No top-level `import`/`export` in this file, deliberately: that
// keeps it a global script rather than a module, which is what lets this
// declare a fresh ambient module instead of augmenting one TypeScript already
// sees as untyped (`test/build-features.test.ts` needs the same shape, and
// picks this one up because its own tsconfig includes `src` alongside `test`
// rather than declaring a second copy).
declare module 'hls.js/light' {
  const Hls: typeof import('hls.js').default;
  export default Hls;
}
