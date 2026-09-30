---
'@playdeck/react': patch
---

Ignore the primary pointer's lift when a second pointer joined it in `Gestures`

`Gestures` listens for `pointerdown` in addition to `pointerup`. When a
non-primary pointer goes down while the primary pointer is still down, the
primary pointer's own next `pointerup` does not count as a tap: it does not
toggle controls, does not start a pending single tap, and does not complete
a double tap. Any single tap still pending from an earlier, genuine tap is
left untouched by the ignored lift. The primary pointer's own lift clears
the record, so an ordinary tap or double tap right after a multi-touch
gesture toggles controls or seeks normally, whether or not a `pointerdown`
preceded it on the layer.
