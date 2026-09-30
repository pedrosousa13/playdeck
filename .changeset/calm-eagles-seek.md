---
'@playdeck/core': minor
'@playdeck/provider-hls': minor
'@playdeck/provider-native': minor
'@playdeck/provider-youtube': minor
'@playdeck/provider-vimeo': minor
'@playdeck/provider-wistia': minor
---

Add a live edge: `PlayerLiveState.offsetFromEdge`, a `liveEdge` capability, and `seekToLiveEdge`

`PlayerLiveState` gains `offsetFromEdge`: how far behind the provider's live
edge playback is, in whole seconds, `0` at or ahead of it. Whole seconds is
deliberate — `liveStateEqual` is what every adapter consults to decide
whether a changed `live` value is worth publishing, and an unrounded float
would differ on essentially every `timeupdate`, so `liveStateEqual` now
compares the new field too.

`PlayerCapabilities` gains a required field, `liveEdge`, told apart the way
`chapters` is: `unavailable`/`provider` means the provider has no way to
report a live edge at all, `unavailable`/`source` means this particular
source is not live. Any object built to satisfy `PlayerCapabilities` — a
custom provider adapter, a capabilities fixture in a test — needs the new
field before it type-checks again, the same compatibility impact
`providerPoster` had when it landed (1.1.0).

`PlayerController` gains `seekToLiveEdge()`, and `PlayerCommand` gains the
matching member. It refuses with `not-ready` whenever there is no provider,
`capabilities.liveEdge` is not `available`, or the attached adapter
implements no `seekToLiveEdge` — the same `RefusedCommand` shape every other
pre-attach refusal uses. Where a provider can answer, the command lands on
the provider's own notion of the edge, never a value the controller
computes.

Each provider adapter reports `liveEdge` for what it can actually see:

- `@playdeck/provider-hls`: on the hls.js engine, `available` once the source
  is live, hls.js's own `liveSyncPosition` is finite, and the existing
  seek-window-meaningful check passes — `seekToLiveEdge` lands on
  `liveSyncPosition`, deliberately behind the raw seekable end. On the native
  engine, the edge is the raw seekable end, delegated straight to
  `@playdeck/provider-native`.
- `@playdeck/provider-native`: `available` once the source is live and its
  `seekable` has a finite end, which `seekToLiveEdge` lands on — the only
  notion of a live edge a plain media element has.
- `@playdeck/provider-youtube`: `unavailable`/`provider`. The IFrame Player
  API exposes no seekable-range accessor at all, and `getDuration()` is a
  snapshot rather than a value tracking the edge on a live stream.
- `@playdeck/provider-vimeo`: `unavailable`/`provider`. `@vimeo/player`
  (2.30.4) has no live concept anywhere to build one on.
- `@playdeck/provider-wistia`: `unavailable`/`provider`. `PublicApi` has no
  seekable-range accessor and no dedicated live-edge member.
