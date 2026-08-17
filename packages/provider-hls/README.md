# @reely/provider-hls

The HLS provider for [Reely](https://github.com/pedrosousa13/reely). Picks
between the browser's native HLS and hls.js, and delegates everything the
`<video>` element already answers to `@reely/provider-native` rather than
reimplementing it.

```sh
pnpm add @reely/provider-hls
```

`@reely/react` loads this for you when the source resolves to `hls`. hls.js is a
dependency but is imported dynamically, so it only reaches the network when the
hls.js engine is actually selected.

<!-- example:provider-hls -->

```ts
import { PlayerController } from '@reely/core';
import { createHlsProvider } from '@reely/provider-hls';

declare const videoElement: HTMLVideoElement;

const controller = new PlayerController();

// hls.js is a dependency but is imported dynamically, so it only reaches the
// network when the hls.js engine is actually the one selected.
controller.setProvider(
  createHlsProvider(videoElement, { type: 'hls', src: '/master.m3u8' })
);

export const play = (): Promise<unknown> => controller.play();
```

<!-- /example -->

## Engine selection

`auto` (the default) prefers native HLS where the browser has it, and falls back
to hls.js where Media Source Extensions exist. `native` and `hls.js` force one;
forcing an engine the browser cannot provide fails with an explained error
rather than silently falling back.

<!-- example:provider-hls-engine -->

```ts
import {
  createHlsProvider,
  detectHlsEnvironment,
  selectHlsEngine
} from '@reely/provider-hls';

declare const videoElement: HTMLVideoElement;

// What this browser offers, asked before anything is loaded.
const environment = detectHlsEnvironment(videoElement); // { nativeHls, mse }

// Forcing an engine the browser cannot provide fails with an explained error
// rather than silently falling back to the other one.
const selection = selectHlsEngine('hls.js', environment);
if (selection.engine === null) throw new Error(selection.error.message);

export const engine = selection.engine; // 'native' | 'hls.js'

export const provider = createHlsProvider(videoElement, {
  type: 'hls',
  src: '/master.m3u8',
  engine: 'hls.js'
});
```

<!-- /example -->

## Exports

| Export                 | What it is                                                                     |
| ---------------------- | ------------------------------------------------------------------------------ |
| `createHlsProvider`    | Builds the adapter over a `<video>` element and an `HlsSource`.                |
| `selectHlsEngine`      | The engine decision, given a requested engine and a detected environment.      |
| `detectHlsEnvironment` | What the browser offers: native HLS, MSE, or neither.                          |
| `deriveLiveState`      | The shared `isLive` / `atLiveEdge` derivation, re-exported from `@reely/core`. |

Types: `HlsProviderOptions`, `HlsEnvironment`, `HlsEngineSelection`,
`LiveDerivationInput`, `HlsModuleLoader`, and the structural shapes this adapter
consumes from hls.js — `HlsConstructorLike`, `HlsInstanceLike`, `HlsConfigLike`,
`HlsLevelLike`, `HlsSubtitleTrackLike`, `HlsParsedCueLike`.

## Supplying your own hls.js

`loadHls` replaces the dynamic import — for pinning a version, or serving it
from somewhere else:

<!-- example:provider-hls-loader -->

```ts
import { createHlsProvider } from '@reely/provider-hls';

declare const videoElement: HTMLVideoElement;

export const provider = createHlsProvider(
  videoElement,
  { type: 'hls', src: '/master.m3u8' },
  { loadHls: () => import('hls.js') }
);
```

<!-- /example -->

The module you return has to expose `Hls.Events.LEVELS_UPDATED`. hls.js prunes
levels during its own error recovery, and the published quality ladder has to
follow it; a build without that event would leave rungs in a menu that no longer
exist.

## What it reports honestly

- **`selectQuality`** is `available` on the hls.js engine, with the ladder from
  the manifest carrying height, width and bitrate. `auto` is not published as a
  rung — it is `selectedQualityId: null`. On the native engine the browser
  chooses and the capability is `unavailable` / `source`.
- **Live** streams report `isLive` and `atLiveEdge` derived from the seekable
  window, not from a manifest tag.
- **Captions** on the hls.js engine come from hls.js, which is the sole owner:
  sidecar `<track>` children discovered by the native subsystem are dropped so
  the two cannot both claim the state.
- **Chapters** are the native adapter's, on both engines. HLS carries no
  chapters concept of its own, and `EXT-X-DATERANGE` routes into the metadata
  track, so a `kind="chapters"` text track on the media element is the only
  source — and it is not caption state, so the hls.js engine does not drop it.

`deriveLiveState` is that derivation. It lives in
[`@reely/core`](../core#live-state), where every adapter shares one copy, and is
re-exported here so a custom HLS adapter can reuse it:

<!-- example:provider-hls-live -->

```ts
import { deriveLiveState } from '@reely/provider-hls';

// Liveness is derived from what the stream reports — never from the URL or a
// filename. `isLiveHint` is hls.js's own answer where it has one; the native
// engine leaves it undefined and an infinite duration decides instead.
export const live = deriveLiveState({
  isLiveHint: true,
  duration: Number.POSITIVE_INFINITY,
  seekable: [{ start: 120, end: 3600 }],
  currentTime: 3598,
  // hls.js's liveSyncPosition: the target edge, behind the raw seekable end.
  liveEdge: 3594
});

// -> { isLive: true, atLiveEdge: true }. `null` means "not live, or not yet
// known" — a control should not claim either until it is.
export const atEdge = live?.atLiveEdge ?? false;
```

<!-- /example -->

## License

[MIT](LICENSE).
