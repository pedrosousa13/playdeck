---
'@playdeck/react': minor
---

`Player.Controls`' volume arrows now act on the muted zero the control is
showing rather than on the published volume hidden behind it (#274). Muted at a
published 0.5 the thumb sits at `0`, and the shortcut layer stepped `0.5` all
the same: `ArrowDown` moved to `0.45` — a step down from a number nothing on
screen displays — and, because `0.45 > 0`, it took the `muted && next > 0`
branch and **unmuted the player**. Pressing "quieter" made the video audible.

While muted, `ArrowUp` unmutes and does nothing else, and `ArrowDown` is a
no-op. `muted` and `volume` are independent on player state, so `unmute()` on
its own restores the published level — the arrow never has to compute from a
value the control is not showing, and the level the user left is not discarded
the way treating the muted zero as an arithmetic base would discard it. Downward
has nothing to do: the player is already silent, and "less" must not produce
sound.

**One muted case still moves the volume.** At a published volume of `0`,
unmuting alone restores silence and the press looks dead, so `ArrowUp` there
unmutes _and_ steps to `0.05`. That is the only path on which a muted arrow
issues `setVolume`.

`ArrowDown` keeps preventing the default even though it does nothing.
[ADR-0005](https://github.com/pedrosousa13/playdeck/blob/main/docs/adr/0005-the-shortcut-layer-owns-its-keys-on-a-range-input.md)
gives the arrows to the layer wherever focus sits inside the region, a focused
`<input type="range">` included; a no-op that skipped `preventDefault()` would
hand the key back to `VolumeSlider`'s own stepping and produce exactly the
native step the ADR exists to suppress. The capability gate still runs _ahead_
of `preventDefault()`, so where `setVolume` is unavailable both arrows are left
whole for the page.

The muted branch applies only while no request is outstanding, which is the one
state in which the request and the published volume disagree. A request is the
muted-adjusted volume the thumb is already showing — from the step above, or
from a pointer drag up off the muted zero — so an arrow pressed over one
compounds on it at 0.05 as it always has, and the round-trip coalescing #271
introduced is unchanged. Reverting to the published base there would have
re-introduced this issue's own complaint in mirror image: an arrow ignoring the
value the control _is_ showing.

Unmuted behaviour is untouched, and so is `VolumeSlider`'s own `onChange`. Its
`muted && next > 0` unmute is correct where it stands — a pointer, `Home` or
`End` change genuinely starts from the displayed zero, so dragging up off it
means "unmute at this level" and still does.

It lands as `minor` rather than `patch`: no API changed, but what a released
version does with two keys did. A consumer who relied on `ArrowDown` unmuting,
or on a muted `ArrowUp` landing one step above the remembered volume, sees
different behaviour.
