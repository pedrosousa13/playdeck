# CommonJS support

Every Playdeck package publishes ESM and nothing else. `@playdeck/react`'s
export map carries a `types` condition and an `import` condition, so
`require('@playdeck/react')` cannot resolve, and no `require` condition will be
added.

This is a position, not an omission. The packaging harness lints each tarball on
an ESM-only profile precisely so that legacy-resolution complaints are muted
rather than accumulating as noise: `scripts/verify-packaging.mjs` says it does
this to stop the linter "flagging the legacy CJS/node10 resolution modes these
packages intentionally do not support". A repo that had forgotten about
CommonJS would not have written that.

## Why this is out of scope

**Dual publishing is not a build flag, it is a second package.** Shipping CJS
alongside ESM means two output graphs, two sets of resolution conditions, and
the dual-package hazard: a dependency tree that loads both halves gets two copies of
the module. That is not a theoretical concern about identity checks here.
`PlayerController` holds its listener sets as private fields and hands
subscriptions across the boundary into `@playdeck/react`, so which copy a
consumer reached decides which listeners a state change reaches.

**The measured cost is reach.** The comparison that raised this (2026-08-24,
against packages installed from npm) found Media Chrome and Plyr shipping
CommonJS and Playdeck not. That is a real gap, and nothing here disputes it. It
is weighed against a cost that lands on every future change rather than once,
and it loses on that basis — not on a claim that CommonJS consumers do not
exist.

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
