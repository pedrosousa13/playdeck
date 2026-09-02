---
'@playdeck/provider-native': patch
'@playdeck/provider-hls': patch
---

Stop a player parked on `endTime` from seeking over and over

A native player that reached its `endTime` corrected the playhead back onto the
boundary on every `timeupdate` it received there, and each correction is a
write to `currentTime` — a seek, which reports a `timeupdate` of its own at the
position it just landed on. That report is still on the boundary, so it asked
for the same correction again. Measured on 2026-09-02 in chromium, driving a
local 10 second MP4 from a standalone rig: 3,010 `seeking`, 3,024 `timeupdate`
and 3,009 `seeked` events in a three-second window at the boundary, with no sign
of settling.

The correction is now issued only where it has somewhere to move — the playhead
is neither on `endTime` nor still sitting where the last correction left it —
so a parked player is left alone and an overshoot is still pulled back,
including one that arrives after playback has already ended. The second half
matters because an element need not land on the value written: the seek
algorithm clamps into `seekable` and engines snap to a frame, so a playhead that
settles just past the boundary would otherwise keep asking to be corrected.

The position and the `ended` state were correct throughout; what was wrong was
the work and what the player said about itself. `PlayerState.seeking` was
raised by every one of those seeks and read `true` on a player that had
stopped, which is what a seek indicator or a scrubber disabled while seeking
was reading. It now returns to `false` and stays there.

The HLS provider composes the native adapter, so it inherits this.
