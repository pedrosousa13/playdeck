---
'@playdeck/react': minor
---

`Player.Root` gains an opt-in `warmUp` prop, off by default, that reduces
click-to-playing latency for an embed provider by starting work ahead of
activation.

Set it and two things change. First, `Root` renders a `preconnect` hint for
each of the detected provider's own script and embed origins, read off a
fixed allowlist -- YouTube's script and embed hosts; Vimeo's embed host;
Wistia's script and CDN hosts -- never derived from the `source` prop itself,
so a source on a look-alike host earns no hint. YouTube's and Vimeo's own
poster-still CDN hosts join the hint list only as a further opt-in, when
`poster="provider"` is also set; Wistia's poster host is already in its base
list. Native and HLS sources carry no fixed third-party origin, so neither
gets a hint. Second, under `loading="interaction"`, `Player.ActivationButton`
starts the detected provider's own chunk importing on the first pointer-enter
or focus it receives, never on a touch tap alone and never more than once, so
the module is already resolving by the time a viewer's click asks for it.
Under `loading="viewport"` this prop adds only the hints, since no activation
surface exists there to hover or focus; under `loading="eager"` the chunk is
already importing at mount regardless.

Off by default, server-render output is unchanged; on, it gains the
`preconnect` hint links above.
