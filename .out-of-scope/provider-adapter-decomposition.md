# Decomposing the `create*Provider` closures

Each provider package puts effectively its whole implementation inside one
`create*Provider` closure:

| Package            | Closure                 | Lines |
| ------------------ | ----------------------- | ----- |
| `provider-hls`     | `createHlsProvider`     | 783   |
| `provider-vimeo`   | `createVimeoProvider`   | 724   |
| `provider-native`  | `createNativeProvider`  | 627   |
| `provider-youtube` | `createYouTubeProvider` | 574   |

Everything inside shares one lexical scope, so any state is reachable from any
handler and the units inside are not separately testable.

## Status: reversed on 2026-07-30

The `wontfix` recorded here on 2026-07-29 was reversed by the maintainer on
2026-07-30, as part of the codebase-wide maintainability pass that also split
the react and core entry modules (SIDEPRO-186, SIDEPRO-187). The decomposition
is now planned work: SIDEPRO-135 is the umbrella, with one child issue per
provider — SIDEPRO-188 (native, first), SIDEPRO-189 (HLS), SIDEPRO-190
(YouTube), SIDEPRO-191 (Vimeo, last).

Nothing changed in the measurement above — what changed is the decision. The
maintainer accepted the cost the original closing weighed: the `@real` suite
runs only manually now (`PLAYDECK_REAL_PROVIDERS=1 pnpm test:e2e
--project=chromium --grep @real`), and that manual run is a hard gate on this
work, not a formality.

## What still binds

The prerequisites recorded on SIDEPRO-135 apply to every child issue:

- `@real` green before and after, per provider, run locally. A provider whose
  baseline cannot be made green stops there and reports on its issue.
- One provider per PR.
- Extraction by lifecycle seam (load/attach, playback commands, tracks and
  captions, presentation modes, teardown), with explicit dependencies — never
  by line count.
- **Still no shared cross-provider abstraction.** The four adapters differ
  enough that a shared base or common lifecycle abstraction would be invented
  to justify the split rather than discovered from the code. That part of the
  original decision stands.

## What would re-close it

The first child issue failing its `@real` baseline gate with no reasonable
path to green — that is the original risk argument proven out, and per
SIDEPRO-135's reopen comment it should be weighed again rather than
overridden.

## History

- SIDEPRO-135 — "Provider adapters: the create*Provider closures are 574-783
  lines each" (2026-07-29). Recorded from a security and simplification review
  that found the measurement and deliberately did not act on it; closed
  `wontfix` on 2026-07-29 (PR #127 recorded the reasoning here), reopened by
  the maintainer on 2026-07-30 as the umbrella for the per-provider child
  issues.
