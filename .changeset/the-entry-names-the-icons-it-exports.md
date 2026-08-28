---
'@playdeck/react': patch
---

The package entry names the icon components it exports instead of re-exporting
the icons module wholesale (#512).

**Nothing a consumer can import changes.** Verified rather than asserted: the
entry's full export surface — values and types together, read off the built
declarations with the TypeScript checker — is identical before and after, at 90
names.

**What changes is who decides.** `export * from './icons.js'` delegated the
public surface to whatever that module happened to export, so a helper added
there for one icon's use would have become public API without anyone choosing
it. Naming them makes each one a decision — taken while the major is `0` and a
withdrawal still costs a `minor`, rather than after the freeze, when it costs a
major.
