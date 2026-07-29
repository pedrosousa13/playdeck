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
- `theme.css` must not set a structural property the primitive already sets, or
  the two fight. It does today: the activation button's 4rem square collides
  with the primitive's `inset: 0`, over-constraining the box so it renders in
  the viewport's corner (#160). "Appearance only" is the rule that prevents this
  whole class of bug.
- Restating an inline value in `theme.css` is dead CSS rather than a conflict —
  harmless, but it drifts. #150 removed three such declarations from the media
  block.
- Nothing tests the boundary. Both failure modes above are invisible to the
  current suites, which is why both reached `main`.
- Moving to a `base.css` later would be breaking in practice, even though no
  types or exports would change: every consumer who never imported it would
  need to start.
