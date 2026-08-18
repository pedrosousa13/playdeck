---
'@playdeck/core': minor
'@playdeck/react': minor
'@playdeck/provider-native': minor
'@playdeck/provider-hls': minor
'@playdeck/provider-vimeo': minor
---

`Player.Viewport` now reports the media's own aspect ratio as
`--playdeck-media-aspect-ratio` on the `viewport` part, so you can size a player to
its content — vertical video, a Short, anything not 16:9 — without knowing the
shape in advance (#174). Opt in with one rule:

```css
[data-playdeck-part='viewport'] {
  aspect-ratio: var(--playdeck-media-aspect-ratio, 16 / 9);
}
```

Nothing renders differently until you write it. The library reports the ratio
and never applies it, and no primitive reads it back: this is an output like
`data-state` rather than a theme token, so `theme.css` neither declares it nor
consumes it and the documented token table is unchanged.

Native and HLS — both engines, since the picture is drawn into the same
`<video>` — measure `videoWidth`/`videoHeight` at `loadedmetadata` and again on
`resize`, so an adaptive switch to a differently shaped rendition republishes.
Vimeo reports what the SDK gives it, once the embed is ready and again on the
SDK's `resize`. YouTube never reports it: the IFrame API exposes no intrinsic
size, so the property stays absent there and your `var()` fallback is what
shapes those players. Wherever a ratio is unknown the property is removed rather
than zeroed — before metadata arrives, on audio-only or errored media, on every
source change, and while a Vimeo `retry()` rebuilds its embed — so a stale ratio
never outlives the source it described, which would keep your fallback from
applying.

The value is written straight to the DOM and is deliberately not in
`PlayerState`, so a ratio arriving mid-load re-renders nothing.

If you have written your own provider adapter, `ProviderAdapter` gains an
optional `subscribeDimensions`; omitting it means that adapter reports no ratio,
which is what YouTube's does. `@playdeck/core` also exports a `MediaDimensions`
type and adds `PlayerController.subscribeDimensions`. If you supply your own
Vimeo SDK module, note that `VimeoSdkPlayer` now requires `getVideoWidth()` and
`getVideoHeight()` — the real SDK has both, but a hand-written stub will need
them.
