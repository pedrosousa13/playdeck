---
'@playdeck/react': minor
---

`Player.Controls`' volume arrows now act on the muted zero the control is
showing rather than on the published volume hidden behind it (#274). Muted at a
published 0.5 the thumb sits at `0`, and the shortcut layer stepped `0.5` all
the same: `ArrowDown` moved to `0.45` — a step down from a number nothing on
screen displays — and, because `0.45 > 0`, it took the `muted && next > 0`
branch and **unmuted the player**. Pressing "quieter" made the video audible.

While muted with the thumb on that zero, `ArrowUp` unmutes and moves the volume
nowhere, and `ArrowDown` is a no-op. `muted` and `volume` are independent on
player state, so `unmute()` on its own restores the published level — the arrow
never has to compute from a value the control is not showing, and the level the
user left is not discarded the way treating the muted zero as an arithmetic base
would discard it. Downward has nothing to do: the player is already silent, and
"less" must not produce sound.

**One muted case still moves the volume.** At a published volume of `0`,
unmuting alone restores silence and the press looks dead, so `ArrowUp` there
unmutes _and_ steps to `0.05`. That is the only value a muted arrow moves the
volume to that the player was not already holding: everywhere else a muted
`ArrowUp` asks for the published volume itself, which leaves every state value
on the player where it was and is there to record where the unmute is going —
see the round trip below. A muted arrow pressed over a change the player has not
answered yet steps it, as it always has.

**That redundant `setVolume` is not free of events on YouTube.** It moves no
state value on any provider, but the YouTube adapter emits a volume intent on
every accepted `setVolume` whether or not the number moved, and the controller
does not dedupe, so a YouTube consumer listening for `volumechange` now sees one
extra, value-identical event per muted `ArrowUp` where one fired before —
analytics counting those events counts one more. Native is genuinely inert and
HLS delegates to it; Vimeo and Wistia re-emit only when the provider refuses the
change. The YouTube emit is a provider-honesty defect of its own — an event
reporting a change that did not happen — and is tracked as
[#365](https://github.com/pedrosousa13/playdeck/issues/365) rather than fixed
under this issue.

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
muted-adjusted volume the thumb is already showing — from the unmute above, or
from a pointer drag up off the muted zero — so an arrow pressed over one
compounds on it at 0.05 as it always has, downward included. Reverting to the
published base there would have re-introduced this issue's own complaint in
mirror image: an arrow ignoring the value the control _is_ showing.

That is also why the unmute records a request rather than nothing at all, and
what keeps the round-trip coalescing #271 introduced intact through it. The
player publishes `muted: false` a round trip later, so two presses inside one
would both find `muted` true and no request outstanding, both take the branch,
and the second would step nothing — the lost press #271 was filed over, on the
muted path. Recording the published level gives the second press the base the
first was restoring, so muted at `0.5`, `ArrowUp` `ArrowUp` lands on `0.55`. The
thumb moves to the restored level at once, before the player has published the
unmute — it is showing what the arrows are acting on, which is the whole of what
#274 asks for.

That base also had to survive the command settling. A muted player publishes a
volume of `0` however loud it is, so the volume request now takes that zero as
an answer only to a request for silence; it previously took it as an answer to
anything inside the 0.02 echo tolerance. Muted at a published `0.02` or less —
reachable through a consumer `step`, a consumer `setVolume(0.01)`, or YouTube's
rounding to whole percent — the base was released the moment the command
settled, and the press after it found no request, re-entered the muted branch,
unmuted again and stepped nothing: the same lost press, one branch over. Above
zero the deadline armed at the drain is still what releases a request no unmute
ever answers, so a provider that refuses `unmute()` while accepting `setVolume`
shows the restored level for that window and then falls back to the muted zero.

Unmuted behaviour is untouched, and so is `VolumeSlider`'s own `onChange`. Its
`muted && next > 0` unmute is correct where it stands — a pointer, `Home` or
`End` change genuinely starts from the displayed zero, so dragging up off it
means "unmute at this level" and still does.

It lands as `minor` rather than `patch`: no API changed, but what a released
version does with two keys did. A consumer who relied on `ArrowDown` unmuting,
or on a muted `ArrowUp` landing one step above the remembered volume, sees
different behaviour.
