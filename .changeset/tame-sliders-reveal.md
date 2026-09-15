---
'@playdeck/react': patch
---

Scope the volume slider's hidden rest state to its mute-button sibling

Under `(pointer: fine)`, both `theme.css` and `docked.css` put
`[data-playdeck-part='volume-slider']` at `opacity: 0; pointer-events: none`
at rest, revealing it on the adjacent mute button's hover/focus-within or on
the slider's own hover/focus-within. `pointer-events: none` removes an
element from hit testing, so a slider mounted with no adjacent
`Player.MuteButton` could never match its own `:hover` branch — it was
invisible and pointer-unreachable, reachable only by Tab. That is the defect
#598 filed as "A lone VolumeSlider is invisible and unreachable on a fine
pointer".

The hidden rest state is now scoped to the adjacent-sibling relationship —
`[data-playdeck-part='mute-button'] + [data-playdeck-part='volume-slider']`
— rather than naming the slider bare. A `VolumeSlider` composed beside a
`MuteButton` behaves exactly as before: hidden at rest, revealed on either
element's hover or focus. A `VolumeSlider` composed alone is now simply
visible and interactive at rest, in both themes. `docked.css`'s own copy of
the rule also sets the slider's `inline-size`, which stays on the bare
selector so a standalone slider keeps its width.
