---
'@playdeck/react': patch
---

`SeekSlider` now shows the position the user last asked for until the media
answers for it, and coalesces the seek commands a drag issues (#185). The
control wired every change event straight to `controller.seekTo` and pinned its
thumb to `PlayerState.currentTime`, so a drag through five positions issued five
commands, and mid-drag the thumb read back the time from _before_ the drag. On
the native and HLS providers the echo is fast enough to hide that; on the iframe
embeds, where each seek is an asynchronous cross-document round trip, the thumb
visibly lagged or fought the pointer while the commands queued behind one
another.

Commands are coalesced by trailing-edge supersession: one in flight at a time,
and a change arriving during it overwrites the pending position rather than
queuing behind it. Five change events in one tick therefore issue two commands —
the leading one, and the one the four behind it collapsed into — and the last of
them is still the drag's final position.

There is no drag detection and there are no pointer handlers. A drag is a burst
of change events and an arrow press is a single one, and the two are not
distinguished, so a keyboard seek previews exactly as a drag does, a single
arrow press remains exactly one immediate seek, and nothing depends on a release
event the keyboard never sends. The preview is released on the first of: the
reported time landing within half a second of it once the command chain has
drained, a two-second deadline armed from that same moment, a command that
failed, a replaced provider, or a seek window that has vanished. While it is
held it is clamped into the window the way media time is, because a live DVR
window can slide out from under it, and `aria-valuetext` reads the position the
thumb is showing, so a screen reader is never contradicted by the visual.

Coalescing made two failures matter that fire-and-forget had absorbed, and both
are handled here rather than left to the adapters:

- **A seek command that never settles no longer kills seeking for the session.**
  Nothing below this layer has a timeout, and the iframe providers hand back raw
  SDK promises across a `postMessage` bridge that a torn-down frame or a dropped
  message can leave unsettled forever. A chain that never drained would swallow
  every later change into the pending slot. Each command is now raced against
  four seconds and reconciles like a failed one if it loses.
- **A source swap mid-drag no longer scrubs the new media to a position chosen
  on the old one.** A position queued behind an in-flight command is abandoned
  when the provider changes or when the seek window goes, which is how a swap
  between two sources of the same provider kind shows up.

Two things a consumer will see. A seek issued from outside the control —
`actions.seekTo(0)` from a menu item, say — moves the media at once but does not
move the thumb while a preview is held; it appears when the preview releases, up
to the two-second deadline after the last command settles. And the echo
tolerance is stated against the control's default `step` of 1: an
`inputProps.step` below half a second moves the preview less than the tolerance,
so a single arrow press at that step reads the time from before the press as an
answer to it and the thumb reverts as soon as the command settles — which is
what it did at every step before this release.

It lands as `patch`. Nothing is added and nothing is taken away: `SeekSliderProps`
is byte-identical, no export is new, and the set of attributes the library owns
against `inputProps` is the set it already owned — `step`, `onChange`, labelling
and styling all still apply, and a supplied change handler still receives every
change event. That is the line `idle-seek-slider-is-not-operable` drew on this
same primitive: it went `minor` because it seized `aria-disabled` from the
`inputProps` escape hatch, and this release seizes nothing.
