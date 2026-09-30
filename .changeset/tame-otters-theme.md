---
'@playdeck/react': patch
---

Document the theme tokens as a versioned contract, with a starter theme

Every `--playdeck-*` custom property `theme.css`, `docked.css` or a primitive
reads is now named, in a `## Theming` section of this package's own README:
its role, its default, and which parts read it. `test/tokens.contract.test.ts`
keeps it in sync with the stylesheets and the primitives automatically, in
both directions.

The [Theme](https://playdeck.video/guides/theme/) guide now carries a minimal
starter theme (`examples/css-starter-theme.css`) and points at the README's
table instead of keeping its own copy of it.

No behaviour changes: this is documentation and a test.
