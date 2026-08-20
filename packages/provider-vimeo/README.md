# @playdeck/provider-vimeo

The Vimeo provider for [Playdeck](https://github.com/pedrosousa13/playdeck), over the
`@vimeo/player` SDK.

```sh
pnpm add @playdeck/provider-vimeo
```

`@playdeck/react` loads this for you when the source resolves to `vimeo`. The SDK
is bundled as a dependency and imported dynamically — nothing is fetched from a
Vimeo CDN.

<!-- example:provider-vimeo -->

```ts
import { PlayerController } from '@playdeck/core';
import {
  createVimeoProvider,
  loadVimeoSdk,
  PLAYER_READY_TIMEOUT_MS,
  resetVimeoSdkLoader
} from '@playdeck/provider-vimeo';
import type { VimeoMountElement } from '@playdeck/provider-vimeo';

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

// How long `player.ready()` is given before the attach reports a recoverable
// error. Command readiness is declared earlier, at player construction, because
// the SDK queues calls it receives before its own ready resolves — but that is
// not a bound, and without this a frame blocked by the page CSP, an extension
// or the network leaves the player loading for ever with no error to render
// (#327).
export const playerReadyTimeout = PLAYER_READY_TIMEOUT_MS; // 15000
```

<!-- /example -->

The embed is chromeless by default (`controls: false`) so Playdeck's own controls
are the only ones on screen, and `dnt` is on unless you turn it off. See
[Third-party requests and CSP](../../docs/third-party-requests.md) for the full
origins list and what a page's CSP has to allow.

## Exports

| Export                 | What it is                                                                                                                                                                                                   |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `createVimeoProvider`  | Builds the adapter over a mount element and a `VimeoSource`.                                                                                                                                                 |
| `VimeoProviderOptions` | `controls`, `dnt`, `loop`, `startTime`, `endTime`, `customControls`, `suppressSeoMetadata`. Through `Player.Root`, `controls`, `loop`, `startTime` and `endTime` are its own props (ADR-0004), not bag keys. |
| `VimeoSdkLoadOptions`  | What `loadVimeoSdk` takes beyond its importer: `suppressSeoMetadata`, honoured only by the call that actually imports the SDK.                                                                               |
| `VimeoMountElement`    | What the adapter can mount into.                                                                                                                                                                             |
| `VimeoProviderAdapter` | The adapter's own type.                                                                                                                                                                                      |

## What it reports honestly

- **Chromeless playback needs a paid plan, and checking for one is opt-in.**
  Pass `customControls: true` and `customControls` resolves from the account
  tier behind the video, via a request to Vimeo's public oEmbed endpoint: free
  and basic accounts report `unavailable` / `provider-plan`, paid tiers report
  `available`, and a tier we do not recognise stays unresolved rather than
  being guessed at. Without `customControls: true`, no request is made — the
  capability stays `unknown` / `provider-check` — so no viewer is disclosed to
  Vimeo before anyone has asked for the capability. That holds through
  `Player.Root` too: the option is reachable as
  `providerOptions={{ vimeo: { customControls: true } }}`, and the probe fires
  only when it is set.
- **`selectQuality` is `available` with a ladder** from the SDK's
  `getQualities()`. The rung's `height` is Vimeo's own name for it, not a
  measurement — the rung it labels `240p` renders at 480×270 — and `width` and
  `bitrate` are `null` because the SDK reports neither. `auto` arrives as a
  member of the list but is a mode, not a rung, so it is reported as
  `selectedQualityId: null`. A quality id that the player never offered is
  refused before the SDK sees it: `setQuality` with an unoffered id never
  settles at all, so forwarding one would hang the command forever.
- **Chapters come from the SDK's own chapter list**, read once the player is
  ready, and kept current by its `chapterchange` event rather than by polling.
  The SDK reports a start and a title per chapter and no end at all, so every
  `endTime` is derived: each chapter ends where the next begins, and the last
  takes the duration, or `null` where the duration is not known.
- **Captions are Playdeck's to draw** (`captionRendering: 'custom'`): the track is
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
- **The SDK sends the embedding page's full URL to the embed, and
  `suppressSeoMetadata` is how you stop it.** When the embed answers the SDK's
  readiness handshake, `@vimeo/player`'s own module-scope listener replies to it
  with `window.location.href` — path and query included — over `postMessage`.
  The iframe's `referrerpolicy="strict-origin-when-cross-origin"` does not
  prevent this: it narrows the iframe's own request header, and this travels as
  a message afterwards. Neither does `dnt`. Pass `suppressSeoMetadata: true` —
  reachable from `Player.Root` as
  `providerOptions={{ vimeo: { suppressSeoMetadata: true } }}` — and Playdeck sets
  the SDK's own guard before the SDK is imported, so the listener is never
  installed. It is off by default, and with it off nothing about this changes.
  Two things to know before switching it on. First, **the effect is page-wide,
  not per-embed**: the SDK's guard is a `window` global, so this silences the
  handshake for every Vimeo embed on the page, including embeds Playdeck did not
  create, and that blast radius is yours to accept rather than the library's to
  decide. Second, **it takes effect on the first Vimeo attach and holds for the
  life of the page**: the SDK module is imported once and cached, and it reads
  the guard while it evaluates, so a page that attaches one Vimeo source without
  the option and a later one with it gets no suppression at all. That is the
  vendor's design, not something Playdeck works around. A page that has set the
  guard itself keeps its own value, in either direction; Playdeck only ever writes
  it when it is not already set. Where that leaves the handshake **installed**
  — a later attach, or a guard the page pinned to `false` — the adapter says so:
  it publishes a non-fatal `configuration` notice on `PlayerState.error`, so a
  fall back to the SDK's default is detectable at runtime and not only readable
  here. A guard someone else already set to `true` is the other direction:
  suppression is in effect, the request was honoured, and there is nothing to
  report.

## License

[MIT](LICENSE).
