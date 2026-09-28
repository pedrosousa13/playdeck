---
'@playdeck/react': patch
---

Stop `Player.Controls`' global arrow-key shortcuts from taking over a native
radio or range input, or a WAI-ARIA composite widget (`radiogroup`,
`tablist`, `slider`, `spinbutton`, `listbox`, `menu`, `menubar`, `tree`,
`treegrid`, `grid`, `toolbar`) elsewhere on the page.

With `global` shortcuts on, an arrow key aimed at one of these outside the
player used to run the matching seek or volume shortcut and call
`preventDefault()`, leaving the widget's own arrow-key navigation with
nothing. The shortcut layer now leaves the key alone there. "Outside the
player" is checked against `Player.Viewport`'s own bounding box where the
controls region renders inside one, so a consumer's own control composed
elsewhere in that box -- `SeekSlider` moved outside `Controls` included --
still counts as part of the player and keeps the layer's ownership of its
arrows, exactly as it did before. The layer still fires normally on any
other page content.
