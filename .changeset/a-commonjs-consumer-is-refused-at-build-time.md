---
'@playdeck/core': patch
'@playdeck/provider-hls': patch
'@playdeck/provider-native': patch
'@playdeck/provider-vimeo': patch
'@playdeck/provider-wistia': patch
'@playdeck/provider-youtube': patch
'@playdeck/react': patch
---

A CommonJS consumer is now refused by their own type-checker instead of by Node
at runtime (#458). Being ESM-only is unchanged and stays unchanged; what changes
is when a consumer who cannot use these packages finds out.

**What was wrong.** The export map answered `types` and `import` and nothing
else. A consumer whose project is CommonJS, on `moduleResolution: nodenext`,
resolved the `types` condition, got `tsc` exit 0 with zero diagnostics, and then
got this from Node:

```
Error [ERR_PACKAGE_PATH_NOT_EXPORTED]: No "exports" main defined in
  .../node_modules/@playdeck/react/package.json
```

TypeScript used to report that disagreement and stopped, because Node learned to
`require` an ES module — but `require(esm)` still needs the `require` condition
to resolve to something, and an ESM-only map had nothing to answer it with. So
the diagnostic went away while the failure did not. An intentional constraint a
consumer meets at build time is a supported boundary; one that passes typecheck
and fails at `node` is a trap.

**What each package now carries.** Two files, and a `require` condition that
points at them:

```json
"exports": {
  ".": {
    "import": { "types": "./dist/index.d.ts", "default": "./dist/index.js" },
    "require": { "types": "./esm-only.d.cts", "default": "./esm-only.cjs" }
  }
}
```

`esm-only.d.cts` is deliberately not a module — it declares nothing and exports
nothing — so the consumer's own import statement fails to compile:

```
app.tsx(1,25): error TS2306: File '.../node_modules/@playdeck/react/esm-only.d.cts'
  is not a module.
```

`esm-only.cjs` throws on load, so a consumer who gets past their build is
refused by name rather than by a report of a missing file:

```
@playdeck/react is ESM only and cannot be loaded with require(). Import it from
an ES module, or reach it with a dynamic import().
```

**Nothing gained a second implementation.** The guard refuses; it never
implements. That is the point of it being a throw and an empty declaration
rather than a shim: no bundler configuration can select it in place of the real
ESM entry and get something that runs, so the ESM-only guarantee is not weakened
by having answered `require` at all. Each package's `sideEffects` now names
`./esm-only.cjs` for the same reason — a blanket `"sideEffects": false` would
let a bundler that took the `require` condition drop a module it saw no
bindings taken from, and hand the consumer an empty namespace instead of the
refusal. `dist` is unaffected and still tree-shakes.

**The types sit inside each condition rather than above both.** Conditions match
in the order the map writes them, and a `types` key at the top of the `.` entry
matches a CommonJS consumer before `require` ever does — which is the silent
pass, restored. The nesting is what lets the two consumers be told different
things.

**Why `patch`, and what it can still break.** No API, no type and no rendered
output changed, and `dist` is byte-identical — this is the export map and two
files that are never imported. It is a patch because nothing that ran stops
running: the builds this turns red were already producing code that Node
refused. A consumer who was type-checking such code, and shipping it unrun, will
see their build fail on the upgrade.

**What is unaffected, verified rather than assumed.** The three resolution modes
that worked still do — `bundler`, `node16` and `nodenext` on a `"type":"module"`
consumer, each type-checked against an installed package. `node10` still fails
as it always did, naming the settings that would work; export maps are invisible
to it, so nothing here could have reached it.
