---
'@reely/core': minor
'@reely/provider-native': minor
'@reely/provider-hls': minor
'@reely/provider-wistia': minor
'@reely/provider-youtube': patch
'@reely/provider-vimeo': patch
---

`PlayerState.live` is now published by every provider that can tell whether its
media is live, rather than by the HLS adapter alone. A native `<video>` playing
an endless stream and a Wistia live broadcast both left `live` as `null`, so a
control could not say "live" unless the source happened to be HLS (#187).

`@reely/core` gains the derivation those adapters share. `deriveLiveState(input)`
turns a duration, a seekable window, a playhead and the provider's own live flag
where it has one into `{ isLive, atLiveEdge }`, or `null` when the media is not
live. `liveStateEqual(a, b)` answers whether two of those say the same thing,
which is what an adapter checks before publishing a change. `LiveDerivationInput`
is the input type. Liveness is read from provider signals only — a source URL, an
id or a filename never decides it.

The at-edge tolerance is one number, held inside `@reely/core` and deliberately
not exported. `LiveDerivationInput.atEdgeThreshold` relaxes from required to
optional, and omitting it is how a caller takes the shared value; pass one only
to answer a different question than the players ask. Nothing that compiled
before stops compiling.

Per provider:

- **Native** derives `live` from the element's own signals — an endless
  `duration` and the moving `seekable` window, measured against the playhead. A
  file with a finite duration still reports `null`.
- **HLS** reports what it always did. The derivation moved to `@reely/core` and
  is re-exported here, so a custom HLS adapter still imports `deriveLiveState`
  from `@reely/provider-hls`. This adapter stays the authority on both engines,
  because it adds hls.js's live flag and `liveSyncPosition`, which the native
  answer underneath it does not carry.
- **Wistia** reports `live` from `MediaData.mediaType` on the
  `loaded-media-data` event and from nothing else. Wistia publishes no seekable
  window, so the at-edge flag measures the playhead against the duration the
  player reports, and it stays current while paused as well as while playing.
- **YouTube and Vimeo** report no `live` at all: the key is absent from every
  patch rather than present holding `null`. Neither SDK publishes a liveness
  signal, and on both, a duration describes a live broadcast and a video on
  demand identically. Each README now says so, so the gap reads as a decision
  and not an oversight.

`null` still means "not live, or not yet known" — never "this is on demand". A
control should render neither claim until one arrives. Every provider publishes
`live` only when the value changes; an unchanged value produces no patch.
