import * as Player from '@playdeck/react';
import type {
  Availability,
  CommandResult,
  PlayerCapabilities,
  PlayerErrorCategory,
  ProviderAdapter,
  ProviderStatePatch
} from '@playdeck/core';
import { notifySafely } from '@playdeck/core';
import type {
  ProviderAdapterFactory,
  ProviderRegistration
} from '@playdeck/react';

// `examples/provider-setup-providers.tsx` types the `providers` prop's shape
// without implementing it. This file is the other half: a real adapter,
// built from nothing but a `<video>` element and the DOM events it already
// fires -- no import from any `@playdeck/provider-*` package, and no package
// of its own. A consumer who copies it gets a working, if deliberately small,
// second file-backed provider next to the one this library ships.
//
// `ExampleFileOptions.src` -- not a field on the detected source -- is what
// names the file this adapter actually plays. A source string only has to
// name ITS OWN kind: `detectExampleFile` recognises the URL and extracts an
// opaque `clipId`, exactly the way `PlayerProviderOptions.hls`'s `build`
// carries a choice no source string could. Where the clip actually lives is
// the same kind of per-provider setting, so it travels the same way.
export type ExampleFileSource = {
  readonly type: 'example-file';
  readonly clipId: string;
};

export type ExampleFileOptions = { readonly src: string };

const EXAMPLE_FILE_URL_PREFIX = 'https://files.example/clips/';

/**
 * Turns a URL none of the five built-in kinds recognise into this kind's own
 * source object, or declines by returning `undefined` -- the same contract
 * `examples/provider-setup-providers.tsx`'s `detect` types but never runs.
 */
export const detectExampleFile = (
  url: string
): ExampleFileSource | undefined => {
  if (!url.startsWith(EXAMPLE_FILE_URL_PREFIX)) return undefined;
  const clipId = url.slice(EXAMPLE_FILE_URL_PREFIX.length);
  return clipId.length > 0 ? { type: 'example-file', clipId } : undefined;
};

// What this adapter does not implement, reported as `unavailable` with the
// `provider` reason rather than left off `PlayerCapabilities` -- there is no
// way to leave a field off that type, and there would be no honesty in
// picking a reason that named the source or the browser for a limit that is
// this adapter's own. `available` is reserved for a capability this
// adapter's own behaviour makes true outright rather than one any command
// backs -- see `customControls` below, true because nothing about this
// adapter's own behaviour competes with it, not because a command
// implements it.
const unimplemented: Availability = {
  status: 'unavailable',
  reason: 'provider'
};

const capabilities: PlayerCapabilities = {
  seek: unimplemented,
  setVolume: unimplemented,
  setPlaybackRate: unimplemented,
  selectQuality: unimplemented,
  selectQualityAuto: unimplemented,
  selectTextTrack: unimplemented,
  selectAudioTrack: unimplemented,
  chapters: unimplemented,
  liveEdge: unimplemented,
  fullscreen: unimplemented,
  pictureInPicture: unimplemented,
  airPlay: unimplemented,
  // Nothing about this adapter renders the browser's own chrome -- the
  // `<video>` it creates never gets a `controls` attribute -- so this
  // library's own controls are never in competition with a native set.
  customControls: { status: 'available' },
  // A raw file, like the native provider's own: the media carries no still of
  // its own to read, as opposed to a provider that could ask a host for one.
  providerPoster: { status: 'unavailable', reason: 'source' },
  remotePlayback: unimplemented
};

const HAVE_METADATA = 1;

/**
 * The reference adapter: a `<video>` element this factory owns end to end,
 * playing and pausing through its native methods and publishing its own
 * events back onto `ProviderStatePatch`. Everything this file's own
 * `capabilities` marks `unavailable` is genuinely missing here -- there is no
 * quality ladder, no track list, no fullscreen or Picture-in-Picture wiring --
 * rather than present and merely unadvertised.
 */
export const createExampleFileAdapter: ProviderAdapterFactory<
  ExampleFileSource,
  ExampleFileOptions
> = (mount, source, options) => {
  if (!(mount instanceof HTMLDivElement)) {
    // The mount `viewport-media.tsx` renders for any source kind this
    // package ships no loader for -- a div, the same shape the three embed
    // providers already attach into.
    throw new Error(
      'createExampleFileAdapter requires the div mount a supplied kind receives.'
    );
  }
  if (!options?.src) {
    throw new Error(
      'createExampleFileAdapter requires providerOptions["example-file"].src, the file this adapter plays.'
    );
  }

  const video = document.createElement('video');
  video.playsInline = true;
  video.style.width = '100%';
  video.style.height = '100%';
  // Carries the id `detectExampleFile` read off the source URL -- of no use
  // to playback, which is driven by `options.src` below, but visible on the
  // element for a reader or a test to confirm the round trip actually
  // happened.
  video.dataset.exampleFileClipId = source.clipId;
  const sourceElement = document.createElement('source');
  sourceElement.src = options.src;
  video.append(sourceElement);
  mount.append(video);

  const listeners = new Set<(patch: ProviderStatePatch) => void>();
  const emit = (patch: ProviderStatePatch): void => {
    listeners.forEach((listener) => notifySafely(listener, patch));
  };

  const onLoadedMetadata = (): void => {
    emit({
      lifecycle: video.readyState >= HAVE_METADATA ? 'ready' : 'loading',
      activation:
        video.readyState >= HAVE_METADATA ? 'ready' : 'loading-provider',
      duration: Number.isFinite(video.duration) ? video.duration : null,
      capabilities
    });
  };
  const onTimeUpdate = (): void => emit({ currentTime: video.currentTime });
  const onPlaying = (): void => emit({ playback: 'playing' });
  const onPause = (): void => emit({ playback: 'paused' });
  const onEnded = (): void => emit({ playback: 'ended' });
  // Without this, a 404 or a decode failure leaves the player at
  // `lifecycle: 'loading'` forever -- the element fires no other event to
  // move it -- with no `PlayerState.error` for a consumer to read. Mirrors
  // `@playdeck/provider-native`'s own `mediaError`: `MediaError.code` names
  // which of the four DOM categories applies, `network` recoverable and the
  // rest not, since only a network failure stands a chance of succeeding on
  // a retry.
  const onError = (): void => {
    const code = video.error?.code;
    const category: PlayerErrorCategory =
      code === 2
        ? 'network'
        : code === 3
          ? 'decode'
          : code === 4
            ? 'source'
            : 'provider';
    emit({
      lifecycle: 'error',
      activation: 'error',
      playback: 'paused',
      error: {
        category,
        fatal: true,
        recoverable: category === 'network',
        message:
          video.error?.message || 'The media element could not load the source.'
      }
    });
  };

  const play = async (): Promise<CommandResult> => {
    try {
      await video.play();
      return { ok: true };
    } catch (cause) {
      // A browser's autoplay policy is one realistic way `play()` rejects
      // here, but not the only one: the `<source>` above carries no `type`
      // and its `src` is whatever URL a consumer's `providerOptions` names,
      // so a 404 or a format the browser cannot decode is just as real.
      // `NotAllowedError` is the policy refusal specifically; everything
      // else is reported as this library's own catch-all instead of
      // guessed to be `'blocked'`.
      const isPolicyRefusal =
        cause instanceof DOMException && cause.name === 'NotAllowedError';
      return {
        ok: false,
        reason: isPolicyRefusal ? 'blocked' : 'provider-error'
      };
    }
  };
  const pause = async (): Promise<CommandResult> => {
    video.pause();
    return { ok: true };
  };

  const adapter: ProviderAdapter<ExampleFileSource['type']> = {
    // Honest, not a cast: `ProviderAdapter`'s own `Extra` parameter
    // (`@playdeck/core`) is instantiated here with `ExampleFileSource['type']`,
    // the same literal `ProviderAdapterFactory` above already carries, so this
    // adapter reports its own identity rather than borrowing one of the five
    // built-in kinds.
    provider: 'example-file',
    attach: () => {
      video.addEventListener('loadedmetadata', onLoadedMetadata);
      video.addEventListener('timeupdate', onTimeUpdate);
      video.addEventListener('playing', onPlaying);
      video.addEventListener('pause', onPause);
      video.addEventListener('ended', onEnded);
      video.addEventListener('error', onError);
      onLoadedMetadata();
    },
    load: () => {
      emit({ commandsReady: true });
    },
    destroy: () => {
      video.removeEventListener('loadedmetadata', onLoadedMetadata);
      video.removeEventListener('timeupdate', onTimeUpdate);
      video.removeEventListener('playing', onPlaying);
      video.removeEventListener('pause', onPause);
      video.removeEventListener('ended', onEnded);
      video.removeEventListener('error', onError);
      if (!video.paused) {
        try {
          video.pause();
        } catch {
          // Teardown must not escape the provider boundary.
        }
      }
      listeners.clear();
      video.remove();
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    play,
    pause
  };
  return adapter;
};

export const exampleFileProvider: ProviderRegistration<
  ExampleFileSource,
  ExampleFileOptions
> = {
  detect: detectExampleFile,
  load: () => Promise.resolve(createExampleFileAdapter)
};

/**
 * Registering it looks exactly like the general shape
 * `examples/provider-setup-providers.tsx` types, pointed at a real factory
 * instead of a declared one -- and at whatever file `providerOptions` names.
 */
export const ExampleFileProviderClip = () => (
  <Player.Root
    providerOptions={{
      'example-file': { src: 'https://example.com/clips/tracer.mp4' }
    }}
    providers={{ 'example-file': exampleFileProvider }}
    source="https://files.example/clips/tracer"
  >
    <Player.Viewport>
      <Player.Media />
      <Player.PlayButton />
    </Player.Viewport>
  </Player.Root>
);
