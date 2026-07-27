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
The embedding origin is declared to the player so it can validate the
`postMessage` traffic it exchanges with the iframe.

## Exports

| Export                             | What it is                                                          |
| ---------------------------------- | ------------------------------------------------------------------- |
| `createYouTubeProvider`            | Builds the adapter over a mount element and a video id.             |
| `YouTubeProviderOptions`           | `host`, and `loadIframeApi` to supply the API yourself.             |
| `YouTubeProviderAdapter`           | The adapter's own type.                                             |
| `PLAYBACK_CONFIRMATION_TIMEOUT_MS` | How long a `play()` waits for the player to confirm it (3 seconds). |

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

## License

[MIT](LICENSE).
