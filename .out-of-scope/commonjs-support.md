# CommonJS support

Every Playdeck package publishes ESM and nothing else. `@playdeck/react`'s
export map carries a `types` condition and an `import` condition, so
`require('@playdeck/react')` cannot resolve, and no `require` condition will be
added.

This is a position, not an omission. The packaging harness lints each tarball on
an ESM-only profile precisely so that legacy-resolution complaints are muted
rather than accumulating as noise — `scripts/verify-packaging.mjs` ignores the
`node10` resolution and the CJS half of `node16` on purpose. A repo that had
forgotten about CommonJS would not have written those ignores.

## Why this is out of scope

**Dual publishing is not a build flag, it is a second package.** Shipping CJS
alongside ESM means two output graphs, two sets of resolution conditions, and
the dual-package hazard: a dependency tree that loads both halves gets two
copies of the module state. Playdeck's controller holds per-player state and
hands subscriptions across package boundaries, so two copies is not a
theoretical concern about identity checks — it is two controllers where a
consumer believes there is one.

**The measured cost is reach, and the measured reach is narrowing.** The
comparison that raised this (2026-08-24, against packages installed from npm)
found Media Chrome and Plyr shipping CommonJS and Playdeck not. That is a real
gap. It is also a gap against a resolution mode that Node has supported ESM
alongside for years, that every current bundler resolves, and that React itself
now depends on — React 19 dropped the UMD builds React 18 shipped, so the
ecosystem is moving the same direction rather than away from it.

**The harm is not the absence — it is that the absence was silent.** A CommonJS
consumer's type-checker reported success and only Node refused, at runtime. That
is indefensible whatever the packaging position is, and it is a separate defect:
being ESM-only is a stance, failing quietly is not. #458 covers making that
failure loud at build time, so a consumer who cannot use the package learns it
from their toolchain rather than from production. Read together, the decision is
"ESM only, and say so early" rather than "ESM only, and let them find out".

```js
// Not supported, and refused loudly rather than silently:
const Player = require('@playdeck/react');

// Supported:
import * as Player from '@playdeck/react';
```

## This decision is reversible

Nothing in the source is ESM-specific; the stance lives in the build outputs and
the export maps. If the reach cost changes — a consumer segment that genuinely
cannot move, rather than one that has not yet — this can be revisited by adding
a `require` condition and a CJS output.

What would have to be answered first is the dual-package hazard: how a tree that
loads both halves is prevented from holding two controllers, or what breaks when
it does. That question is the work, not the build config.

If it is reconsidered, delete this file, and close #458 rather than implementing
it — a loud failure for a case that now succeeds is worse than no check at all.

## Prior requests

- #448 — "No no-build entry and no CommonJS, so reach stops at
  bundler-plus-React-19" (2026-08-24). Filed by the competitive comparison in
  #398, which measured the gap against three alternatives. One of three
  packaging decisions bundled in that issue; declined by the maintainer on
  2026-08-25.
