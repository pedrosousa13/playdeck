---
'@playdeck/core': minor
'@playdeck/provider-vimeo': patch
'@playdeck/provider-wistia': patch
'@playdeck/provider-youtube': patch
---

Reach the clip-window boundary through a subpath the embed providers import

`@playdeck/core` gains a third export subpath, `@playdeck/core/time-boundary`,
exposing `createTimeBoundary` and its `TimeBoundary` type -- built as its own
bundle, the same way `@playdeck/core/thumbnails` and
`@playdeck/core/media-session` already are. `createTimeBoundary` and
`TimeBoundary` stay exported from `@playdeck/core` itself too, so a direct
import needs no rework.

`@playdeck/provider-vimeo`, `@playdeck/provider-wistia` and
`@playdeck/provider-youtube` import `createTimeBoundary` from that subpath
rather than from `@playdeck/core`'s main entry. Each provider's own module is
reached only through a dynamic `import()` an app's build graph carries for
every provider kind at once, regardless of which one a given page's source
resolves to, so a bundler that places `@playdeck/core`'s main entry inside
that page's eager chunk has to export whatever any sibling provider imports
from it -- `createTimeBoundary` included, even for a page composed with no
embed provider at all. Importing it through its own subpath instead keeps it
out of that eager chunk: a page with no embed provider does not ship it.
