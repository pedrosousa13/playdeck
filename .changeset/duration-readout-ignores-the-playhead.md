---
'@reely/react': patch
---

`Player.Time type="duration"` no longer re-renders as the playhead moves. The
component selected `currentTime` whatever its `type`, and the selected object is
shallow-compared, so a duration readout woke on every `timeupdate` — several
times a second — to print text that changes once per source. A `type` that does
not read the playhead no longer subscribes to it; `current` and `remaining`
still follow it, because for them it is the value on screen.

Nothing renders differently. This is render count only, and it is most visible
in a control bar that mounts a duration readout beside a seek slider.
