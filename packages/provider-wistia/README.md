# @reely/provider-wistia

The Wistia provider for [Reely](https://github.com/pedrosousa13/reely), over the
`@wistia/wistia-player` Aurora player.

```sh
pnpm add @reely/provider-wistia
```

`@reely/react` loads this for you when the source resolves to `wistia`. The
player is bundled as a dependency and imported dynamically — no `E-v1.js` script
tag, no `window._wq`. Importing it registers the `<wistia-player>` custom
element, which the adapter then mounts and drives through the `PublicApi` handle
the element hands over on `api-ready`.

<!-- example:provider-wistia -->

```ts
import { PlayerController } from '@reely/core';
import {
  API_READY_TIMEOUT_MS,
  createWistiaProvider,
  loadWistiaPlayer,
  resetWistiaPlayerLoader
} from '@reely/provider-wistia';
import type { WistiaMountElement } from '@reely/provider-wistia';

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

// The player element is loaded on demand and registered once per page. Pass
// your own importer to serve it from somewhere other than the default module.
export const warm = (): Promise<unknown> => loadWistiaPlayer();

// Drops the cached registration — for tests that need a clean load, not for
// app code.
export const reset = (): void => resetWistiaPlayerLoader();

// How long the player is given to hand over its API before the attach reports
// a recoverable error. Aurora fires no failure event of its own, so without
// this an unreachable media would leave the player loading for ever.
export const apiReadyTimeout = API_READY_TIMEOUT_MS; // 15000
```

<!-- /example -->

The embed is chromeless by default (`controls: false`) so Reely's own controls
are the only ones on screen, and `dnt` is on unless you turn it off. See
[Third-party requests and CSP](../../docs/third-party-requests.md) for the full
origins list and what a page's CSP has to allow.

## Exports

| Export                                                                          | What it is                                                                                                                                                                                                                               |
| ------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `createWistiaProvider`                                                          | Builds the adapter over a mount element and a `WistiaSource`.                                                                                                                                                                            |
| `loadWistiaPlayer`                                                              | Loads the player bundle and resolves the `<wistia-player>` registration. Cached across players; takes your own importer.                                                                                                                 |
| `resetWistiaPlayerLoader`                                                       | Drops the cached registration — for tests that need a clean load.                                                                                                                                                                        |
| `API_READY_TIMEOUT_MS`                                                          | How long the `api-ready` handshake is given before the attach reports an error.                                                                                                                                                          |
| `WistiaProviderOptions`                                                         | `controls`, `dnt`, `loop`, `startTime`, `endTime`. Through `Player.Root`, `loop`, `startTime` and `endTime` are each their own prop (ADR-0004), not bag keys; `controls` is still a bag key here, because no fan-out reaches Wistia yet. |
| `WistiaProviderAdapter`                                                         | The adapter's own type.                                                                                                                                                                                                                  |
| `WistiaMountElement`                                                            | What the adapter can mount into.                                                                                                                                                                                                         |
| `WistiaPlayerElement`                                                           | The `<wistia-player>` element as this adapter types it.                                                                                                                                                                                  |
| `WistiaPlayerApi`                                                               | The slice of Wistia's `PublicApi` this adapter drives.                                                                                                                                                                                   |
| `WistiaPlayerState`                                                             | Wistia's own `beforeplay` / `playing` / `paused` / `ended` vocabulary.                                                                                                                                                                   |
| `WistiaPlayerAttribute`                                                         | Every embed-option name the element accepts, from Wistia's `Attributes`.                                                                                                                                                                 |
| `PublicApi`                                                                     | Wistia's own handle declaration, re-exported rather than restated.                                                                                                                                                                       |
| `WistiaApiReadyDetail`, `WistiaMuteChangeDetail`, `WistiaLoadedMediaDataDetail` | The payloads of the three declared events this adapter reads, for a listener you add to the same element.                                                                                                                                |

## What it reports honestly

- **The player weighs 177 KB gzipped** as Wistia ships it, and about 87 KB once
  your bundler minifies it. That is the number to weigh before choosing this
  provider. The element also fetches its playback engine and media data from
  Wistia's CDN at runtime, so the npm package is the shell, not the whole
  player.
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
  playhead can overshoot the boundary by up to one Wistia time report; it is
  pinned in what is published rather than seeked back, because a corrective
  seek would be a visible backward jump.
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
  adapter differs from `@reely/provider-hls`.
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
  to offer `retry()` on.
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
  this adapter's playback core.

## License

[MIT](LICENSE).
