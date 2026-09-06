---
'@playdeck/core': patch
'@playdeck/provider-native': patch
'@playdeck/provider-hls': patch
'@playdeck/provider-youtube': patch
'@playdeck/provider-vimeo': patch
'@playdeck/provider-wistia': patch
---

Show React first in every provider README

`@playdeck/react` is the only renderer Playdeck ships, but every provider
README led with core-level construction code and left a React consumer to
translate it themselves. Each provider README now opens with a compiled
`Player.Root` example — YouTube and Vimeo reuse the fixtures already proven in
the provider setup guide, and native, HLS and Wistia each get a new one. The
neutral, core-level example moves under a new "Without React" heading, kept
verbatim, for the two cases where it is still the right tool: writing a
provider adapter, or hosting a player somewhere other than React.

`@playdeck/core`'s README states the same ordering: React is the default path
for building UI, and using core directly is a deliberate choice with its own
reasons, rather than the implicit default it read as before. Nothing about the
layering changed — core and the providers still know nothing about React.
