---
'@playdeck/react': patch
---

The seek slider's loaded-range indicator no longer paints over the control it
annotates (#415). `SeekSlider` renders `seek-buffered` before the input and
`theme.css` positioned that bar while leaving the input in flow, so a positioned
element painted after in-flow content and the theme's own translucent bar
composited on top of the native slider — white at 0.36 alpha, and a second white
at 0.7 wherever a range was loaded. A `#000` thumb ring reached the screen as
`rgb(206 206 206)` and cleared 1.03:1 against the loaded range on all three
engines, against a 3:1 floor, while the contrast gate that reasons over token
defaults said 9.96:1.

The bar is behind the input now, and it is the slider's track: the theme draws
the seek control on all three engines rather than decorating each engine's own.
That is not a preference. Positioning the input alone hands the row back to the
engine's track and the loaded indicator stops stating anything — measured as
loaded against unfilled over the bar's four rows, 1.00:1 on all four on
Chromium, 2.10:1 on the two `::-moz-range-track` covers on Firefox, 3.49:1 on the
two WebKit's translucent track covers. And no rule silences that track while the
native appearance is on: a `::-webkit-slider-runnable-track` painted transparent
with no `appearance: none` beside it changes not one pixel on either engine.

So `appearance: none`, with `::-webkit-slider-thumb` carrying
`::-moz-range-thumb`'s declarations to the letter, and one 16px thumb drawn on
all three. Measured on `player-seekslider--with-buffered-ranges`, on the row
through the middle of the bar:

    ring vs unfilled track   chromium 2.48 -> 3.55   firefox 3.76 -> 3.55
                             webkit   3.76 -> 3.55
    ring vs loaded range     chromium 1.11 -> 13.73  firefox 1.03 -> 13.73
                             webkit   1.03 -> 13.73
    loaded vs unfilled       chromium 2.76 -> 3.86   firefox 3.86 -> 3.86
                             webkit   3.86 -> 3.86

Every pixel in those pairs is now painted from this file's own tokens, which is
why the three engines agree exactly rather than to a band, and why the two
figures that fell did so onto a floor they clear rather than off one.

Turning the native widget off takes `accent-color` with it, and neither Blink nor
WebKit offers a pseudo-element for a range's filled part. `SeekSlider` therefore
renders a new part, `seek-progress` — the span of the seek window before the
current position, placed by the primitive like the loaded ranges beside it and
painted by CSS. The seek slider looks the same as it did; it is drawn by
different hands.

Forced colors is unchanged, deliberately. There the platform draws the control
and `seek-buffered` is opaque, so it still hides the thumb — the same defect, and
both ways out cost more than they buy: positioning the input takes the loaded
range from 21.00:1 to 1.00:1 on Chromium, and drawing the control by hand there
flattens Gecko's thumb to between 2.05:1 and 2.85:1 against the canvas, which is
the trade #190 already refused on the same measurement. Both halves of what is
left are asserted rather than left silent.

The contrast gate now composites a loaded range over the track it nests inside
rather than over the ground behind it, because that is where it paints. No
assertion is weakened: `buffered vs track` moves from 3.18:1 to 4.26:1 and `ring
vs buffered` from 9.96:1 to 13.35:1, and the seek-slider pixel test that recorded
the failing state now records the fixed one.
