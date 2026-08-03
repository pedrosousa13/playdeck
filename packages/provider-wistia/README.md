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
are the only ones on screen, and `dnt` is on unless you turn it off.

## Exports

| Export                                                                                                                                                                                                 | What it is                                                                                                               |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------ |
| `createWistiaProvider`                                                                                                                                                                                 | Builds the adapter over a mount element and a `WistiaSource`.                                                            |
| `loadWistiaPlayer`                                                                                                                                                                                     | Loads the player bundle and resolves the `<wistia-player>` registration. Cached across players; takes your own importer. |
| `resetWistiaPlayerLoader`                                                                                                                                                                              | Drops the cached registration — for tests that need a clean load.                                                        |
| `API_READY_TIMEOUT_MS`                                                                                                                                                                                 | How long the `api-ready` handshake is given before the attach reports an error.                                          |
| `WistiaProviderOptions`                                                                                                                                                                                | `controls`, `dnt`, `loop`.                                                                                               |
| `WistiaProviderAdapter`                                                                                                                                                                                | The adapter's own type.                                                                                                  |
| `WistiaMountElement`                                                                                                                                                                                   | What the adapter can mount into.                                                                                         |
| `WistiaPlayerElement`                                                                                                                                                                                  | The `<wistia-player>` element as this adapter types it.                                                                  |
| `WistiaPlayerApi`                                                                                                                                                                                      | The slice of Wistia's `PublicApi` this adapter drives.                                                                   |
| `WistiaPlayerState`                                                                                                                                                                                    | Wistia's own `beforeplay` / `playing` / `paused` / `ended` vocabulary.                                                   |
| `WistiaPlayerAttribute`                                                                                                                                                                                | Every embed-option name the element accepts, from Wistia's `Attributes`.                                                 |
| `PublicApi`, `MediaData`                                                                                                                                                                               | Wistia's own declarations, re-exported rather than restated.                                                             |
| `WistiaPlayerEvents`                                                                                                                                                                                   | Wistia's own event map, keyed by event name.                                                                             |
| `API_READY_EVENT_TYPE`, `MUTE_CHANGE_EVENT_TYPE`, `LOADED_MEDIA_DATA_EVENT_TYPE`, `BEFORE_REPLACE_EVENT_TYPE`, `AFTER_REPLACE_EVENT_TYPE`, `IMPL_CREATED_EVENT_TYPE`, `PLAYER_COLOR_CHANGE_EVENT_TYPE` | Wistia's own event declarations, for a listener you add to the same element.                                             |
| `WistiaApiReadyDetail`, `WistiaMuteChangeDetail`                                                                                                                                                       | The payloads of the two declared events this adapter reads.                                                              |

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
- **`buffered` is never published.** Aurora fires no buffering events and the
  handle exposes no buffered ranges, so the adapter reports nothing rather than
  a guess. `buffering` stays `false` for the same reason.
- **Cue timings, chapters and analytics are not reported.** They are outside
  this adapter's playback core.

## License

[MIT](LICENSE).
