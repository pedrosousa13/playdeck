---
'@playdeck/react': patch
---

`theme.css` draws a ring around both slider thumbs, from a new
`--playdeck-color-thumb-ring` token defaulting to `#000`, so the thumb clears the
3:1 floor WCAG 2.2 AA 1.4.11 puts under the visual boundary of a user-interface
component (#190). Composited over the `--playdeck-color-backdrop` default of
`#000`, the ring measures 3.13:1 against the unfilled track and 9.96:1 against
the loaded range, and the accent fill measures 8.10:1 against the ring itself.
`--playdeck-color-accent` is unchanged at `#3ea6ff`.

A ring rather than a different accent, because no accent value exists. At the
track and buffered defaults, a colour clearing 3:1 against the loaded range needs
a relative luminance at or above 1.4440 or at or below 0.1160 — and 1.4440 is
brighter than white, whose luminance is 1.0. The only colour satisfying both
surfaces is pure black, which reads as a gap in the bar rather than the control
you drag. 1.4.11 asks for contrast on the visual information that identifies the
component, and a boundary supplies that as well as a fill does. This settles what
the previous change deferred: the accent fill still reads 2.59:1 against the
track and 1.23:1 against the loaded range, and those two boundaries are now
carried by the ring instead of by the fill.

It lands as `patch`. The ring is read as `var(--playdeck-color-thumb-ring, #000)`
and is never declared by this file, so a value you set on the player or any
ancestor applies and the default is never consulted; `outline: none` on the thumb
removes it entirely. Only a consumer who mounts the theme and overrides nothing
sees a difference. The forced-colors branch, which maps these parts onto system
colour keywords, is untouched.

**Firefox is not fixed by this, and still fails 1.4.11.** Painted with `outline`
on `::-webkit-slider-thumb`, with no `appearance: none` — that is what keeps
`accent-color` painting the rest of the control. Measured on the three engines
the e2e suite runs: Blink honours either `outline` or `box-shadow` on the thumb
with `accent-color` intact, WebKit honours only `outline`, and Gecko honours
neither. The only properties that reach `::-moz-range-thumb` are ones that switch
native theming off, taking `accent-color` and the whole painted slider with them,
so there is no Gecko rule to write. Firefox therefore keeps the thumb it renders
today, which measures **1.20:1 against the track and 2.64:1 against the loaded
range** — both under the 3:1 floor. That gap stays owned by #190.

Worth knowing why those numbers are not the accent's: the thumb is only
accent-coloured on Blink. Measured with this stylesheet mounted over the backdrop
default, Blink paints it `rgb(62 166 255)`, WebKit paints it white, and Gecko
paints it `rgb(103 103 116)`; on WebKit and Gecko `accent-color` tints the filled
track and leaves the thumb alone. So the ring is not only correcting the accent —
on WebKit the white thumb already cleared the track at 6.71:1 but failed the
loaded range at 2.11:1, and the ring fixes a real failure there too.

This is the theme's first selector that is not specificity-zero: a pseudo-element
may not appear inside `:where()`, so the rule carries that pseudo-element's own
(0,0,1), which any single class of yours outranks. The guarantee that matters is
unchanged — the rule is inside `@layer playdeck`, and unlayered CSS beats a
cascade layer whatever its specificity.

`packages/react/test/theme.test.ts` composites the new token default out of the
shipped stylesheet alongside the others, asserts the three ring boundaries
against the 3:1 floor, and states the exact ratio of all nine slider boundaries,
so a default cannot move without restating what it does. It also freezes
`::-webkit-slider-thumb` into the CSS-feature inventory that guards the declared
browser-support floor.
