---
'@playdeck/provider-vimeo': patch
---

Report playback progress when the Vimeo SDK sends no playback events

Some Vimeo videos play in the embed while the SDK reports none of `play`,
`playing` or `timeupdate` at all, so `currentTime` reads 0s forever and
`play()` never settles even though the embed is visibly advancing.

After a play request, the adapter waits up to two seconds for a real
`timeupdate` before concluding this embed will not fire playback events, then
polls `getCurrentTime()` and `getPaused()` every 250ms and publishes the
results through the same state the real event would have. The poll stops the
moment a real `timeupdate`, `pause` or `ended` event arrives, when it finds
the embed paused itself, and on destroy, so a video whose events work as
normal is never polled at all.
