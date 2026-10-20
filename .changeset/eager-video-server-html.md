---
'@playdeck/react': patch
'@playdeck/provider-native': patch
---

Under `loading="eager"`, a `video` file source commits at render time instead of waiting for an effect, so `Player.Media` renders the native `<video>` and its `<source>` children — `preload` included — in the server HTML, and hydration reuses that element rather than mounting a fresh one after an extra render. A refused source URL still never reaches the server HTML. No `autoplay` attribute reaches the server HTML either way; autoplay keeps attempting only after the provider attaches on the client. The native provider skips `media.load()` for an `eager` video source, so a server-rendered request is never aborted and restarted once the provider attaches, and instead reads an element's intrinsic dimensions, applies a configured `startTime`, and reports source exhaustion on attach when the element already reached that state before attaching.
