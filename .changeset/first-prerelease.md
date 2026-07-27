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
  draws its own. The effective mode is always inspectable. Vimeo reports
  `captionRendering: 'custom'`: the track is enabled with `showing: false` and
  its `cuechange` payload flows through `Player.Captions` like any other source
  (#16). `setCaptionRenderer('native')` hands drawing back to Vimeo and reports
  `provider`, which is also the fallback for anything the overlay cannot
  render. Vimeo's payload carries no cue timings, so a cue reports the position
  it became active at for both bounds. YouTube reports `provider`, or
  `unavailable` when it exposes no tracks.
- **Quality selection** — `PlayerState` enumerates the selectable rungs in
  `qualities`, each a `PlayerQuality` carrying a content-derived `id`, next to
  `selectedQualityId` for what the consumer chose (`null` meaning auto), so a
  quality menu can be built from public exports alone (#81). `quality` still
  means the level playing right now and keeps moving under adaptive selection,
  which is what lets an auto row be labelled honestly. `selectQuality` takes
  that id — `selectQuality(id: string | null)` — not a height. Two engines have
  a ladder: hls.js from the manifest, and Vimeo from the SDK's `getQualities()`
  (#82), whose rungs carry the height Vimeo names them by and nothing it does
  not report. `auto` is not published as a rung on either — it is
  `selectedQualityId: null`. Native playback (including native HLS) reports
  `unavailable` / `source` rather than an `unknown` that could never resolve.
  YouTube reports `unavailable` / `provider` because it can enumerate levels but
  cannot honour a choice: measured against the live IFrame API,
  `setPlaybackQuality` is accepted and discarded for every level the player
  itself offered, as it is when followed by a seek and when passed as
  `loadVideoById({ suggestedQuality })`. A menu there would silently do nothing,
  so none is offered. A custom `loadHls` module must expose
  `Hls.Events.LEVELS_UPDATED` —
  `HlsConstructorLike` now requires it — because hls.js prunes levels during
  its own error recovery and the published ladder has to follow.
  `HlsInstanceLike.on` is declared as a method rather than a property-typed
  function, so a real hls.js module satisfies `HlsModuleLoader`: the documented
  `loadHls: () => import('hls.js')` previously needed `as unknown as` to
  compile, including inside this package.
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
  `LoadingIndicator` keeps its live region mounted while idle so the transition
  into buffering is announced, but that idle region is now visually hidden
  instead of a full-bleed `position: absolute; inset: 0` box at z-index 30
  (#32). The old geometry outranked every layer a consumer composed underneath
  it and left automated color-contrast checking unable to resolve a background
  for any text in the player. It becomes the top-most overlay only once there
  is a loading or buffering state to show.

- **Caption renderer, imperatively** — `setCaptionRenderer('custom' | 'native')`
  is on `usePlayerActions()` and on the `Player.Root` ref handle, next to the
  `captionRenderer` prop. It was reachable but undeclared: the ref hands back
  the controller, so the method was there whether or not the type admitted it.
  Flipping the renderer without re-rendering `Root` is what it is for.

- **Media Session** — `getMediaSessionCoordinator(session)` is the way to get a
  coordinator. `createMediaSessionCoordinator` is no longer exported: a second
  coordinator over the same `MediaSession` hands out roots that cannot see each
  other's ownership, which is what the one-per-document rule exists to prevent.
  `MediaSessionLike` names the five actions the coordinator registers rather
  than taking `action: string`, so a real `navigator.mediaSession` satisfies it
  and `getMediaSessionCoordinator(navigator.mediaSession)` typechecks without a
  cast. A fake still only has to implement those five.

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
