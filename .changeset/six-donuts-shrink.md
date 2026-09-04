---
'@playdeck/react': minor
---

Read the seek slider's touch-target floor from `--playdeck-seek-slider-min-block-size`, not a literal 44

The wrapper `Player.SeekSlider` renders and the range input inside it both set
`minHeight: 44` as an inline style, so a theme could not shrink the seek row
below 44px the way `--playdeck-control-size` already lets it shrink the
button row (#598) — an inline style beats any stylesheet, and a literal has
no token underneath it for a stylesheet to override.

Both now read `var(--playdeck-seek-slider-min-block-size, 2.75rem)` instead,
the same move #598 made for every button-shaped control's own target. The
default is unchanged: a bare consumer with no stylesheet loaded still gets a
44px floor. `theme.css` and `docked.css` set the token to `1.5rem` — the WCAG
2.5.8 minimum — in their own "below 48rem" query, independently of the
button-row size, so the bar's own height can come down on a phone without
shrinking the button row's 40px target underneath it.
