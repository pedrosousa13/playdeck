# @playdeck/provider-hls

The HLS provider for [Playdeck](https://github.com/pedrosousa13/playdeck). Picks
between the browser's native HLS and hls.js, and delegates everything the
`<video>` element already answers to `@playdeck/provider-native` rather than
reimplementing it.

```sh
pnpm add @playdeck/provider-hls
```

`@playdeck/react` loads this for you when the source resolves to `hls` — an
`.m3u8` path, or an explicit `{ type: 'hls' }` source; see
[Provider setup](https://github.com/pedrosousa13/playdeck/blob/main/docs/provider-setup.md#the-other-three-providers). hls.js
is a dependency but is imported dynamically, so it only reaches the network when
the hls.js engine is actually selected.

<!-- example:provider-hls -->

```ts
import { PlayerController } from '@playdeck/core';
import { createHlsProvider } from '@playdeck/provider-hls';

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
} from '@playdeck/provider-hls';

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

| Export                 | What it is                                                                        |
| ---------------------- | --------------------------------------------------------------------------------- |
| `createHlsProvider`    | Builds the adapter over a `<video>` element and an `HlsSource`.                   |
| `selectHlsEngine`      | The engine decision, given a requested engine and a detected environment.         |
| `detectHlsEnvironment` | What the browser offers: native HLS, MSE, or neither.                             |
| `deriveLiveState`      | The shared `isLive` / `atLiveEdge` derivation, re-exported from `@playdeck/core`. |

Types: `HlsProviderOptions`, `HlsEnvironment`, `HlsEngineSelection`,
`LiveDerivationInput`, `HlsModuleLoader`, and the structural shapes this adapter
consumes from hls.js — `HlsConstructorLike`, `HlsInstanceLike`, `HlsConfigLike`,
`HlsLevelLike`, `HlsSubtitleTrackLike`, `HlsParsedCueLike`.

## Supplying your own hls.js

`loadHls` replaces the dynamic import — for pinning a version, or serving it
from somewhere else:

<!-- example:provider-hls-loader -->

```ts
import { createHlsProvider } from '@playdeck/provider-hls';

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

### The light build

`hls.js/light` is a supported thing to return. It is about 53 KB gzip smaller
than the full build, and what it drops is alternate audio, subtitles, CMCD, EME
and Variable Substitution:

<!-- example:ignore the same call the provider-hls-loader fixture above compiles, differing only in the module specifier; a second fixture would type-check the same three lines twice -->

```ts
createHlsProvider(videoElement, source, {
  loadHls: () => import('hls.js/light')
});
```

Subtitles are the half that reaches this adapter. The light build still parses a
manifest's subtitle renditions and reports them once, and then never emits
`SUBTITLE_TRACKS_UPDATED`, because the controller that would has been compiled
out. So the tracks can be counted and never selected.

That is reported rather than hidden. On a manifest that declares subtitles, a
build with no subtitle controller publishes:

<!-- example:ignore one published value rather than code to run; the reason it names is asserted by packages/provider-hls/test/captions.test.ts -->

```ts
capabilities.selectTextTrack; // { status: 'unavailable', reason: 'provider-build' }
```

`provider-build` is its own reason because neither neighbour is true: the
provider is perfectly able (`provider` would be wrong) and the media does have
subtitles (`source` would be wrong).

What this changes is the honesty of the state, not what a viewer sees.
`Player.CaptionsButton` renders only on `available`, so it was already absent
here — but the capability read `unknown` / `provider-check`, meaning "still
checking", and it read that for the whole session because the check it was
waiting on was never going to report. An operator reading state, or a test
asserting on it, could not tell a build that cannot show captions from one that
had not finished looking. Now it can.

The detection is a synchronous read of `Hls.DefaultConfig`, where the full build
registers `subtitleTrackController` and the light build does not. A module
exposing no `DefaultConfig` at all is treated as capable, so an unrecognised
build behaves exactly as it did before this existed.

One wart, and it is hls.js's rather than this package's: the `./light` subpath
carries no `types` condition in hls.js's export map, so `import('hls.js/light')`
resolves to `any`. It costs you nothing here, because `loadHls` is typed and the
`any` lands on a typed parameter, but your editor will not describe the module.

Take the light build when you know your manifests carry no subtitles, or when
you render captions yourself from a sidecar `<track>`, which
`Player.Media`'s `textTracks` prop still serves on the hls.js engine. Keep the
full build otherwise: 53 KB is not worth a caption track your viewers needed.

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
[`@playdeck/core`](https://github.com/pedrosousa13/playdeck/blob/main/packages/core/README.md#live-state),
where every adapter shares one copy, and is
re-exported here so a custom HLS adapter can reuse it:

<!-- example:provider-hls-live -->

```ts
import { deriveLiveState } from '@playdeck/provider-hls';

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
