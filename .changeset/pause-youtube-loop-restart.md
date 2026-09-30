---
'@playdeck/provider-youtube': patch
---

Fix a looping viewport-autoplayed YouTube player auto-pausing only on its first exit

A YouTube loop restart's `PLAYING` state change goes through the same path
as a viewer resuming from the platform's own chrome, carrying the
`'provider'` origin. `@playdeck/react`'s ownership rule reads any
non-`'autoplay'` play as the viewer taking over, so a looping YouTube player
started by viewport autoplay auto-pauses correctly on its first exit and
then never again — it plays on indefinitely once scrolled offscreen, the
same shape `@playdeck/provider-native` fixed for its own loop restart.

A loop restart is the library continuing playback it started, not the
viewer's. `boundary.ts`'s `restartFromBoundary` labels the `PLAYING` state
change its own deferred `playVideo()` call produces `'system'` — the
`PlayerEventOrigin` member `@playdeck/provider-native` already uses for the
same shape — and a `PLAYING` change YouTube's own end-of-media event
triggers with `loop` set carries the same label, since nothing but a loop
restart can produce it. `@playdeck/react`'s ownership tracker already treats
a `'system'` play as no takeover, so it needs no change of its own.
