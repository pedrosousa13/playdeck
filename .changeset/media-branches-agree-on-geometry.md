---
'@reely/react': patch
---

`Player.Media`'s three return branches now state the same geometry, and state
it as a default your `style` prop overrides (#150). The branches disagreed on
both counts: the YouTube and Vimeo mounts filled their viewport but discarded a
colliding `style` property outright, while the native `<video>` read `style`
and set no size at all — so a consumer who shipped no stylesheet got an
intrinsically-sized frame in the corner instead of one filling the viewport it
was laid into. All three are now `position: relative; z-index: 0; width: 100%;
height: 100%` under the #89 rule, so a `style` you pass and saw ignored on a
YouTube or Vimeo source now takes effect.

The native `<video>` also states `object-fit: contain`: the frame is content,
so a box that does not match its aspect ratio has to letterbox rather than crop
away part of the picture, and cropping is available by passing
`objectFit: 'cover'` through `style`. This matches what browsers already apply
to `<video>` and what `theme.css` already sized the layer to, so themed
rendering is unchanged; it is the unthemed, headless case that this fixes.
