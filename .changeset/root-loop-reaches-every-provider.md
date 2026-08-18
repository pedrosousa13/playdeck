---
'@playdeck/provider-youtube': minor
'@playdeck/provider-vimeo': minor
'@playdeck/react': minor
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

No new re-attach cost comes with this. `loop` already took part in the
activation identity on every source type, so changing it mid-playback already
rebuilt the provider. Before this change the rebuild produced an identical
embed, the value having reached nothing; now it produces a looping one.
