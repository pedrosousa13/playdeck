---
'@playdeck/react': patch
---

Ignore multi-touch, right-click and unseekable double taps in `Gestures`

`Gestures`' pointerup handler only treats a primary pointer's primary-button
release as a tap: a second touch point during a pinch (`isPrimary: false`)
and a non-primary mouse button such as a right-click (`button !== 0`) are
both ignored outright, neither toggling controls nor counting toward a
double tap. An ignored event leaves any pending first tap untouched, so one
landing between two real taps doesn't reset or consume the pending state.

A double tap that lands while `capabilities.seek` isn't `'available'` (a
live source with no DVR window, for example) calls neither
`seekByWithOrigin` nor `onSeek`. It also doesn't fall back to the
single-tap toggle: an unseekable double tap does nothing, since it was
never a single tap and toggling controls in response to two taps on the
video would contradict what the same gesture does everywhere else it
works.

`isNativeActivationTarget` (the check `Gestures` uses to ignore a tap that
lands on a real control) also recognizes a native `input[type="range"]`,
so a pointerup on a seek or volume slider composed inside the gesture layer
is ignored exactly like one on a button.
