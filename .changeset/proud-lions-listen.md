---
'@playdeck/react': minor
---

Wire `LiveIndicator`'s press behaviour and make `Time` live-aware

`LiveIndicator` becomes the button its docstring always described: where
`capabilities.liveEdge` is `available`, pressing it issues
`PlayerController.seekToLiveEdge()`, following the same consumer-`onClick`/
`preventDefault` contract every other command-issuing part in this package
uses. Where `liveEdge` is `unavailable`, the part stays mounted as a
non-interactive LIVE badge instead of vanishing -- a deliberate, named
exception to this package's uniform capability gate (documented beside
`LiveIndicator` and in this package's README, next to that rule): an
indicator reports a property of the stream, it does not offer a command, and
being live is true whether or not a seek-to-edge command exists on the active
provider.

`Time` gains a live-aware rendering for `type="current"` on a live source:
it shows a negative offset from the edge when playback has fallen behind it
(for example `-0:42`, sourced from `PlayerLiveState.offsetFromEdge`), and the
word LIVE once playback is within the edge's tolerance
(`PlayerLiveState.atLiveEdge`). The LIVE string is localisable through a new
`liveLabel` prop on `TimeProps`, defaulting to `'LIVE'`. `type="duration"` on
a live source already rendered nothing (`hasDuration` is false for every live
source's `null`/`Infinity` duration, #248) -- unchanged, and now pinned by a
test that also sets `PlayerState.live`.
