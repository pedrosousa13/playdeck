---
'@playdeck/react': minor
---

Pause viewport-started playback on exit, resume it on re-entry

`loading: 'viewport'` activated a provider on first intersection and, with
autoplay, started playback there — but the `IntersectionObserver` behind it
latched once both gates were crossed and never acted on a later crossing, so a
player that scrolled out of view kept playing indefinitely, and scrolling back
did nothing either way (#309).

The observer now lives for the whole session under `loading: 'viewport'`
instead of self-disconnecting. It reads a new `playbackOwnership` record —
`'none'`, `'autoplaying'` or `'auto-paused'` — kept by watching the controller's
own `play` and `pause` events for the `'autoplay'` origin `#playWithOrigin`
already threads: exit pauses playback only while ownership reads
`'autoplaying'`, and re-entry resumes it only while ownership reads
`'auto-paused'`. Resumed playback is issued under the same `'autoplay'` origin,
so a later exit still recognises it as the viewport's to pause.

This is new behaviour under an existing default, not a new prop, so it is a
minor bump rather than a major one — but it is a real behaviour change a
consumer should know about. **A player that autoplayed by scrolling into view
and was relied on to keep playing offscreen will now stop** the moment it
leaves the viewport. **A viewer's own play or pause is never overridden**: only
playback the viewport itself started is paused on exit, and only a pause the
viewport itself issued is resumed on re-entry — a viewer who presses play
before scrolling away is left running, and a viewer who pauses deliberately is
never resumed by scrolling back.

Only `loading: 'viewport'` is affected. `'eager'` and `'interaction'` start
playback the viewport never owns, so neither is touched.
