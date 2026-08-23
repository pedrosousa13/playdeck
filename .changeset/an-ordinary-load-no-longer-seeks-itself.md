---
'@playdeck/provider-native': patch
---

The native provider no longer writes an initial position onto the media element
when there is no start position to apply. `applyInitialPosition` ran on every
`loadedmetadata`, the default `startTime` of 0 included, where the value it
asked for was the one the media load algorithm had already put there.

A same-value `currentTime` write is not a no-op. It starts a seek, and #407
measured what a seek into a partly-parsed WebKit element costs: the write is
clamped into `seekable`, the playhead lands on the leading edge, the duration
freezes there permanently and the network goes to `stalled`. #411 measured that
same hazard reaching every native and HLS consumer through this line, on every
ordinary load — a viewer on a slow connection clicked play, the clip loaded
completely, and the player sat at 0:00 with no error, while the library reported
`playback: 'ended'` for a clip that never showed a frame. Clicking play a second
time recovered it, which is the kind of thing a viewer works around silently and
never reports.

Two writes are skipped now, for two reasons:

- `startTime` 0, because there is no start position to apply. The element is
  already at 0, and if metadata arrives after playback has begun, writing 0 is
  not applying a start position — it is rewinding playback that already
  happened.
- A `startTime` above 0 that the element is already sitting on, because asking
  the element for the position it holds buys nothing and costs the same seek.

A real `startTime` still reaches the element on every load, and still after a
`retry()`. What changes for a consumer who never set one is that the element is
left alone: no seek, and no seek to freeze a partly-parsed source at 0:00.

**One behaviour beyond the defect changes with it.** On a live source the
skipped write was never a same-value write, so this is the one place a consumer
can see the difference. A DVR window that starts above 0 — `seekable` of
`[[100, 200]]`, an endless duration — has no point at 0 for the default
`startTime` of 0 to be clamped to, so `withinMediaBounds` returned the nearest
one it had, the back of the window, and every load rewound the viewer to the
oldest thing in the DVR buffer. Nothing asked for that; it fell out of clamping
a request that should not have been made. The position is now left where the
engine placed it, which for a live stream is the live edge, and a unit test
pins it.

**Why `patch` and not `minor`.** This is an intentional behaviour change, so
the level has to be argued rather than assumed. `PlayerState` gains no field
and loses none, no signature moves, and nothing a consumer calls answers
differently: what changes is a `currentTime` write onto an element the consumer
does not own, and the observable difference is the absence of a seek that
served no one. For a consumer without a `startTime` the element is left at the
position the media load algorithm already gave it — 0 — which is the position
the removed write asked for. For one with a `startTime` the position is
unchanged, and it still lands on every load and after a `retry()`. The live
case does move an observable position, and it moves it from a value nobody
requested to the engine's own, which is the fix rather than a second change to
absorb. `07e47c3` is the precedent this leans on: the subscriber fan-out
isolation changed behaviour on every provider and released at `patch`, because
`patch` answers to a defect fix behind an unchanged surface, not to the absence
of a behaviour change. `native-duration-no-longer-latches.md` went `minor` for
the opposite reason — `PlayerState.duration` is surface and what it carried
moved. Nothing here is surface.
