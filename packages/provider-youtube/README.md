# @reely/provider-youtube

The YouTube provider for [Reely](https://github.com/pedrosousa13/reely), over
the IFrame Player API.

```sh
pnpm add @reely/provider-youtube
```

`@reely/react` loads this for you when the source resolves to `youtube`.

<!-- example:provider-youtube -->

```ts
import { PlayerController } from '@reely/core';
import {
  PLAYBACK_CONFIRMATION_TIMEOUT_MS,
  createYouTubeProvider,
  loadYouTubeIframeApi
} from '@reely/provider-youtube';

declare const mount: HTMLElement;

const controller = new PlayerController();

// The embed defaults to youtube-nocookie.com; `host` opts back out of it.
controller.setProvider(createYouTubeProvider(mount, 'dQw4w9WgXcQ'));

// The iframe API is loaded for you. Call this directly only to warm it before
// a player mounts.
export const warm = (): Promise<unknown> => loadYouTubeIframeApi();

// How long a play command waits for YouTube to confirm playback started before
// it is reported as blocked, rather than resolving a promise that never lands.
export const confirmationTimeout = PLAYBACK_CONFIRMATION_TIMEOUT_MS; // 3000
```

<!-- /example -->

The embed host defaults to `https://www.youtube-nocookie.com`, and the API
script is loaded from `https://www.youtube.com/iframe_api` once per document.
`host` is honoured only for the two origins YouTube serves the embed from —
`https://www.youtube.com` and `https://www.youtube-nocookie.com`, matched on
the parsed origin. Any other value falls back to the default rather than
throwing, so a misconfigured host still plays.
The embedding origin is declared to the player so it can validate the
`postMessage` traffic it exchanges with the iframe. See
[Third-party requests and CSP](../../docs/third-party-requests.md) for the full
origins list and what a page's CSP has to allow.

## Exports

| Export                             | What it is                                                                                                                                                                                                           |
| ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `createYouTubeProvider`            | Builds the adapter over a mount element and a video id.                                                                                                                                                              |
| `YouTubeProviderOptions`           | `controls`, `loop`, `startTime`, `endTime`, `host`, and `loadIframeApi` to supply the API yourself. Through `Player.Root`, `controls`, `loop`, `startTime` and `endTime` are its own props (ADR-0004), not bag keys. |
| `YouTubeProviderAdapter`           | The adapter's own type.                                                                                                                                                                                              |
| `PLAYBACK_CONFIRMATION_TIMEOUT_MS` | How long a `play()` waits for the player to confirm it (3 seconds).                                                                                                                                                  |

## What it reports honestly

- **`selectQuality` is `unavailable` / `provider`.** YouTube can enumerate
  levels but will not honour a choice: measured against the live IFrame API,
  `setPlaybackQuality` was accepted and discarded for every level the player
  itself offered — including when followed by a seek, and when passed as
  `loadVideoById({ suggestedQuality })`, where the player announced its own
  choice regardless. Asking for the lowest rung fails the same way as the
  highest, which rules out a bandwidth ceiling. So no ladder is published, and
  `qualities` stays empty rather than filling a menu with rungs that do nothing.
- **`buffered` is one range, anchored where playback entered it.** The IFrame
  API exposes no ranges — only `getVideoLoadedFraction()`, which reports the
  _end_ of the range holding the playhead. Buffer loaded before you arrived is
  invisible. Everything reported is genuinely buffered; it reports less than it
  holds, never more.
- **Captions are drawn by YouTube** (`captionRendering: 'provider'`), or
  `unavailable` when the embed exposes no tracks. Track discovery uses the
  undocumented `captions` module, so it follows community-observed conventions
  rather than a published contract.
- **`pictureInPicture` is `unavailable`**: the embed owns its own video element.
- **`startTime` and `endTime` are enforced by this adapter, not by YouTube.**
  The `start` player var is written as a load hint so the embed does not load
  from zero, but it is whole-second only, so the adapter seeks to the exact
  start once the player is ready. The `end` var is not written at all: it is
  whole-second too, its interaction with the `loop` plus single-entry-playlist
  pair is undocumented, and it is not known to publish the state change the
  adapter needs. The end boundary comes from the 250 ms position poll instead,
  so it can overshoot by up to that much before `ended` is published — the
  published `currentTime` is pinned to the boundary, and the playhead is left
  where the player stopped rather than seeking backwards onto it.
- **A plain looping embed publishes `ended` on every iteration, where the
  native provider publishes none.** With `loop` and no `startTime`, YouTube's
  playlist loop restarts at zero, which is where the window already begins, so
  this adapter has nothing to correct and passes the ENDED state change through
  as it always has. The native provider is the one that differs: it swallows
  `ended` for a looping video and just restarts. That is pre-existing embed
  behaviour, deliberately left alone by #214 — that change fanned `startTime`
  and `endTime` out to the embeds and did not revise how `loop` fans out.
  A `startTime` is what makes this adapter step in.

## License

[MIT](LICENSE).
