---
'@reely/react': patch
---

The volume control now shows the volume the user last asked for until the media
element confirms it, and no longer drops a press that lands while published
state is catching up (#271). `VolumeSlider` is controlled from
`PlayerState.volume`, which moves only on the media element's asynchronous
`volumechange`: on a change React held no new volume yet, so it restored the
input's value to the old one and committed the real one milliseconds later, and
a range input fires no `input` and no `change` when a key asks it for the value
it already holds. A press arriving inside that window vanished with no feedback
— `End`, `Home` and a pointer drag all took that path, and pressing `End`,
`Home`, `End` in quick succession left the player silent on `Home` rather than
back at the maximum it was showing.

**The volume arrows now compound.** They never reached the input at all: the
shortcut layer owns them and computed its next value as the published volume
plus a step, so two presses inside one round trip read the same base and asked
for the same target. From a published `0.5`, `ArrowUp` then `ArrowDown` left you
at `0.45` — a symmetric pair of presses leaving you quieter than you started.
It now returns you to `0.5`, because the base is the volume still outstanding
whenever there is one. N presses move N steps, clamped at either end.

Volume commands are coalesced the way seek commands already were: one in flight
at a time, and a change arriving during it overwrites the pending volume rather
than queuing behind it, so N rapid changes issue fewer than N commands — a drag
through a dozen volumes costs far fewer than a dozen round trips and still ends
on the drag's last one. The rendered value still moves on every one of them: the
coalescing is in the traffic to the player, not in what the control shows, and
no press is lost. It bites hardest where the changes arrive in one tick, as a
drag's do; presses far enough apart for the command in flight to settle between
them each get their own.

The request is released on the first of: a published volume landing within
`0.02` of it once the command chain has drained, a two-second deadline armed
from that same moment, a command that failed, or a replaced provider. While it
is held it outranks the muted zero, so dragging up out of a muted player shows
the volume being asked for instead of the zero the player is still reporting,
and `aria-valuetext` reads the percentage the thumb is showing, so a screen
reader is never contradicted by the visual.

Two things a consumer will see. A volume set from outside the control —
`actions.setVolume(0.2)` from a consumer's own UI, say — moves the media at once
but does not move the thumb while a request is held; it appears when the request
releases, up to the two-second deadline after the last command settles. And the
echo tolerance is stated against the control's default `step` of `0.05`: a
`step` below `0.02` moves the request less than the tolerance, so a single
scrubbed increment at that step reads the volume from before it as an answer to
it and the thumb reverts as soon as the command settles — which is what it did
at every step before this release. The arrows are not that path. `step` governs
pointer scrubbing only, because the shortcut layer owns `ArrowUp`/`ArrowDown`
inside `Player.Controls` at its own fixed `0.05` and prevents the default before
the input steps (ADR-0005).

`PlayerState` is untouched. `volume` and `muted` stay event-driven and still
report only what the media element did, so a consumer reading state rather than
the control sees exactly what it saw before.

It lands as `patch`, on the line `seek-slider-shows-where-the-user-is` drew for
the same mechanism on the other control: nothing is added and nothing is taken
away. `VolumeSliderProps` is byte-identical, no export is new — the requested
volume lives on the player context and is not part of the public surface — and
the set of attributes the library owns against the props spread onto the input
is the set it already owned. `step`, `onChange`, labelling and styling all still
apply, and a supplied change handler still receives every change event and can
still `preventDefault` it. That is the difference from
`idle-seek-slider-is-not-operable`, which went `minor` because it seized
`aria-disabled` from an escape hatch; this release seizes nothing.
