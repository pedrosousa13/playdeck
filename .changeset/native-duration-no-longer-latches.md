---
'@playdeck/provider-native': minor
---

The native provider now publishes `duration` when the media element says it
changed. It listened for `durationchange` nowhere — the package's only such
listener fed chapters — and published a duration from one place, the media-state
snapshot, which runs on the attach snapshot, `canplay` and `loadedmetadata` and
on nothing else. `progress` republished `buffered` and `seekable`; `timeupdate`
republished `currentTime`; neither ever touched the duration (#400).

An element is entitled to revise its duration, and WebKit does: it publishes a
growing one while it is still parsing. `PlayerState.duration` therefore latched
whatever `media.duration` happened to read at the last of those three events and
never recovered, even after the element itself had converged.

**What a viewer got.** `SeekSlider` takes its `max` from
`seekWindow(duration, seekable)`, so a duration that never moves is a `max` that
never moves. On the ~1s reference clip the control froze at maxima between 0.05
and 0.56 while the element sat at 1.000333333, for the rest of the session. That
is not a mis-scaled control, it is an inoperable one: under the default
`step={1}` a `max` below 1 leaves `0` as the only value the input's grid can
express, so `End` snaps to the value the input already holds, no change event
fires, and no seek is ever issued — the mechanism #383 describes, reached here
through a bogus `max` rather than a genuinely short clip. Every other signal
says the press was seen.

**A narrow patch, not a second media-state snapshot.** Republishing the whole
snapshot was the obvious shape and is not what shipped. The snapshot rebuilds
`capabilities` and restates `lifecycle` and `activation`, three fields this
event has no news about, and `durationchange` also fires from the media load
algorithm with `readyState` back at 0 — so a `retry()` would have walked a ready
player back to `loading` on its way through. `durationchange` says one thing, so
it publishes one key, which is the shape `progress` already uses for `buffered`.

**Nothing is published for a duration that did not move.** A live stream fires
`durationchange` for an endless duration that normalizes to `null` every time,
and a reload fires one more for a `NaN`. The handler compares against the value
last put on the wire and stays silent when it held, so an endless duration
publishes exactly once and cannot flap, and no state change is fanned out for a
value nobody can observe changing. Liveness that such an event does move is
still published, because liveness is derived from the _raw_ duration, which is
what an endless stream's `Infinity` is.

**`seekable` is deliberately left where it was.** For a finite duration
`seekWindow` reads the duration and ignores the window entirely, and for the
live DVR case that does read it, `progress` is the event that reports the window
moving and already republishes it on every one. A duration changing says nothing
about the seekable window that a `progress` has not already said.

**What did not change.** `canplay` and `loadedmetadata` still publish the whole
media-state snapshot with the duration in it: this adds a publisher rather than
replacing one. Liveness, the at-edge flag and the endless-duration normalization
are untouched, and no field another seam owns is written from the new path.

It lands as `minor` rather than `patch` on the same reading as every other
behaviour change here: no API moved, but what a released adapter publishes did,
and a consumer asserting on the patch stream sees a patch that was not there
before.
