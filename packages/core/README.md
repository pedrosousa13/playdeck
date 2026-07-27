# @reely/core

Framework-neutral player state, commands, events and the provider contract that
[Reely](https://github.com/pedrosousa13/reely) is built on. No DOM rendering, no
React, no provider SDKs.

Use it directly if you are wiring a player into something other than React, or
writing a provider adapter. If you are building UI in React, use
[`@reely/react`](../react), which owns a controller for you.

```sh
pnpm add @reely/core
```

## What it gives you

<!-- example:core-quickstart -->

```ts
import { PlayerController, detectSource } from '@reely/core';
import { createNativeProvider } from '@reely/provider-native';

declare const videoElement: HTMLVideoElement;

// Resolves a URL into an explicit source, or explains why it cannot — nothing
// is handed to a provider to fail later.
const source = detectSource('https://example.com/clip.mp4');
if (source.status === 'failure') throw new Error(source.guidance);

const controller = new PlayerController();
controller.setProvider(createNativeProvider(videoElement));

const unsubscribe = controller.subscribe((state) => {
  console.log(state.playback, state.currentTime, state.capabilities.seek);
});

// Commands are answered, never queued: `whenReady` is how you find out when
// one will land, rather than issuing it and hoping.
export const start = async (): Promise<void> => {
  if (await controller.whenReady()) await controller.play();
};

export const stop = (): void => {
  unsubscribe();
  controller.setProvider(undefined);
};
```

<!-- /example -->

## The two ideas worth knowing before the API list

**Capabilities are three-valued.** Every entry in `PlayerState.capabilities` is
`available`, `unknown`, or `unavailable` with a reason (`browser`, `policy`,
`provider`, `source`, `not-ready`). A control reading them renders nothing while
the answer is `unknown` rather than showing something disabled, and never has to
guess what a provider can do.

**Commands are answered, never queued.** Every command resolves a
`CommandResult` — `{ ok: true }` or `{ ok: false, reason }`. Before a provider
declares itself ready, commands are refused with `not-ready` and nothing is
replayed later. `PlayerState.commandsReady` and `whenReady()` are how you find
out when a command will land; `activation` is not a substitute for either.

## Exports

### Values

| Export                       | What it is                                                                                          |
| ---------------------------- | --------------------------------------------------------------------------------------------------- |
| `PlayerController`           | The controller: holds state, issues commands, emits events, owns a `ProviderAdapter`.               |
| `detectSource`               | Resolves a string or explicit source object into a `ResolvedPlayerSource`, or an explained failure. |
| `createInitialPlayerState`   | The state a controller starts from — useful for server rendering and for test fixtures.             |
| `getMediaSessionCoordinator` | The one coordinator for a given `MediaSession`, so several players arbitrate lock-screen ownership. |
| `bindMediaSession`           | Binds a controller's confirmed playback to a coordinator root, and routes its actions back.         |
| `textTrackLabel`             | The label a provider should publish for a track, given its own label and language.                  |

### Types

State and contract: `PlayerState`, `PlayerCapabilities`, `Availability`,
`CommandResult`, `CommandFailureReason`, `PlaybackState`, `PlayerProvider`,
`PlayerQuality`, `TimeRange`, `TextTrack`, `TextTrackKind`,
`TextTrackReadiness`, `TextCue`, `CaptionRendering`, `PlayerLiveState`,
`PlayerError`, `PlayerErrorCategory`, `PreProviderActivation`.

Events: `PlayerEvent`, `PlayerEventType`, `PlayerEventDetailMap`,
`PlayerEventFor`, `PlayerEventOrigin`.

Sources: `PlayerSource`, `ResolvedPlayerSource`, `VideoFileSource`, `HlsSource`,
`HlsEngine`, `YouTubeSource`, `VimeoSource`, `SourceDetectionResult`,
`SourceDetectionSuccess`, `SourceDetectionFailure`,
`SourceDetectionFailureReason`.

Providers: `ProviderAdapter`, `ProviderStatePatch`, `ProviderStateListener`,
`ProviderEvent`, `ProviderEventFor`.

Autoplay: `AutoplayMode`, `AutoplayConfigurationOptions`.

Media Session: `MediaSessionLike`, `MediaSessionCoordinator`,
`MediaSessionRoot`, `MediaSessionRootConfig`, `MediaSessionActions`,
`MediaSessionBinding`, `MediaMetadataInput`, `MediaSessionArtwork`,
`MediaSessionPositionState`.

## Source detection

`detectSource` accepts a URL string or an explicit source object, and validates
both. A YouTube or Vimeo URL only resolves if the host, path shape and id are
all recognised; anything else fails with `malformed-string`,
`unsupported-string` or `invalid-source` rather than being passed on to a
provider to fail later.

```ts
detectSource('https://vimeo.com/76979871?h=8272103f6e'); // vimeo + privacy hash
detectSource('https://www.youtube.com/watch?v=dQw4w9WgXcQ&v=other'); // failure
detectSource({ type: 'hls', src: '/master.m3u8', engine: 'hls.js' });
```

Only `http:` and `https:` (and protocol-relative `//`) are accepted for string
sources.

## License

[MIT](LICENSE).
