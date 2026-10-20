---
'@playdeck/react': patch
'@playdeck/provider-native': patch
---

Under `loading="eager"`, a `video` file source commits at render time instead of waiting for an effect, so `Player.Media` renders the native `<video>` and its `<source>` children — `preload` included — in the server HTML, and hydration reuses that element rather than mounting a fresh one after an extra render. No `autoplay` attribute reaches the server HTML either way; autoplay keeps attempting only after the provider attaches on the client. The native provider reads an element's intrinsic dimensions on attach when it already has metadata, and skips `media.load()` when the element's resource selection has already started on its own, so a server-rendered request is never aborted and restarted once the provider attaches.
