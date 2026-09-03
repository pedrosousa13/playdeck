---
'@playdeck/react': minor
---

Add `@playdeck/react/docked.css`, a second theme, and give both themes one control-bar contract

`docked.css` docks the control bar under the picture instead of overlaying it,
never auto-hides, and carries its own light and dark colour defaults. It is a
separate stylesheet rather than a variant of `theme.css`, and the two must not
be loaded on the same document: both open `@layer playdeck`, so two files
declaring that layer merge into one and compete for the selectors they share on
source order alone. Import one or the other.

`theme.css` also gains an auto-hiding, wrapping control bar. The bar splits onto
its own row for the seek slider below 48rem, the volume slider expands on hover
or focus instead of taking up permanent width, and the whole bar fades after
2500ms of no input while playing.

Alongside them, three fixes to `theme.css`: the seek and volume thumbs now sit
on their own track instead of drifting with the consumer's inherited font
(#541); the activation part's size is now a floor a consumer's own sizing and
label can grow past, rather than a fixed value that clipped or silently
overrode them (#552); and a bare player with no stylesheet no longer paints the
browser's own button face over its poster (#555).

That last fix changes what a consumer's own CSS can reach, which is why this is
a minor rather than a patch. `ActivationButton` now writes its fill and border
as inline styles that read `--playdeck-activation-fill` and
`--playdeck-activation-border`, so a plain `background` or `border` declaration
written against `[data-playdeck-part='activation']` in a stylesheet no longer
lands — an inline declaration beats any stylesheet, whatever its specificity.
Set the two custom properties instead, from anywhere the button inherits them:

```css
[data-playdeck-part='activation'] {
  --playdeck-activation-fill: #fff;
  --playdeck-activation-border: 1px solid #0003;
}
```

A `style` prop passed to `ActivationButton` is unaffected: it is spread after
the primitive's own styles and still wins.
