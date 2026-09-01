---
'@playdeck/provider-native': patch
---

Apply `startTime` against the media's duration, and confirm the playhead got there

The offset used to be clamped into the element's `seekable` ranges, which asked
one attribute two questions it cannot both answer. On an origin that serves no
byte ranges the window at the first `loadedmetadata` is zero-length or a
fraction of the clip, while the element's own `duration` is already correct — 10
on a ten-second clip in 96 of 96 measured loads across chromium and firefox — so
the clamp answered with a position from a window that had not filled in yet.

Now the duration supplies the bound, which is what still refuses an offset past
the end of the media, and `seekable` decides only whether the element will move
at all. A window that does not reach the offset is a refusal rather than an
instruction to land on its nearest edge, so a live source no longer answers a
`startTime` below its DVR window with the back of that window.

The playhead is then read back to confirm it arrived. That closes the case this
change would otherwise have opened: a chromium element reporting `seekable
[[0, 0]]` declines a write permanently — it still sat at 0 after `readyState 4`
and the whole clip buffered — so a duration-bounded offset written there would
have reported success while doing nothing. Where the playhead did not reach the
offset, the non-fatal `configuration` notice on `PlayerState.error` reports it,
as it already did for the offsets that never got written.

The notice's message no longer names the seekable window, since that is no
longer the only thing that can refuse an offset.

The read-back is a same-tick read, and that is not enough on WebKit, which
answers `currentTime` with the value it was just given and clamps afterwards. An
offset WebKit silently declines is therefore still unreported there. Treat the
refusal notice as a guarantee on chromium and firefox and as best-effort on
WebKit until #567 lands.
