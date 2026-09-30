---
'@playdeck/provider-youtube': patch
'@playdeck/react': patch
---

Fix a looping viewport-autoplayed YouTube player auto-pausing only on its first exit

A YouTube loop restart's `PLAYING` state change goes through the same path
as a viewer resuming from the platform's own chrome, carrying the
`'provider'` origin, and a loop with no start boundary also fires a real
`ended` on every iteration of YouTube's own playlist loop. `@playdeck/react`'s
ownership rules read any non-`'autoplay'` play as the viewer taking over and
drop ownership unconditionally on every `ended`, so a looping YouTube player
started by viewport autoplay auto-pauses correctly on its first exit and
then never again — it plays on indefinitely once scrolled offscreen, the
same shape `@playdeck/provider-native` fixed for its own loop restart.

A loop restart is the library continuing playback it started, not the
viewer's, and neither is the `ended` a platform-driven wrap fires along the
way. `boundary.ts`'s `restartFromBoundary` labels the `PLAYING` state change
its own deferred `playVideo()` call produces `'system'` — the
`PlayerEventOrigin` member `@playdeck/provider-native` already uses for the
same shape — and a `PLAYING` or `ended` change YouTube's own platform loop
triggers carries the same label, since nothing but that loop can produce
either. `@playdeck/react`'s ownership tracker treats both a `'system'` play
and a `'system'` ended as no takeover, so a viewport session's ownership
survives as many wraps as it crosses however they reach it — a configured
`startTime`, an `endTime` boundary, or a plain loop with neither.
