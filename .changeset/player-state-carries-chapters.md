---
'@playdeck/core': minor
'@playdeck/provider-native': minor
'@playdeck/provider-hls': minor
'@playdeck/provider-vimeo': minor
'@playdeck/provider-youtube': minor
'@playdeck/provider-wistia': minor
---

Player state now carries chapters (#182). `@playdeck/core` exports a new `Chapter`
type — `id`, `title`, `startTime` and a nullable `endTime` — and `PlayerState`
gains a `chapters` collection, ordered by ascending `startTime` and frozen on
publish the way the text-track collection already is. `PlayerCapabilities` gains
a matching `chapters` facet, so a provider that cannot report chapters says so
rather than going quiet: an empty collection means "no chapters here", and the
capability is what says whether that is the provider's limit or the source's
content.

Playdeck publishes the vocabulary and does not draw it. There are no chapter
markers, no chapter labels, no new primitive and no new part name, and the seek
slider is untouched. It already takes children and exposes its range through the
underlying input's `min` and `max`, so a consumer maps a pointer position to a
time and renders whatever they want at that offset.

**`endTime` is the library's own derivation, not a provider's report.** No
provider reports chapter end times: Vimeo publishes a start and a title, and a
WebVTT chapter cue's own end is not guaranteed to abut the next cue. Each
chapter therefore ends where the next one begins, and the last chapter takes the
media duration — or `null` when the duration is unknown or not finite, which is
why the field is nullable. `Infinity` is never substituted, and the last chapter
is never dropped.

Which providers populate the collection was established per adapter:

- **Native** reads a `kind="chapters"` text track off the media element. The
  track's mode is moved to `hidden`, because a text track's cues are not
  obtained at all while its mode is `disabled` — the default for any track
  without the `default` attribute — and `hidden` populates them without asking
  the browser to draw anything. The cues are read on the track's `cuechange` and
  on the `<track>` element's `load`, not synchronously after the mode is
  assigned: at that moment the fetch the assignment started has not finished.
- **HLS** adds nothing of its own. It carries no chapters concept, and its
  `EXT-X-DATERANGE` support routes into the metadata track, so both engines
  share the native path over the media element's own track list.
- **Vimeo** populates from the SDK's chapter list, read once the player is
  ready. Its `chapterchange` event keeps the collection current; nothing polls.
- **YouTube** reports empty with `{ status: 'unavailable', reason: 'provider' }`.
  The IFrame Player API documents no chapter method and no chapter event, and
  the Data API's video resource has no chapter property. This is a published
  fact, not an error: no command rejects over it.
- **Wistia** reports empty the same way. Its chapters ship as an inbound
  embed-option plugin — the embedder supplies the list — and no documented
  read-back accessor exists.

**`TextTrackKind` is unchanged, and still admits only `'subtitles'` and
`'captions'`.** Chapters get their own collection rather than joining the
text-track one. Nothing downstream of that collection filters on kind, so a
chapters track allowed into it would appear in the captions menu, become what
the captions toggle switches to, make a captions menu render for a video with no
captions, and render its chapter titles as caption cues.
