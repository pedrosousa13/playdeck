---
'@reely/core': minor
'@reely/provider-native': minor
'@reely/provider-hls': minor
'@reely/provider-youtube': minor
'@reely/provider-vimeo': minor
'@reely/react': minor
---

First Reely prerelease: composable React 19 media-player primitives with one
consistent API across native MP4/WebM, HLS (VOD and ordinary live), YouTube and
Vimeo.

- **Core** — framework-neutral normalized state, commands, events, source
  detection, capabilities and the provider contract. Every capability reports
  `available`, `unknown`, or `unavailable` with a reason, so unsupported
  controls are absent rather than disabled-but-visible.
- **Providers** — native `HTMLMediaElement` (including native HLS), hls.js via
  dynamic import, YouTube iframe API, and Vimeo SDK. Each translates honestly
  instead of faking parity. Provider code loads only once source detection says
  the active source needs it, so a native-only consumer ships no provider bytes
  in its initial graph and makes no provider network requests.
- **React primitives** — `Player.Root`, `Viewport`, `Media`, `Poster`,
  activation, transport controls, settings and captions menus, gestures, and
  the `usePlayerState` / `usePlayerActions` / `useActiveCues` hooks. No CSS is
  imported by the primitives.
- **Captions** — hybrid rendering: Reely draws WebVTT cues itself for
  native/HLS and Vimeo, the browser draws them on request, and YouTube's embed
  draws its own. The effective mode is always inspectable.
- **Presentation** — fullscreen, Picture-in-Picture, AirPlay where available,
  and Media Session integration with ownership arbitration. `airPlay` means
  "there is somewhere to cast to", not "this engine has the picker API": it
  follows WebKit's `webkitplaybacktargetavailabilitychanged` and stays
  `unavailable` / `provider` until a route is announced, so
  `Player.AirPlayButton` no longer renders in Safari with no receiver on the
  network and no longer opens an empty picker (#71). The transition is live in
  both directions, and `@reely/provider-hls` inherits it.
- **Activation** — a queued user play is now always issued after the
  provider's `load()` has run (fixes #86); no API change.
- **Layout escape hatch** — geometry a primitive sets on itself is a default
  your `style` prop overrides, on `Viewport`, `Poster`, `ActivationButton`,
  `LoadingIndicator`, `ErrorDisplay` and `PosterImage` (#89). These six
  previously discarded a colliding `style` property, so a value you passed and
  saw ignored now takes effect. Properties derived from player state
  (`Poster`'s `visibility`) stay the primitive's own, and `PosterImage`'s
  explicit `objectFit` / `objectPosition` props still beat `style`.

- **Subscriber isolation** — one listener throwing no longer abandons the
  notification it was part of. `subscribe`, `subscribeCues` and `on` each
  iterated their listeners with a bare loop, so a throwing listener starved
  every listener registered after it for that emit; a control that subscribed
  late then rendered exactly one transition stale until the next unrelated
  emit (#95). Listener errors are now isolated and rethrown on a fresh task, so
  they still reach uncaught-error handling instead of being swallowed. The
  throw that surfaced this was Reely's own: Media Session position reporting
  passed `currentTime` straight through, and WebKit settles it a fraction past
  `duration` at the end of a clip, which the Media Session spec makes a
  `TypeError`. Position is now clamped to the media's own bounds.

The `DefaultPlayer` preset is not in this release; it is deferred (see issue
\#1). This prerelease ships the headless primitives only.
