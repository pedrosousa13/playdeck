---
'@playdeck/core': minor
'@playdeck/react': minor
'@playdeck/provider-native': minor
'@playdeck/provider-hls': minor
'@playdeck/provider-youtube': minor
'@playdeck/provider-vimeo': minor
'@playdeck/provider-wistia': minor
---

Add `RemotePlaybackButton`, reporting the standards-based Remote Playback API beside AirPlay

The comparison page marked Chromecast as unsupported because the only route
there was the Cast SDK — a sender script and a receiver page. The Remote
Playback API is the standards-based alternative already built into the media
element: Chrome's own route to Chromecast for a file or an HLS stream, with no
SDK to load.

`@playdeck/core` gains `capabilities.remotePlayback`, beside the existing
`airPlay`: `available` where the element's `remote` object exists and a device
is currently reachable per its own `watchAvailability()`, `unavailable` with
reason `browser` where the API is absent, and `unavailable` with reason
`provider` where it exists but no device has announced itself yet — the same
three-way split `airPlay` already makes. A `showRemotePlaybackPicker` command
joins `PlayerCommand` and `ProviderAdapter`, refusing through the same path
every other pre-attach command does. `PlayerState.remotePlayback` reflects the
connection state the API itself reports (`connecting`/`connected`/
`disconnected`), `null` both before the capability resolves `available` and
once it has settled back on `unavailable` — the same pairing
`capabilities.providerPoster`/`providerPosterUrl` already are.

`@playdeck/provider-native` implements all of this against the media element;
`@playdeck/provider-hls` delegates to the embedded native adapter the way it
already does for `airPlay`. `@playdeck/provider-youtube`, `-vimeo` and
`-wistia` report `unavailable`/`provider`: none of the three exposes a media
element this adapter has a handle to.

`@playdeck/react`'s `RemotePlaybackButton` mirrors the existing `AirPlayButton`
part exactly — not a toggle, no `aria-pressed`, renders nothing until the
capability resolves `available` — and is exported alongside it.

`@playdeck/core`'s `PlayerCapabilities` gains a required field: any object
built to satisfy that type — a custom provider adapter, a capabilities fixture
in a test — needs the new field before it type-checks again, the same
compatibility impact `providerPoster` had when it landed (1.1.0).

The features comparison gains a Chromecast/Google Cast anchor reading yes for
Playdeck, with a footnote naming the Remote Playback API as the specific route
— distinct from the separate, unimplemented Cast SDK.
