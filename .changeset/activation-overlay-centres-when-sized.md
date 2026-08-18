---
'@playdeck/react': patch
---

`ActivationButton` now states `margin: auto` alongside its inline
`position: absolute; inset: 0`, so an overlay a stylesheet sizes down is
centred in its viewport instead of pinned to the top-left corner (#160). A
fixed size against four zero offsets is over-constrained, and CSS 2.1 §10.3.7
on the inline axis and §10.6.4 on the block axis resolved the excess into
`right`/`bottom` — the box landed at (0, 0). An `auto` margin is what absorbs
it instead, on both axes.

Nothing changes on the default path: with `inset: 0` and an auto width and
height those same two rules resolve the margins to zero, so an unstyled overlay
is still the full-bleed click target it was, and a headless overlay never had
the problem to begin with — a `<button>` centres its own content, so the
full-bleed box already put an icon child in the middle. The bundled
`theme.css`, whose 4rem circle is where this surfaced, is unchanged and now
renders centred; so does any consumer stylesheet that gives
`[data-playdeck-part='activation']` a size of its own, which for a headless
library is the case that matters. It stays overridable through the `style` prop
under the #89 rule, `margin` included.

One degenerate case does render differently: a box your CSS makes _larger_ than
the viewport. §10.3.7 clamps a negative inline-axis margin back to zero, so an
over-wide overlay still overflows to the right exactly as before; §10.6.4 has
no such clamp, so an over-tall one now overflows equally above and below
instead of only below.
