---
'@playdeck/react': patch
---

`theme.css` now draws the ring around the Firefox slider thumb too, and draws
that engine's track and progress fill by hand to pay for it (#190). Both sliders
are covered. Nothing changes on Chromium or Safari — measured, not assumed: with
the new rules in and out, their screenshots are byte-identical, because
`::-moz-*` is inert there and needs no feature query.

The previous change said Gecko honoured nothing on `::-moz-range-thumb` and that
a rule naming it would be dead CSS. Pixel-differencing real builds says
otherwise, in two parts. `outline` and `box-shadow` really are no-ops there —
those are what had been probed. `background-color`, `border` and the thumb's own
box metrics are honoured. What makes the ring expensive is the consequence: the
first paint property to land on any part of a Gecko range input switches the
native widget off for the whole control, so `accent-color` stops filling the
progress and the native track stops painting at all. Colouring the thumb alone
does not add a ring to the shipped slider, it deletes the slider and leaves a
ring — and the volume slider, which the theme paints no bar for, collapses to a
bare thumb.

So `::-moz-range-track`, `::-moz-range-progress` and `::-moz-range-thumb` are
one unit, and each reads a token this file already reads
(`--playdeck-color-track`, `--playdeck-color-accent`,
`--playdeck-slider-thickness`, `--playdeck-color-thumb-ring`). No token is
added, no default moves, and every one is still read as `var(name, default)` and
never declared, so one consumer value restyles every engine.

**The three Gecko rules are held inside `@media (forced-colors: none)`,** which
is not tidiness. Switching the native widget off also gives up the forced-colors
rendering that came with it, and the theme's `forced-colors: active` block maps
no range part. Measured on the volume slider in Firefox with the rules
unguarded: the progress fill and the unfilled track both paint `rgb(255 255
255)` — one colour, 1.00:1, a slider stating no value — and the thumb reaches
`rgb(240 240 240)` inside a `rgb(153 153 153)` border, 1.14:1 and 2.85:1 against
the canvas. Left native, the same slider paints a `rgb(0 0 0)` fill against a
`rgb(233 233 237)` track at 17.34:1. So the ring, which exists to buy contrast,
steps aside in the one mode where the platform already supplies more of it than
the ring can. Chromium renders the same row of pixels either way, forced colors
included, because `::-moz-*` never reached it.

Measured on the volume slider, where the theme covers the control with nothing
and a screenshot shows the slider itself, Firefox goes from a grey native thumb
at **2.15:1 against the filled track** to a `#000` ring at **8.10:1**, and holds
**3.55:1** against the unfilled track. Chromium and Safari stay at 8.10:1 against
the filled track. `e2e/thumb-contrast.spec.ts` is the gate, and it samples
rendered pixels rather than compositing tokens: it asserts the ring reaches the
screen as `#000` on all three engines, which is exactly what a rule that no-ops
on its target engine cannot do.

**Two boundaries this does not clear, both now measured and recorded rather than
implied.** On Blink and WebKit the volume slider's unfilled track is the
engine's own and the theme never colours it, so the ring reads 1.87:1 and 1.07:1
there. And on the seek slider no engine clears either boundary: `SeekSlider`
renders `seek-buffered` before the input and this file positions it absolutely
while the input stays in flow, so the theme's own translucent bar paints over
the native control on Blink and Gecko and lifts the whole thumb towards white —
a `#000` ring reaches the screen as `rgb(92 92 92)` under one veil and
`rgb(206 206 206)` under two. No ring colour escapes that, because the veil puts
a floor under how dark the ring can land and a ceiling under how light. WebKit
fails the same two for the opposite reason: the bar never reaches the screen
there, and the unfilled native track is near-black already. That overlay is
owned by #415 — in forced-colors mode it is opaque rather than translucent and
hides the seek thumb outright, on every engine and on both sides of this change.

Those are the ratios the token arithmetic in `packages/react/test/theme.test.ts`
cannot see, and both test files now say so. Clearing them means `appearance:
none` and a hand-drawn control on all three engines, which is a larger change
than #190 decided on.
