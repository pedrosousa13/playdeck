---
'@reely/provider-youtube': patch
'@reely/provider-vimeo': patch
'@reely/react': patch
---

`Player.Root`'s `loop` prop now loops a YouTube, Vimeo or Wistia source. It
used to travel only inside `NativePlaybackOptions`, which `loadProvider` hands
to the native and HLS providers and to no others, so `<Player.Root loop />` was
a silent no-op on the three embed providers (SIDEPRO-210).

`loop` now takes the same route `controls` already took: `Root` folds it into
the bag belonging to the detected source's own provider, and each provider
answers it — YouTube by the `loop` player var together with a `playlist` naming
the video itself (`loop` alone is a documented no-op on a single-video embed),
Vimeo by the `loop` embed parameter, Wistia by the `endVideoBehavior` it
already implemented. Native and HLS are unchanged.

**Breaking for anyone writing `providerOptions={{ wistia: { loop } }}`.** That
was the only spelling that worked before, and it is now omitted from
`PlayerProviderOptions` so the setting has one home (ADR-0004). Write
`<Player.Root loop />` instead. `WistiaProviderOptions.loop` itself stays, for
callers building the adapter with `createWistiaProvider` directly.

One consequence to know about: these three providers bake looping into the
embed, so changing `loop` mid-playback re-attaches the embed and loses its
position — where a native or HLS source only has an attribute set.
