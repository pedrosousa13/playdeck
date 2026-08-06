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
`HlsEngine`, `YouTubeSource`, `VimeoSource`, `WistiaSource`,
`SourceDetectionResult`, `SourceDetectionSuccess`, `SourceDetectionFailure`,
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
both. A YouTube, Vimeo or Wistia URL only resolves if the host, path shape and
id are all recognised; anything else fails with `malformed-string`,
`unsupported-string` or `invalid-source` rather than being passed on to a
provider to fail later. Wistia is the one exception, because it also serves
plain media files on its own hosts: a Wistia URL that is not an embed shape is
still read by file extension, so its HLS manifests and direct deliveries resolve
as `hls` and `video`.

<!-- example:core-source-detection -->

```ts
import { detectSource } from '@reely/core';

// A URL only resolves if the host, path shape and id are all recognised.
const vimeo = detectSource('https://vimeo.com/76979871?h=8272103f6e');
if (vimeo.status === 'success' && vimeo.source.type === 'vimeo') {
  console.log(vimeo.source.videoId, vimeo.source.hash); // privacy hash kept
}

// Two `v` parameters: ambiguous, so it fails here rather than in a provider.
const ambiguous = detectSource(
  'https://www.youtube.com/watch?v=dQw4w9WgXcQ&v=other'
);
if (ambiguous.status === 'failure') {
  console.log(ambiguous.reason, ambiguous.guidance);
}

// Explicit source objects are validated too, and skip detection.
export const explicit = detectSource({
  type: 'hls',
  src: '/master.m3u8',
  engine: 'hls.js'
});
```

<!-- /example -->

Only `http:` and `https:` (and protocol-relative `//`) are accepted for string
sources.

## Starting state

`createInitialPlayerState()` is the state a controller starts from — what to
render on a server, and what a test fixture should begin with.

<!-- example:core-state -->

```ts
import { createInitialPlayerState, textTrackLabel } from '@reely/core';

// The state a controller starts from. Safe to render on a server, where no
// provider exists yet — and the same state a test fixture should start from.
const initial = createInitialPlayerState();

console.log(initial.duration); // null — nothing has loaded
console.log(initial.capabilities.seek.status); // 'unknown', not 'unavailable'

// A control reading an `unknown` capability renders nothing rather than
// something disabled: the answer is not "no", it is "not yet".
export const seekIsUndecided = initial.capabilities.seek.status === 'unknown';

// The label a provider should publish for a track, given the track's own label
// and its language. Falls back to the language's own name, then to 'Unknown'.
export const labelled = textTrackLabel('', 'pt-BR'); // 'português (Brasil)'
export const named = textTrackLabel('Commentary', 'en'); // 'Commentary'
```

<!-- /example -->

## Media Session

One coordinator per `MediaSession`, so several players on a page arbitrate
lock-screen ownership instead of overwriting each other. `bindMediaSession`
publishes a controller's confirmed playback to it and routes the lock screen's
actions back.

<!-- example:core-media-session -->

```ts
import {
  PlayerController,
  bindMediaSession,
  getMediaSessionCoordinator
} from '@reely/core';

declare const controller: PlayerController;

// One coordinator per MediaSession. Two players on the same page arbitrate
// lock-screen ownership through it instead of overwriting each other.
const coordinator = getMediaSessionCoordinator(navigator.mediaSession);

// Binds this controller's *confirmed* playback to the coordinator, and routes
// the lock screen's play/pause/seek actions back to it.
const binding = bindMediaSession(controller, coordinator, {
  metadata: { title: 'Big Buck Bunny', artist: 'Blender Foundation' }
});

export const rename = (): void => binding.setMetadata({ title: 'Sintel' });

// Release when the player unmounts: ownership passes to whichever player is
// still playing.
export const release = (): void => binding.release();
```

<!-- /example -->

## License

[MIT](LICENSE).
