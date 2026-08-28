// hls.js's export map carries no `types` condition for its `./light` subpath,
// so `import('hls.js/light')` resolves to `any` — for this test and for every
// consumer. That costs a consumer nothing, because `loadHls` is typed
// `HlsModuleLoader` and the `any` lands on a typed parameter, but a bare import
// here trips `noImplicitAny`.
//
// Declared as the default entry's own shape rather than as `any`: the two
// builds export the same class, and the point of the test that reads this is
// that one of them carries controllers the other does not.
declare module 'hls.js/light' {
  const Hls: typeof import('hls.js').default;
  export default Hls;
}
