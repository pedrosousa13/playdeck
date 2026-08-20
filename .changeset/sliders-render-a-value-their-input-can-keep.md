---
'@playdeck/react': minor
---

`Player.SeekSlider` and `Player.VolumeSlider` now snap the value they render
onto the `step` grid their input is rendered with, so the value the library
hands the control is always one the control can keep.

A range input keeps only the values its own grid can express: the HTML value
sanitisation algorithm clamps into `[min, max]` and then snaps to the nearest
step, ties going to the higher. Both sliders render what the media publishes
rather than what the user chose, and neither published value has any reason to
land on that grid — a seek window of `[0, 1]` under the default 1s step has two
values it can express and `currentTime` is a float between them, and a chain of
0.05 volume steps drifts off its own grid in floating point.

**What that cost.** React records the string it assigned to `value`; the input
records the string it kept. Hand it one it cannot keep and those two disagree
from then on, and React drops a change event whose new value equals the string
its tracker is holding. The press behind that event issues no command at all,
while every other signal says it was seen: the thumb moves, the keydown fires,
`aria-valuetext` updates, and only the media never arrives. Measured on the ~1s
reference clip, mid-playback: React assigned `0.505738182`, the input kept `1`,
and the tracker went on holding `0.505738182`.

`aria-valuetext` was reading off the same unsnapped value, so it disagreed with
the thumb beside it by up to half a step — `0:00 of 0:01` while the thumb sat
hard right. It now reads the snapped value, which is the policy `VolumeSlider`'s
percentage already followed: assistive technology is never told the opposite of
what a sighted user is being shown.

**What it does not change.** Nothing downstream reads the rendered value. A
command still carries the value read back off the DOM on the change event, the
preview policy still compares against what was requested, and `Player.Controls`'
volume arrows still compute from the outstanding request rather than from the
thumb — so no command this library issues moves by so much as a step. `step="any"`
turns snapping off, which is what the attribute means, and a consumer `step` is
the grid rather than the default.

**Where it is visible.** A control whose grid cannot express the published value
shows the nearest value it can, and says so. A volume of `0.37` under the default
0.05 step renders `0.35` and announces `35%`; it rendered `0.37`, announced
`37%`, and every real engine displayed `0.35` regardless. The change is that the
library now agrees with the engine instead of being silently corrected by it.

It lands as `minor` rather than `patch`: no API changed, but what a released
control renders and announces did, and a consumer asserting on either sees
different values.

**Found under #277, and not the cause of #277.** This defect was found while
investigating #277, a WebKit-only CI failure in which three pipelined seek
presses leave the media at the start of the seek window. The tracker desync
above was the only known mechanism that produced that shape, so it was fixed and
the WebKit leg of `e2e/rapid-slider-presses.spec.ts` was re-enabled as the
experiment. The experiment came back negative: the failure survived the fix.
Instrumenting the media element then showed that the third press does issue its
seek and that WebKit completes that seek at the superseded position, so #277 is
an engine bug closed as wontfix and that leg is excluded from WebKit
permanently. The snapping change stands on its own regardless: a control handed
values its input cannot keep is a defect whatever #277 turned out to be.

**A short window is still a coarse control.** Snapping makes the control honest
about its grid; it does not add positions to it. On a window of ~1s the default
1s step still leaves two, so a press asking for an end the thumb already sits at
moves nothing and seeks nowhere on every engine — no event is fired for the
library to act on. That is [#383](https://github.com/pedrosousa13/playdeck/issues/383),
which needs a decision about the step and about ADR-0005's arrow ownership with
it, and is not made here.
