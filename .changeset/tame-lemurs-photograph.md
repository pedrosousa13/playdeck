---
'@playdeck/core': major
'@playdeck/react': minor
'@playdeck/provider-youtube': minor
'@playdeck/provider-vimeo': minor
'@playdeck/provider-wistia': minor
'@playdeck/provider-native': minor
---

A provider can supply its own poster, and `Player.Root` can ask for it

The library had a poster sink and no poster source: `Player.Poster` and
`Player.PosterImage` render whatever a consumer hands them, and nothing ever
asked a provider what still it would use on its own. YouTube, Vimeo and
Wistia each know one; native files and HLS manifests do not.

`PlayerCapabilities` gains `providerPoster`, in the vocabulary `Availability`
already defines. YouTube answers `available` immediately — its still is
`https://i.ytimg.com/vi/<id>/hqdefault.jpg`, derivable from the video id alone
and costing no request. (`hqdefault.jpg`, deliberately not
`maxresdefault.jpg`: the larger file 404s silently on a video that was never
uploaded at a high enough resolution to have one, where `hqdefault.jpg` is
generated for every upload.) Vimeo and Wistia answer `unknown: 'provider-check'`
and resolve to `available` or `unavailable: 'source'` once a dedicated oEmbed
request settles — opt-in, exactly like Vimeo's existing `customControls`
probe, so a consumer who never asks for a poster never causes the request.
Native and HLS answer `unavailable: 'source'` immediately: a file and a
manifest have no still of their own. `PlayerState` gains a matching
`providerPosterUrl: string | null`, `null` until the capability resolves to
`available`.

`@playdeck/react`'s `Player.Root` gains a `poster` prop, taking a URL, a
`ResponsivePoster`, or the literal `'provider'`. `'provider'` opts a Vimeo or
Wistia source into its oEmbed probe (folded into the provider's own option
bag the way `controls` and `loop` already are — ADR-0004) and, once the
still resolves, feeds it to any `Player.Poster` that renders no children of
its own as its default image. A `Player.Poster` given children keeps
rendering exactly those, unconditionally — a consumer-supplied poster always
wins. A consumer who sets no `poster` prop sees no behavioural change at all:
nothing resolves, nothing is requested, and `Player.Poster` renders only what
it always has.

`@playdeck/core`'s `PlayerCapabilities` and `PlayerState` both gain a required
field, which is a breaking change under this project's 1.0 contract: any
object built to satisfy either type — a custom provider adapter, a test
fixture — needs the new field before it type-checks again.
