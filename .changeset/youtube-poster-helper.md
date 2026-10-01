---
'@playdeck/provider-youtube': minor
---

Add `resolveYouTubePosterUrl`, a pure poster helper for a dormant player

`@playdeck/provider-youtube` exports `resolveYouTubePosterUrl(source)`. It
parses with the same parser `Player.Root`'s `source` prop resolves with,
accepts a URL in any form `docs/provider-setup.md`'s YouTube section lists
or an explicit `{ type: 'youtube', videoId }` object, and returns the
`i.ytimg.com` poster still for it, or `null` for anything else.

It is synchronous, makes no request and reads no browser global, which is
what makes it safe to call before a provider has attached -- including on
the server, and including for a `Player.Root` with `loading="interaction"`,
where `poster="provider"` cannot resolve because no provider attaches until
the viewer's first click.

The extracted video id is held to YouTube's own 11-character shape, tighter
than the detector's own id pattern, so a look-alike host, a `javascript:` or
`data:` URL, an id carrying a path or query fragment, and an id of the wrong
length all resolve to `null` rather than a URL built from unvalidated input.
