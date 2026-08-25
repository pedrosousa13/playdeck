# @playdeck/provider-wistia

The Wistia provider for [Playdeck](https://github.com/pedrosousa13/playdeck), over
Wistia's Aurora `<wistia-player>` element.

```sh
pnpm add @playdeck/provider-wistia
```

`@playdeck/react` loads this for you when the source resolves to `wistia`, for
the URL forms [Provider setup](https://github.com/pedrosousa13/playdeck/blob/main/docs/provider-setup.md#the-other-three-providers)
lists. The
player bundle is fetched from `https://fast.wistia.com/player.js` on the first
attach — Aurora's own entry point, not the legacy `E-v1.js` shim, so there is
still no `window._wq`. This package does **not** depend on
`@wistia/wistia-player`: that package is a shell around the same CDN, and it
declares build tooling among its runtime dependencies, so installing it dragged
webpack into consumer installs for a bundle that was going to be fetched over
the network anyway. Loading the script registers the `<wistia-player>` custom
element, which the adapter then mounts and drives through the handle the element
hands over on `api-ready`.

Because nothing is imported from Wistia's package, every type this adapter reads
off Wistia's declarations is restated here and published as this package's own —
see `WistiaPlayerApi` and `WistiaPlayerAttribute` below.

<!-- example:provider-wistia -->

```ts
import { PlayerController } from '@playdeck/core';
import {
  API_READY_TIMEOUT_MS,
  createWistiaProvider,
  loadWistiaPlayer,
  resetWistiaPlayerLoader,
  SCRIPT_LOAD_TIMEOUT_MS
} from '@playdeck/provider-wistia';
import type {
  WistiaMountElement,
  WistiaScriptInjector
} from '@playdeck/provider-wistia';

declare const mount: WistiaMountElement;

const controller = new PlayerController();

// `mediaId` is Wistia's hashed id, which `detectSource` reads out of any of
// Wistia's URL forms. `dnt` asks Wistia not to track the session.
controller.setProvider(
  createWistiaProvider(
    mount,
    { type: 'wistia', mediaId: 'oifkgmxnkb' },
    { controls: false, dnt: true, loop: false }
  )
);

// Wistia's bundle is fetched from `https://fast.wistia.com/player.js` on the
// first attach, once per page, and registers the `<wistia-player>` element.
export const warm = (): Promise<unknown> => loadWistiaPlayer();

// Serve that bundle from your own origin by replacing the injector. The loader
// still owns the shared promise, the deadline and the registration it waits
// for — this only decides where the script comes from.
const fromOwnOrigin: WistiaScriptInjector = () => {
  const script = document.createElement('script');
  script.src = '/vendor/wistia-player.js';
  script.async = true;
  document.head.appendChild(script);
  return script;
};

export const warmFromOwnOrigin = (): Promise<unknown> =>
  loadWistiaPlayer(fromOwnOrigin);

// Drops the cached registration — for tests that need a clean load, not for
// app code.
export const reset = (): void => resetWistiaPlayerLoader();

// How long the player is given to hand over its API before the attach reports
// a recoverable error. Aurora fires no failure event of its own, so without
// this an unreachable media would leave the player loading for ever.
export const apiReadyTimeout = API_READY_TIMEOUT_MS; // 15000

// The separate backstop on the script fetch that precedes that handshake. The
// two run in sequence, so a black-holed network reports an error in up to
// thirty seconds rather than fifteen.
export const scriptLoadTimeout = SCRIPT_LOAD_TIMEOUT_MS; // 15000
```

<!-- /example -->

The embed is chromeless by default (`controls: false`) so Playdeck's own controls
are the only ones on screen, and `dnt` is on unless you turn it off. See
[Third-party requests and CSP](https://github.com/pedrosousa13/playdeck/blob/main/docs/third-party-requests.md) for the full
origins list and what a page's CSP has to allow.

## Exports

| Export                                                                          | What it is                                                                                                                                                                                                                               |
| ------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `createWistiaProvider`                                                          | Builds the adapter over a mount element and a `WistiaSource`.                                                                                                                                                                            |
| `loadWistiaPlayer`                                                              | Fetches the player bundle from `fast.wistia.com` and resolves the `<wistia-player>` registration. Shared across players; takes your own script injector.                                                                                 |
| `resetWistiaPlayerLoader`                                                       | Drops the shared load — for tests that need a clean load.                                                                                                                                                                                |
| `API_READY_TIMEOUT_MS`                                                          | How long the `api-ready` handshake is given before the attach reports an error.                                                                                                                                                          |
| `SCRIPT_LOAD_TIMEOUT_MS`                                                        | How long the script fetch that precedes that handshake is given. Separate deadline, same 15 seconds; the two run in sequence.                                                                                                            |
| `WistiaScriptInjector`                                                          | What `loadWistiaPlayer` takes to put the bundle in the document — replace it to serve the script from your own origin.                                                                                                                   |
| `WistiaProviderOptions`                                                         | `controls`, `dnt`, `loop`, `startTime`, `endTime`. Through `Player.Root`, `loop`, `startTime` and `endTime` are each their own prop (ADR-0004), not bag keys; `controls` is still a bag key here, because no fan-out reaches Wistia yet. |
| `WistiaProviderAdapter`                                                         | The adapter's own type.                                                                                                                                                                                                                  |
| `WistiaMountElement`                                                            | What the adapter can mount into.                                                                                                                                                                                                         |
| `WistiaPlayerElement`                                                           | The `<wistia-player>` element as this adapter types it.                                                                                                                                                                                  |
| `WistiaPlayerApi`                                                               | The fifteen handle members this adapter drives, restated from Wistia's `PublicApi` at `0.7.12`.                                                                                                                                          |
| `WistiaPlayerState`                                                             | Wistia's own `beforeplay` / `playing` / `paused` / `ended` vocabulary.                                                                                                                                                                   |
| `WistiaPlayerAttribute`                                                         | Every embed-option name the element accepts, restated from Wistia's `Attributes` at `0.7.12`.                                                                                                                                            |
| `WistiaApiReadyDetail`, `WistiaMuteChangeDetail`, `WistiaLoadedMediaDataDetail` | The payloads of the three declared events this adapter reads, for a listener you add to the same element.                                                                                                                                |

## What it reports honestly

- **The player is a runtime script, not bundle weight.** This provider adds no
  Wistia bytes to your build; the page fetches `player.js` from
  `fast.wistia.com` when a Wistia source first attaches, and the element then
  fetches its playback engine, embed configuration and media data from the same
  CDN. That is the trade to weigh before choosing this provider: nothing to
  bundle, and a third-party origin your `script-src` has to allow, which no
  `integrity` can pin — see
  [Third-party requests and CSP](https://github.com/pedrosousa13/playdeck/blob/main/docs/third-party-requests.md).
- **`controls: false` switches off every control by name.**
  `controls-visible-on-load` alone only hides Wistia's chrome until the first
  hover or click, so `play-pause-control`, `play-bar-control`, `volume-control`,
  `settings-control`, `fullscreen-control`, `big-play-button` and
  `play-pause-notifier` are all set off with it. Wistia's own logo is not one
  of them: the player exposes no attribute that hides it.
- **`seek` is `available`.** `PublicApi.time(seconds)` seeks, and `seeked`
  reports the settled playhead.
- **The `[startTime, endTime]` window is enforced by the adapter, not by
  Wistia.** Aurora declares a `currentTime` attribute, which the adapter writes
  as a load hint so the element can start in the right place without a visible
  jump. Whether a fresh element honours it is not documented, so the
  `time(seconds)` seek at `api-ready` is the authority either way. There is no
  end counterpart at all: the adapter watches `time-update`, and at the end
  boundary it pauses the player and publishes `ended` with the playhead pinned
  to the boundary. The pause that end caused publishes no `paused` state. The
  playhead can overshoot the boundary by up to one Wistia time report, and it is
  seeked back onto it, so what is on screen and what is published agree (#381).
- **`startTime` is a floor, not just where playback starts.** A reported
  position below it is pulled back to it, whatever moved the playhead — an
  SDK-side seek, or the viewer dragging Aurora's own scrub bar. `seeked` is
  corrected as well as `time-update`, because a paused player reports no time
  update after a seek. A `seekTo` or `seekBy` below the start is clamped to the
  same value, so the two agree rather than correcting one position twice, and a
  correction never triggers another: the position it seeks to is one the window
  accepts (#381).
- **`loop` composes with both.** `end-video-behavior="loop"` stays set, so
  Wistia still owns the restart; the adapter only corrects where it lands. With
  a `startTime`, a wrap returns to that offset rather than to zero, and no
  `ended` is published for it. With an `endTime`, reaching the boundary
  restarts from the start of the window instead of ending. A seek is clamped
  into the window, and `play()` after a boundary end resumes from the start of
  it.
- **A plain looping player publishes `ended` on every iteration, where the
  native provider publishes none.** With `loop` and no `startTime`,
  `end-video-behavior="loop"` restarts the player at zero, which is where the
  window already begins, so this adapter has nothing to correct and passes
  Wistia's own `ended` through as it always has. The native provider is the one
  that differs: it swallows `ended` for a looping video and just restarts. That
  is pre-existing player behaviour, deliberately left alone by #214 — that
  change fanned `startTime` and `endTime` out to the embeds and did not revise
  how `loop` fans out. A `startTime` is what makes this adapter step in.
- **Liveness is reported, from Wistia's media type and nothing else.** The
  element dispatches `loaded-media-data` with the media data it fetched, and
  `MediaData.mediaType` is `'LiveStream'` for a live broadcast. That is the only
  signal the adapter reads: never the source URL, the media id or a filename.
  Media data that names no type, and a load that reports no media data at all,
  both read as not live. Wistia exposes no seekable window, so the at-edge flag
  measures the playhead against `duration()`; a duration that is not a finite
  number leaves the edge unknown, which reports as at the edge. The published
  `live` value changes or nothing is published — an unchanged one produces no
  patch. `duration` is left as Wistia reports it while live, which is where this
  adapter differs from `@playdeck/provider-hls`.
- **The at-edge flag stays current while the player is paused.** It is
  recomputed on every `time-update` while the player runs, and Wistia stops
  dispatching that event the moment it pauses — so a paused live stream would
  otherwise hold the last flag it published while the live edge went on
  advancing, and read as "at the live edge" for a viewer minutes behind. Aurora
  offers no idle event to bind instead: the playback events come from the engine
  the element fetches at runtime and are all playback-driven, and the eight the
  package itself declares are load, replace and embed-option notices. So the
  adapter recomputes on a five-second interval, half the shared at-edge
  tolerance, and only where that can change something: never for a media that is
  not live, never while the player is playing, and never past teardown, destroy
  or the player a `retry()` replaces. Each tick goes through the same equality
  guard as every other recompute, so a paused player that has not moved relative
  to the edge publishes nothing at all.
- **`fullscreen` is `available`.** `PublicApi.requestFullscreen()` and
  `cancelFullscreen()` drive the player's own fullscreen element, and its
  `enter-fullscreen` / `cancel-fullscreen` events confirm the change.
- **`setVolume` starts `available` and can downgrade to `unavailable` /
  `browser`.** Aurora declares `volume()` on every player, so there is nothing to
  check up front. A device that refuses the change is the only proof: when
  `volume()` throws `UnsupportedError` or `NotSupportedError` — iOS pins media
  volume to the hardware switch and refuses every programmatic change — the
  adapter republishes its capabilities with `setVolume` `unavailable`, reason
  `browser`, because the limit is the browser's and not Wistia's. The refused
  command still answers `{ ok: false, reason: 'unsupported' }`. The downgrade
  holds for the life of the adapter, including across `retry()`; it is the
  device that changed the answer, and the device is still the same one.
- **`setPlaybackRate` starts `available` and can downgrade to `unavailable` /
  `provider`.** Same shape, different reason: `playbackRate()` is declared on
  every player too, and a media that withholds it refuses the call rather than
  announcing itself. The reason is `provider` because it is Wistia withholding
  the rate, not the browser. The downgrade holds for the life of the adapter, as
  above. Nothing else corrects it either — Wistia dispatches `rate-change` when
  the rate does change, and nothing at all when it does not.
- **`selectQuality` is `unavailable` / `provider`.** Aurora exposes a coarse
  `videoQuality()` setter and `quality-min` / `quality-max` attributes, but no
  rung ladder this adapter could publish, so quality selection is not wired.
- **`selectTextTrack` is `unavailable` / `provider`.** Aurora has a captions
  API; this adapter does not drive it, and reporting a track list it cannot
  honour would be worse than saying so.
- **`pictureInPicture` is `unavailable` / `provider`.** Wistia's `PublicApi`
  declares no picture-in-picture member at all.
- **`airPlay` is `unavailable` / `provider`.** No command surface is wired.
- **`customControls` is `available`.** Chromeless playback is a plain set of
  embed attributes, declared in Wistia's own `Attributes` type and gated by no
  account tier — unlike Vimeo, where it needs a paid plan.
- **A player that never answers is reported, not waited on.** Aurora dispatches
  no failure event: media data that asks for the legacy iframe embed, or a
  player engine an ad-blocker stops reaching, leaves the element silent for
  ever. The adapter gives the `api-ready` handshake `API_READY_TIMEOUT_MS` and
  then publishes a recoverable `lifecycle: 'error'`, so the host has something
  to offer `retry()` on. The script fetch before it has its own
  `SCRIPT_LOAD_TIMEOUT_MS`, because a script `error` event does not cover every
  way that fetch can fail to arrive: a captive portal, an inspecting proxy or a
  truncated body answers 200 and fires `load` without registering the element. A
  failed load is not remembered, so `retry()` genuinely re-fetches.
- **`seeking` is never `true`.** The element does fire a `seeking` event, but
  measured against the live player it cannot bracket a seek: one unpaired
  `seeking` arrives during the initial load, and every seek after that
  dispatches `seeked` about a millisecond before its `seeking`. Binding the pair
  would pin `seeking` true for the rest of the session, so only `seeked` is
  wired, and it reports the settled playhead.
- **`buffered` is never published.** Aurora fires no buffering events and the
  handle exposes no buffered ranges, so the adapter reports nothing rather than
  a guess. `buffering` stays `false` for the same reason.
- **Cue timings, chapters and analytics are not reported.** They are outside
  this adapter's playback core. Wistia's chapters are an inbound embed-option
  plugin — the embedder supplies the list — and no documented read-back accessor
  exists, so `PlayerState.chapters` stays empty and `capabilities.chapters`
  reports `{ status: 'unavailable', reason: 'provider' }` rather than leaving a
  consumer to guess.

## License

[MIT](LICENSE).
