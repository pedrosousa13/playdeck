---
'@playdeck/core': minor
'@playdeck/react': minor
---

Add sprite-thumbnail seek preview to `SeekSlider`

`@playdeck/core` gains `parseThumbnailCues` and `thumbnailCueAt`, parsing the
`#xywh=` sprite-region flavour of WebVTT that Vidstack, Media Chrome and
Video.js all read, plus the two `ThumbnailCue`/`ThumbnailRegion` types the
parsed cues carry. `RefusedUrlSurface` gains `'thumbnails'` and `'thumbnails
cue image'`, appended at the end of the existing tie-break rank so no
existing surface's priority against another changes.

`@playdeck/react`'s `SeekSlider` gains a `thumbnails` prop: the URL of that
WebVTT file. The file is fetched once, lazily, on the first hover or the
first keyboard focus of the input — never at mount — and, once loaded, a
`thumbnail` part renders the cue image cropped to its region, positioned
above the pointer or the current keyboard-focus position and clamped to stay
inside the slider's own box. Without the prop, nothing extra renders. Every
image URL — the WebVTT file's own and each cue's — passes through the same
allowlist every other URL prop in the player does, and a refused one
publishes the existing refusal notice. The feature is provider-agnostic: it
derives entirely from the supplied WebVTT/sprite pair, never from provider
internals, so it works the same way under every provider.

No `PlayerCapabilities` change and no provider package changes: the feature
needs no per-provider support to gate.
