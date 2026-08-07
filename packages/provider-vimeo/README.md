# @reely/provider-vimeo

The Vimeo provider for [Reely](https://github.com/pedrosousa13/reely), over the
`@vimeo/player` SDK.

```sh
pnpm add @reely/provider-vimeo
```

`@reely/react` loads this for you when the source resolves to `vimeo`. The SDK
is bundled as a dependency and imported dynamically — nothing is fetched from a
Vimeo CDN.

<!-- example:provider-vimeo -->

```ts
import { PlayerController } from '@reely/core';
import {
  createVimeoProvider,
  loadVimeoSdk,
  resetVimeoSdkLoader
} from '@reely/provider-vimeo';
import type { VimeoMountElement } from '@reely/provider-vimeo';

declare const mount: VimeoMountElement;

const controller = new PlayerController();

// `hash` is the privacy hash of an unlisted video, which `detectSource` keeps
// when it recognises one in the URL. `dnt` asks Vimeo not to track the session.
controller.setProvider(
  createVimeoProvider(
    mount,
    { type: 'vimeo', videoId: '76979871', hash: '8272103f6e' },
    { controls: false, dnt: true }
  )
);

// The SDK is loaded on demand and cached across players. Pass your own importer
// to serve it from somewhere other than the default module.
export const warm = (): Promise<unknown> => loadVimeoSdk();

// Drops the cached SDK — for tests that need a clean load, not for app code.
export const reset = (): void => resetVimeoSdkLoader();
```

<!-- /example -->

The embed is chromeless by default (`controls: false`) so Reely's own controls
are the only ones on screen, and `dnt` is on unless you turn it off. See
[Third-party requests and CSP](../../docs/third-party-requests.md) for the full
origins list and what a page's CSP has to allow.

## Exports

| Export                 | What it is                                                                                                                                                                            |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `createVimeoProvider`  | Builds the adapter over a mount element and a `VimeoSource`.                                                                                                                          |
| `VimeoProviderOptions` | `controls`, `dnt`, `loop`, `startTime`, `endTime`, `customControls`. Through `Player.Root`, `controls`, `loop`, `startTime` and `endTime` are its own props (ADR-0004), not bag keys. |
| `VimeoMountElement`    | What the adapter can mount into.                                                                                                                                                      |
| `VimeoProviderAdapter` | The adapter's own type.                                                                                                                                                               |

## What it reports honestly

- **Chromeless playback needs a paid plan, and checking for one is opt-in.**
  Pass `customControls: true` and `customControls` resolves from the account
  tier behind the video, via a request to Vimeo's public oEmbed endpoint: free
  and basic accounts report `unavailable` / `provider-plan`, paid tiers report
  `available`, and a tier we do not recognise stays unresolved rather than
  being guessed at. Without `customControls: true`, no request is made — the
  capability stays `unknown` / `provider-check` — so no viewer is disclosed to
  Vimeo before anyone has asked for the capability. A `Player.Root` consumer
  cannot reach this option yet, so the probe never fires from the React path
  at all.
- **`selectQuality` is `available` with a ladder** from the SDK's
  `getQualities()`. The rung's `height` is Vimeo's own name for it, not a
  measurement — the rung it labels `240p` renders at 480×270 — and `width` and
  `bitrate` are `null` because the SDK reports neither. `auto` arrives as a
  member of the list but is a mode, not a rung, so it is reported as
  `selectedQualityId: null`. A quality id that the player never offered is
  refused before the SDK sees it: `setQuality` with an unoffered id never
  settles at all, so forwarding one would hang the command forever.
- **Captions are Reely's to draw** (`captionRendering: 'custom'`): the track is
  enabled with `showing: false`, which makes Vimeo emit `cuechange` without
  drawing the cues itself. `setCaptionRenderer('native')` hands drawing back and
  reports `provider`. Vimeo's cue payload is markup, not plain text — WebVTT
  tags survive in it and lines are joined with U+21B5 — so it is parsed into
  plain text rather than passed through.
- **Cue timings are not reported.** The payload carries no start or end, so a
  cue reports the position it became active at for both bounds.
- **`buffered` is every range**, including the gaps a seek leaves behind.
- **`live` is never reported.** `@vimeo/player@2.30.4` publishes no liveness
  signal at all: its typings (`types/player.d.ts`, `types/events.ts`) carry no
  liveness member on the player and no `live` entry in `PlayerEventMap`, and
  neither does the subset this adapter declares for itself (`src/loader.ts`).
  What the SDK does offer — `getDuration()`, `getSeekable()`, `getBuffered()`
  and the `durationchange` event — describes a live event and a video on demand
  identically: a duration that grows as playback runs on is also what a VOD
  reports while its metadata settles. So the adapter publishes no `live` key at
  all rather than a guess — the field is absent from every patch, not present
  holding `null`. Pinned by "pins the liveness gap" in `test/index.test.ts`
  (#187).
- **The `[startTime, endTime]` window is this adapter's to enforce.** Vimeo
  carries a start as a `#t=` fragment on the embed url, which only keeps the
  embed from loading at zero — the seek this adapter issues when the player is
  ready is what the start rests on. There is no end mechanism at all, so the
  adapter watches `timeupdate`: crossing `endTime` pauses the embed and
  publishes `ended` with the playhead pinned to the boundary, and the pause it
  caused is not reported as one. `loop` composes with both — `loop=1` stays on
  the embed and wraps to zero, and the adapter puts the playhead back at
  `startTime` afterwards, which also covers the embeds where Vimeo never fires
  `ended`. Reaching the boundary while looping restarts instead of ending.
  Sanitisation matches every other provider: a non-finite or non-positive start
  is no start, an end that is not finite or not above the start is no end, and
  an end past the duration is clamped to it.
- **A plain looping embed publishes `ended` on every iteration, where the
  native provider publishes none.** With `loop` and no `startTime`, `loop=1`
  restarts the embed at zero, which is where the window already begins, so this
  adapter has nothing to correct and passes Vimeo's own `ended` through as it
  always has. The native provider is the one that differs: it swallows `ended`
  for a looping video and just restarts. That is pre-existing embed behaviour,
  deliberately left alone by #214 — that change fanned `startTime` and `endTime`
  out to the embeds and did not revise how `loop` fans out. A `startTime` is
  what makes this adapter step in.

## License

[MIT](LICENSE).
