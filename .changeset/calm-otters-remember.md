---
'@playdeck/provider-native': patch
---

Document that a refused `startTime` is permanent for the load

The README already said an initial `startTime` offset is applied once, when
metadata arrives, but said nothing about what a refusal at that attempt means
going forward — whether the offset is retried once the seekable window catches
up, or whether the refusal stands for the rest of the load. A reader had no
way to answer that short of reading `applyInitialPosition`.

The README now says a refusal at that single attempt is permanent for the
load: nothing revisits it later, including a `seekable` window that goes on
to widen past the requested offset, and the existing `configuration` notice
on `PlayerState.error` is the record of the refusal. This documents behaviour
the provider already has — `applyInitialPosition` latches `positioned` before
it decides anything, so the offset is considered exactly once per load
whatever the answer — and does not change it. The `never reconsiders the
startTime once the window widens (#466)` case in
`e2e/start-time-above-seekable-end.spec.ts` continues to pin exactly this.
