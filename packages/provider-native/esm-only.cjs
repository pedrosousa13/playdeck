// The runtime half of the ESM-only guard; esm-only.d.cts is the type-checker
// half. This is where the `require` condition of the export map resolves, so a
// CommonJS consumer who gets past their own build is refused by name instead of
// by Node's report of an export this package does not define.
//
// It throws on load and exports nothing, so nothing can select it as an
// implementation of this package in place of the real ESM entry.
throw new Error(
  '@playdeck/provider-native is ESM only and cannot be loaded with require(). Import it from an ES module, or reach it with a dynamic import().'
);
