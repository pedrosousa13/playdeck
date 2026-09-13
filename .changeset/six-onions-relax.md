---
'@playdeck/core': minor
'@playdeck/provider-native': minor
'@playdeck/provider-hls': minor
---

Add `PlayerState.audioTracks` and a `selectAudioTrack` command

No audio-track state, command, or capability existed before this: a consumer
could not tell whether a source carried alternate audio, let alone switch
between renditions. `@playdeck/core` gains `PlayerState.audioTracks`, each
entry carrying an `id`, a `label`, a `language`, and its own `active` flag —
unlike a text track or a quality rung, an audio track's selection lives on
the entry itself rather than in a sibling `selectedId` field, because the
underlying surfaces already enforce "at most one enabled" on the track and
leave no separate slot to mirror. `selectAudioTrack(id)` follows the existing
refusal semantics every other command does, and `capabilities.selectAudioTrack`
uses the existing `Availability` vocabulary.

`@playdeck/provider-native` answers from the media element's (non-standard,
browser-dependent) `AudioTrackList` where it is exposed, and reports
`unavailable: 'browser'` where it is not — Chrome does not implement the
list at all; Firefox and Safari do.

`@playdeck/provider-hls` answers from hls.js's own audio tracks when running
on that engine, settled the same way subtitle-track support is: from the
manifest on `MANIFEST_PARSED` (which tells a build without the alternate-audio
controller apart from a source with no alternate-audio renditions at all),
then from `AUDIO_TRACKS_UPDATED` once the tracks themselves are in hand. On
native HLS it answers from the media element, through the same seam
`@playdeck/provider-native` exposes.

`@playdeck/provider-vimeo`, `@playdeck/provider-youtube` and
`@playdeck/provider-wistia` all report `selectAudioTrack` unavailable with
reason `provider` — none of the three exposes an audio-track surface to wire
a command to.

`@playdeck/core`'s `PlayerCapabilities` gains a required field: any object
built to satisfy that type — a custom provider adapter, a capabilities
fixture in a test — needs the new field before it type-checks again, the
same compatibility impact `providerPoster` and `selectQualityAuto` had.

Out of scope: the menu part that surfaces this capability to viewers, tracked
separately.
