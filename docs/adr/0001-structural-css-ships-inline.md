# Structural CSS ships inline, not as a stylesheet

Reely could ship the geometry its primitives need — `position`, `inset`,
`z-index`, the media element filling its viewport — as a small `base.css`
alongside the optional `theme.css`, the way most component libraries do. We set
it inline on each primitive instead, and reserve stylesheets for appearance.

A `base.css` has to be imported to work, and a player whose overlays don't stack
until you remember an import is broken by default. `theme.css` can be optional
because it only changes how the player looks; structure cannot. Setting it
inline is what makes the zero-import path correct, and what lets `Theme.mdx`
claim "Add one import. That is the whole difference." — the difference is
appearance, not function.

The cost is real. An inline style beats every stylesheet a consumer can write,
so a structural value is overridable only through the `style` prop — which is
why #89 spreads static geometry _before_ `...style`, to keep that escape hatch
open. A consumer on CSS modules or utility classes cannot restyle geometry with
CSS at all. Where a structural value is one consumers plausibly want to change
from a stylesheet, the mitigation is a custom-property default rather than a
literal: `PosterImage` already reads `object-fit: var(--reely-poster-fit,
cover)`, which resolves through the cascade, so a consumer rule setting that
token on any ancestor wins without importing anything.

## The boundary

- **Inline, on the primitive** — geometry the primitive needs in order to
  function: stacking, positioning, the media element filling its viewport.
  Spread before `...style`.
- **A token with an inline `var()` default** — a structural value consumers
  plausibly restyle from CSS. Documented in `theme.css`'s token table even
  though the primitive reads it with or without the stylesheet.
- **`theme.css`** — appearance only: colour, radius, typography, spacing, and
  sizing that is an opinion rather than a requirement. It ships inside
  `@layer reely`, so unlayered consumer CSS beats it.

## Consequences

- A consumer who imports nothing gets a working, unstyled player. That is the
  supported default, not a fallback.
- Structural values are invisible to consumer stylesheets. Any one not behind a
  token is effectively `style`-prop-only. This has already surfaced: `Media`'s
  `object-fit: contain` (#150) is a literal, so a CSS-only consumer who wants
  cropping must reach for the `style` prop — recorded as a caveat in that
  changeset. Tokenising it is the fix if it comes up again.
- What `theme.css` and a primitive fight over is interaction, not duplication.
  This bullet used to say the opposite — that `theme.css` must not set a
  structural property the primitive already sets, with #160 as the proof — and
  that reading was wrong on both halves, so record it as wrong rather than let
  it be re-derived. The sets never overlapped: the primitive states `position`,
  `inset`, `z-index` and now `margin`, while the theme sized the activation
  button with `inline-size`/`block-size`, which is exactly the "sizing that is
  an opinion rather than a requirement" the boundary above hands to `theme.css`.
  And duplication cannot fight anyway — an inline value simply wins, which is
  the next bullet. #160 was two individually legitimate declarations that
  interact: a fixed size against four zero offsets over-constrains the box, the
  excess fell to `right`/`bottom`, and the 4rem circle rendered in the
  viewport's corner. The lesson survives the correction and generalises past
  the theme, because a consumer stylesheet can size that part just as well: an
  inline structural value has to be written so it degrades gracefully when a
  stylesheet sets something that interacts with it. `ActivationButton` now
  states `margin: auto` beside `inset: 0` — inert while the box is auto-sized
  (CSS 2.1 §10.3.7 on the inline axis and §10.6.4 on the block axis both
  resolve auto margins to zero, so the unstyled full-bleed click target is
  unchanged), and centring the moment any stylesheet gives the box a size.
  `theme.css` is untouched, because nothing in it was the defect.
- Restating an inline value in `theme.css` is dead CSS rather than a conflict —
  harmless, but it drifts. #150 removed three such declarations from the media
  block.
- The boundary is still untested; only the one instance is. Two stories now pin
  #160 — a themed one and one mounting a consumer stylesheet that sizes the
  part — but interaction is a property of a pair of declarations, and nothing
  looks for the next pair, on this part or any other. Dead restatement stays
  invisible too. That is why both failure modes reached `main` in the first
  place, and why the wrong diagnosis above went a whole ADR unchallenged.
- Moving to a `base.css` later would be breaking in practice, even though no
  types or exports would change: every consumer who never imported it would
  need to start.
