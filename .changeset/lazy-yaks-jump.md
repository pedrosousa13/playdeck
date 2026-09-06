---
'@playdeck/react': major
---

Remove `loadIframeApi` from the YouTube provider option bag

`PlayerProviderOptions['youtube']` accepted `loadIframeApi`, a function, even
though every other provider bag was guarded to primitives (#579 left this one
bag aside for its own decision). `providerOptionsEqual` compares a bag's own
keys with `Object.is`, which a function can never satisfy for a fresh value —
so `providerOptions={{ youtube: { loadIframeApi: () => ... } }}` written
inline, a new function every render, retired the YouTube activation and
rebuilt its embed on every render, losing playback position, exactly the
hazard #579 closed for `hls`.

`loadIframeApi` is now reachable only on `YouTubeProviderOptions` itself, the
provider's own documented test seam, by mounting `createYouTubeProvider`
directly:

```tsx
import { createYouTubeProvider } from '@playdeck/provider-youtube';

createYouTubeProvider(mount, videoId, { loadIframeApi: fakeLoader });
```

A `Player.Root` consumer who was passing `loadIframeApi` through
`providerOptions.youtube` now gets a type error at that key, which is why
this is a major bump rather than a patch: it removes a previously accepted
public option, not just its runtime behaviour. `host` remains the bag's one
key, unaffected.

There is no consumer-facing, data-shaped replacement for choosing how the
iframe API loads — unlike `hls`'s `build`, nothing in `youtube`'s own options
names a choice to select between — so none is added here. One would be
expressed as data, the way `build` is, if a real need for it turns up.
