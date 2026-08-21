# @playdeck/core

Framework-neutral player state, commands, events and the provider contract that
[Playdeck](https://github.com/pedrosousa13/playdeck) is built on. No DOM rendering, no
React, no provider SDKs.

Use it directly if you are wiring a player into something other than React, or
writing a provider adapter. If you are building UI in React, use
[`@playdeck/react`](../react), which owns a controller for you.

```sh
pnpm add @playdeck/core
```

## What it gives you

<!-- example:core-quickstart -->

```ts
import { PlayerController, detectSource } from '@playdeck/core';
import { createNativeProvider } from '@playdeck/provider-native';

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

| Export                       | What it is                                                                                                     |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `PlayerController`           | The controller: holds state, issues commands, emits events, owns a `ProviderAdapter`.                          |
| `detectSource`               | Resolves a string or explicit source object into a `ResolvedPlayerSource`, or an explained failure.            |
| `isPermittedSourceUrl`       | Whether the library will carry a source URL to a provider — the one such decision, which detection consults.   |
| `resolveNetworkPath`         | Normalises a protocol-relative URL (`//host/...`) to `https:`; returns every other value unchanged.            |
| `createInitialPlayerState`   | The state a controller starts from — useful for server rendering and for test fixtures.                        |
| `getMediaSessionCoordinator` | The one coordinator for a given `MediaSession`, so several players arbitrate lock-screen ownership.            |
| `bindMediaSession`           | Binds a controller's confirmed playback to a coordinator root, and routes its actions back.                    |
| `textTrackLabel`             | The label a provider should publish for a track, given its own label and language.                             |
| `notifySafely`               | Notifies one listener so that its throw neither abandons the emit nor escapes into the caller.                 |
| `createTimeBoundary`         | The sanitised `[startTime, endTime]` window a provider enforces, and every question it answers.                |
| `deriveLiveState`            | The `isLive` / `atLiveEdge` derivation every adapter publishes `live` from.                                    |
| `liveStateEqual`             | Whether two live states say the same thing — what an adapter checks before publishing a change.                |
| `deriveChapters`             | The published `Chapter` collection, given what a provider reports and the media duration — end times included. |
| `chaptersEqual`              | Whether two chapter collections say the same thing — what an adapter checks before publishing a change.        |
| `isYouTubeVideoId`           | Whether a value is a well-formed YouTube video id — what `createYouTubeProvider` validates a direct call with. |
| `isVimeoVideoId`             | Whether a value is a well-formed Vimeo video id — what `createVimeoProvider` validates a direct call with.     |
| `isVimeoHash`                | Whether a value is a well-formed Vimeo privacy hash — what `createVimeoProvider` validates a direct call with. |
| `isWistiaMediaId`            | Whether a value is a well-formed Wistia media id — what `createWistiaProvider` validates a direct call with.   |

### Types

State and contract: `PlayerState`, `PlayerCapabilities`, `Availability`,
`CommandResult`, `CommandFailureReason`, `PlaybackState`, `PlayerProvider`,
`PlayerQuality`, `TimeRange`, `TextTrack`, `TextTrackKind`,
`TextTrackReadiness`, `TextCue`, `CaptionRendering`, `Chapter`, `ChapterInput`,
`PlayerLiveState`, `PlayerError`, `PlayerErrorCategory`, `RefusedPlay`,
`RefusedUrlSurface`, `PreProviderActivation`.

Events: `PlayerEvent`, `PlayerEventType`, `PlayerEventDetailMap`,
`PlayerEventFor`, `PlayerEventOrigin`.

Sources: `PlayerSource`, `ResolvedPlayerSource`, `VideoFileSource`, `HlsSource`,
`HlsEngine`, `YouTubeSource`, `VimeoSource`, `WistiaSource`,
`SourceDetectionResult`, `SourceDetectionSuccess`, `SourceDetectionFailure`,
`SourceDetectionFailureReason`.

Providers: `ProviderAdapter`, `ProviderStatePatch`, `ProviderStateListener`,
`ProviderEvent`, `ProviderEventFor`, `TimeBoundary`, `LiveDerivationInput`.

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
as `hls` and `video`. Every accepted form, per provider, is listed in
[Provider setup](../../docs/provider-setup.md).

<!-- example:core-source-detection -->

```ts
import {
  detectSource,
  isPermittedSourceUrl,
  isVimeoHash,
  isVimeoVideoId,
  isWistiaMediaId,
  isYouTubeVideoId,
  resolveNetworkPath
} from '@playdeck/core';

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

// Explicit source objects are validated too, and skip detection: the same
// scheme allowlist runs over their `src` values, so `javascript:` and `data:`
// cannot reach a provider by taking the object path.
export const explicit = detectSource({
  type: 'hls',
  src: '/master.m3u8',
  engine: 'hls.js'
});

// The decision detection consults, should you need to ask it yourself. Pass
// the type of the source the URL belongs to, or `undefined` for a bare string
// no type has been resolved for yet. The type is load-bearing: a `blob:`
// handle is for a video element to read, not for the HLS manifest loader to
// fetch, and never for an undetected string.
const objectUrl = URL.createObjectURL(new Blob([], { type: 'video/mp4' }));
console.log(isPermittedSourceUrl(objectUrl, 'video')); // true
console.log(isPermittedSourceUrl(objectUrl, 'hls')); // false
console.log(isPermittedSourceUrl(objectUrl, undefined)); // false

// The same per-provider id checks a factory runs on a direct call, should you
// need to validate an id before ever reaching `createYouTubeProvider`,
// `createVimeoProvider` or `createWistiaProvider` yourself.
console.log(isYouTubeVideoId('dQw4w9WgXcQ')); // true
console.log(isVimeoVideoId('76979871')); // true
console.log(isVimeoHash('8272103f6e')); // true
console.log(isWistiaMediaId('abc123')); // true

// The substitution `isPermittedSourceUrl` itself never performs, for a caller
// that validates a URL and then needs to write the same normalisation back.
console.log(resolveNetworkPath('//example.com/clip.mp4')); // 'https://example.com/clip.mp4'
console.log(resolveNetworkPath('https://example.com/clip.mp4')); // unchanged
```

<!-- /example -->

One scheme allowlist governs both paths, and `isPermittedSourceUrl` is it.
`http:`, `https:` and the scheme-less forms — protocol-relative, root-relative
and relative paths — are permitted; `blob:` is permitted only for a `video`
source, which is how a `MediaSource` or a picked `File` is handed over.
Everything else, `javascript:`, `data:` and `file:` included, is rejected,
whether it arrives as a string or inside an explicit source object, and however
it is dressed up in the characters the URL parser removes before it parses. A
URL carrying a raw tab, line feed or carriage return anywhere, or a C0 control
(U+0000 to U+001F) or a space at either end, is rejected: the parser strips
exactly those, so ` javascript:alert(1)` names no scheme to
validate yet loads as `javascript:` all the same. Rejecting such a URL rather
than trimming it keeps the value that plays identical to the value that was
validated. A protocol-relative URL resolves against `https:`, and the resolved
source carries that resolution rather than the `//host/...` form — for a string
and for every `src` inside an explicit source object alike. So a result's
`source` may be a normalised copy of the object passed in; its `input` is
always the caller's own object.

## Starting state

`createInitialPlayerState()` is the state a controller starts from — what to
render on a server, and what a test fixture should begin with.

<!-- example:core-state -->

```ts
import { createInitialPlayerState, textTrackLabel } from '@playdeck/core';

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

## Time boundary

`createTimeBoundary()` resolves a `[startTime, endTime]` window once and then
answers every question a provider asks of it. The embed providers (YouTube,
Vimeo, Wistia) have no trustworthy native end mechanism, so each one enforces
the window from its own adapter — and this is what makes all three enforce it
the same way.

<!-- example:core-time-boundary -->

```ts
import { createTimeBoundary } from '@playdeck/core';

// The `[startTime, endTime]` window a provider plays inside, sanitised once.
// A start that is absent, non-positive or non-finite is no start; an end that
// is absent, non-finite, or not above the start is no end.
const bounds = createTimeBoundary({ startTime: 30, endTime: 90 });

console.log(bounds.startTime, bounds.endTime); // 30 90 — the load hints

// Every question is asked against the duration, which caps the window: pass
// `null` or `undefined` before the media reports one.
export const startsAt = bounds.start(120); // 30 — where playback begins
export const endsAt = bounds.end(60); // 60 — the duration caps the end
export const reachedEnd = bounds.atEnd(120, 91); // true — publish `ended` here
export const seekTarget = bounds.clamp(120, 999); // 90 — seeks stay inside

// The two loop questions. A platform loop wraps to zero rather than to the
// start boundary, so a playhead behind the start of a positioned player is that
// wrap; and the platform's own end is only worth correcting when the window
// begins somewhere other than zero.
export const wrapped = bounds.atWrap(120, 5, { loop: true, positioned: true });
export const restarts = bounds.restartsAtStart(true); // true

// A nonsense window is dropped rather than reported: this plays the whole video.
export const unbounded = createTimeBoundary({ startTime: -1, endTime: 0 });
```

<!-- /example -->

## Live state

`deriveLiveState` is the one liveness derivation in the workspace, so
`PlayerState.live` means the same thing whichever adapter published it. It reads
provider signals and normalized state only — a duration, a seekable window, a
playhead, and the provider's own live flag where it has one. A source URL, an id
or a filename never decides: a name is a guess, and a guess published as state
is a control that lies.

`atEdgeThreshold` is optional, and omitting it is how an adapter takes the
shared tolerance. The constant itself is not exported, so no adapter carries a
number of its own.

<!-- example:core-live-state -->

```ts
import { deriveLiveState, liveStateEqual } from '@playdeck/core';

// Liveness comes from what the provider reports — never from the URL, the id
// or a filename. `isLiveHint` is the provider's own answer where it has one;
// leave it undefined and an infinite duration decides instead.
export const live = deriveLiveState({
  isLiveHint: true,
  duration: Number.POSITIVE_INFINITY,
  seekable: [{ start: 120, end: 3600 }],
  currentTime: 3594
});

// -> { isLive: true, atLiveEdge: true }. `null` means "not live, or not yet
// known" — a control should not claim either until it is.
export const atEdge = live?.atLiveEdge ?? false;

// Omitting `atEdgeThreshold` uses the shared tolerance every adapter uses.
// Pass one only to answer a different question than the players do.
const tight = deriveLiveState({
  isLiveHint: true,
  duration: Number.POSITIVE_INFINITY,
  seekable: [{ start: 120, end: 3600 }],
  currentTime: 3594,
  atEdgeThreshold: 2
});

// An adapter publishes `live` only when the value changes. This is that test.
export const changed = !liveStateEqual(live, tight);
```

<!-- /example -->

Providers that cannot determine liveness leave `live` as `null`. That is not
"this is on-demand" — it is "nobody has said", and a control should render
neither claim until one arrives.

## Chapters

`PlayerState.chapters` is the named divisions of the current video, ordered by
`startTime`, and `capabilities.chapters` says whether the provider can report
any at all — an empty collection means "none here", not "this provider cannot
tell you". Playdeck publishes the vocabulary and draws none of it: a consumer maps
a chapter to a position on the seek slider, which already takes children.

`deriveChapters` is the one derivation every adapter publishes through, so a
chapter means the same thing whichever one reported it.

<!-- example:core-chapters -->

```ts
import { chaptersEqual, deriveChapters } from '@playdeck/core';

// A provider reports where a chapter begins and what it is called. Nothing
// reports where one ends, so `deriveChapters` is what decides: the list is
// ordered by `startTime`, and each chapter ends where the next one begins.
export const chapters = deriveChapters(
  [
    { id: 'ch2', title: 'The build', startTime: 132 },
    { id: 'ch1', title: 'Introduction', startTime: 0 }
  ],
  248
);

// -> 132. The last chapter takes the media duration, so this reads 248.
export const firstEnd = chapters[0]?.endTime;

// An unknown or endless duration leaves the last chapter open. `null`, never
// `Infinity`: an end nobody knows must not read as one somebody does.
export const openEnded = deriveChapters(
  [{ id: 'ch1', title: 'Live', startTime: 0 }],
  null
).at(-1)?.endTime;

// An adapter publishes `chapters` only when the collection changes — a
// duration report that moves nothing publishes nothing. This is that test.
export const closed = !chaptersEqual(
  chapters,
  deriveChapters([{ id: 'ch1', title: 'Introduction', startTime: 0 }], null)
);
```

<!-- /example -->

## Notifying subscribers

`notifySafely()` is how a provider adapter notifies one of its own listeners.
An adapter's `subscribe` accepts any number of subscribers and promises each of
them every notification, so no single listener may abandon an emit — and a
listener that throws must not be reported as a provider failure (#233).

<!-- example:core-notify-safely -->

```ts
import {
  notifySafely,
  type ProviderEvent,
  type ProviderStatePatch,
  type ProviderStateListener
} from '@playdeck/core';

// What a provider adapter owes the subscribers it fans out to. `Set.forEach`
// stops at the first throw, so one broken listener would abandon the emit:
// every listener registered behind it misses that notification, and the throw
// escapes back into whatever called the emit — often a vendor SDK's own event
// dispatch, or the adapter's start path, where it would be reported as a
// provider load failure rather than as the consumer's bug it is.
const listeners = new Set<ProviderStateListener>();

export const subscribe = (listener: ProviderStateListener): (() => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

// Isolated, not silenced: a listener that throws has its error rethrown on a
// fresh task, so it still reaches the page's uncaught-error handling the way a
// listener throwing at top level would.
export const emit = (
  patch: ProviderStatePatch,
  event?: ProviderEvent
): void => {
  listeners.forEach((listener) => notifySafely(listener, patch, event));
};

subscribe(() => {
  throw new Error('a subscriber defect');
});
const seen: string[] = [];
subscribe((patch) => {
  seen.push(patch.lifecycle ?? 'unchanged');
});

emit({ lifecycle: 'ready' });

console.log(seen); // ['ready'] — the subscriber behind the thrower still ran
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
} from '@playdeck/core';

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
