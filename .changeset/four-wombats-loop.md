---
'@playdeck/provider-native': patch
'@playdeck/react': patch
---

Fix a looping viewport-autoplayed player auto-pausing only on its first exit

`restartFromBoundary` plays the media directly to restart a loop, and the
resulting `play` event went through the same path as a viewer pressing the
native controls, carrying the `'provider'` origin. #309's ownership rule
reads any non-`'autoplay'` play as the viewer taking over, so a looping
player started by viewport autoplay auto-paused correctly on its first exit
and then never again — it played on indefinitely once scrolled offscreen.

A loop restart is the library continuing playback it started, not the
viewer's. `restartFromBoundary` now labels its own `play` event `'system'`
— the existing `PlayerEventOrigin` member that was declared and never
emitted — and `use-activation.ts`'s ownership tracker treats a `'system'`
play as no takeover at all, leaving whatever ownership already stood
(`'autoplaying'` or `'none'`) exactly where it was. No new origin, and no
further breaking change to `@playdeck/core`.

A natural end of media (the `onEnded` loop path, with no `endTime`
configured) also fires a real `pause` event of its own before `restartFromBoundary`
runs, since the underlying element is never given the native `loop`
attribute — Playdeck implements looping itself. That pause used to publish
with the same `'provider'` origin, handing ownership away before the loop's
`play` event ever arrived. It is now suppressed the same way the
`endTime`-boundary path already suppresses its own boundary-induced pause,
read off `media.ended` rather than a new flag.

`provider-hls` needs no change of its own: both engines play into the same
`<video>` element through an embedded `@playdeck/provider-native` adapter,
so this fix reaches a looping HLS source through the same code path.
