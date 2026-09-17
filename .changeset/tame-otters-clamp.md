---
'@playdeck/react': patch
---

Stop both shipped stylesheets lowering the touch-target floor below 44px on phones

`theme.css` and `docked.css` each set `--playdeck-control-min-size` to
`2.5rem` (40px) and `--playdeck-seek-slider-min-block-size` to `1.5rem` (24px)
inside their own `48rem` phone media query. The primitives that size every
button and the seek slider (`controlTargetStyle` in `loading-error.tsx`, the
constant beside `SeekSlider` in `transport-controls.tsx`) read these two
tokens directly as `min-width`/`min-height`, so the lowered value was obeyed
outright below 48rem: importing either stylesheet dropped every button to
40px and the seek slider to 24px on phones, exactly where a touch target
matters most. Playdeck commits to WCAG 2.2 SC 2.5.5 _Target Size (Enhanced)_,
44x44 CSS px, so this was a defect in both shipped themes.

Neither stylesheet's phone query sets either floor token any more. A consumer
importing `theme.css` or `docked.css` will see every control-bar button and
the seek slider hold 44px at every viewport width, including below 48rem,
where they previously measured 40px and 24px. `theme.css`'s and `docked.css`'s
own "below 48rem" query still shrinks the button box itself
(`--playdeck-control-size: 2.5rem`) for the row-two layout fix (#622) — CSS
`min-width`/`min-height` always win over a smaller `width`/`height`
regardless of which rule set which, so the rendered button is unaffected and
stays 44x44. The floating control bar is taller below 48rem than before
(about 96px rather than the previous ~76px budget) because the seek row no
longer shrinks either; no control wraps, scrolls, or is dropped at any width
this package tests.

Every code comment that named WCAG 2.5.8 beside a 44px figure now names SC
2.5.5, the correct citation for that figure — 2.5.8 is the 24x24 AA minimum,
not 44x44.
