---
'@playdeck/react': patch
---

Pin the seek bar to `direction: ltr` regardless of the page's own direction

`SeekSlider`'s wrapper carries an inline `direction: ltr`, inherited by the
native range input, the progress fill, the buffered ranges and the thumbnail
preview. Under a `dir="rtl"` ancestor, the native input, its thumb, the
fill, the buffered ranges and the thumbnail preview all run left-to-right
together, so the thumb and the fill agree — the same convention media
progress indicators keep elsewhere, left-to-right regardless of the
surrounding page, matching a video's own playback direction rather than the
reading direction around it. Other RTL behavior of the player (captions, the
control row, settings menus) is unaffected.
