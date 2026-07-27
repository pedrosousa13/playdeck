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

```ts
import { createHlsProvider } from '@reely/provider-hls';

controller.setProvider(
  createHlsProvider(videoElement, { type: 'hls', src: '/master.m3u8' })
);
```

## Engine selection

`auto` (the default) prefers native HLS where the browser has it, and falls back
to hls.js where Media Source Extensions exist. `native` and `hls.js` force one;
forcing an engine the browser cannot provide fails with an explained error
rather than silently falling back.

```ts
createHlsProvider(video, { type: 'hls', src, engine: 'hls.js' });
```

## Exports

| Export                 | What it is                                                                 |
| ---------------------- | -------------------------------------------------------------------------- |
| `createHlsProvider`    | Builds the adapter over a `<video>` element and an `HlsSource`.            |
| `selectHlsEngine`      | The engine decision, given a requested engine and a detected environment.  |
| `detectHlsEnvironment` | What the browser offers: native HLS, MSE, or neither.                      |
| `deriveLiveState`      | The `isLive` / `atLiveEdge` derivation, from a duration and a seek window. |

Types: `HlsProviderOptions`, `HlsEnvironment`, `HlsEngineSelection`,
`LiveDerivationInput`, `HlsModuleLoader`, and the structural shapes this adapter
consumes from hls.js — `HlsConstructorLike`, `HlsInstanceLike`, `HlsConfigLike`,
`HlsLevelLike`, `HlsSubtitleTrackLike`, `HlsParsedCueLike`.

## Supplying your own hls.js

`loadHls` replaces the dynamic import — for pinning a version, or serving it
from somewhere else:

```ts
createHlsProvider(video, source, { loadHls: () => import('hls.js') });
```

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

## License

[MIT](LICENSE).
