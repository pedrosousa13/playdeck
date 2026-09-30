import type { CommandResult } from '@playdeck/core';
import type { NativeProviderAdapter } from '@playdeck/provider-native';
import type { HlsEngineSelection } from './adapter-values.js';

// The transport commands both engines delegate verbatim to the embedded
// native adapter: either engine plays into the same media element, so the
// element-level commands need no HLS-specific handling.
type HlsDelegatedCommand =
  | 'play'
  | 'pause'
  | 'seekTo'
  | 'seekBy'
  | 'mute'
  | 'unmute'
  | 'setVolume'
  | 'setPlaybackRate'
  | 'requestFullscreen'
  | 'exitFullscreen'
  | 'requestPictureInPicture'
  | 'exitPictureInPicture'
  | 'showAirPlayPicker'
  | 'showRemotePlaybackPicker';

export type HlsPlaybackDeps = {
  readonly isDestroyed: () => boolean;
  // Rolls every seam's engine-scoped state back before the engine restarts;
  // what `retry` must do that a plain `load` must not.
  readonly resetEngineState: () => void;
  readonly startHlsJs: () => Promise<CommandResult>;
  // Read only on the hls.js engine, where `seekToLiveEdge`'s target is hls.js's
  // own live-edge position rather than the raw seekable end `native.seekTo`
  // would otherwise be handed on the other two engines.
  readonly getLiveSyncPosition: () => number | undefined;
};

// The playback-command seam: the delegated transport commands plus `retry` and
// `seekToLiveEdge`, whose meaning depends on the selected engine.
export type HlsPlayback = Pick<NativeProviderAdapter, HlsDelegatedCommand> & {
  readonly retry: () => Promise<CommandResult>;
  readonly seekToLiveEdge: () => Promise<CommandResult>;
};

export const createHlsPlayback = (
  native: Pick<
    NativeProviderAdapter,
    HlsDelegatedCommand | 'retry' | 'seekToLiveEdge'
  >,
  selection: HlsEngineSelection,
  {
    isDestroyed,
    resetEngineState,
    startHlsJs,
    getLiveSyncPosition
  }: HlsPlaybackDeps
): HlsPlayback => {
  const engine = selection.engine;
  return {
    play: native.play,
    pause: native.pause,
    seekTo: native.seekTo,
    seekBy: native.seekBy,
    mute: native.mute,
    unmute: native.unmute,
    setVolume: native.setVolume,
    setPlaybackRate: native.setPlaybackRate,
    requestFullscreen: native.requestFullscreen,
    exitFullscreen: native.exitFullscreen,
    requestPictureInPicture: native.requestPictureInPicture,
    exitPictureInPicture: native.exitPictureInPicture,
    showAirPlayPicker: native.showAirPlayPicker,
    showRemotePlaybackPicker: native.showRemotePlaybackPicker,
    retry: async (): Promise<CommandResult> => {
      if (isDestroyed()) return { ok: false, reason: 'not-ready' };
      if (!engine) {
        return { ok: false, reason: 'unsupported', error: selection.error };
      }
      if (engine === 'native') return native.retry();
      resetEngineState();
      // No engine teardown here: the engine start owns it (#85).
      return startHlsJs();
    },
    seekToLiveEdge: async (): Promise<CommandResult> => {
      if (isDestroyed()) return { ok: false, reason: 'not-ready' };
      if (!engine) {
        return { ok: false, reason: 'unsupported', error: selection.error };
      }
      if (engine === 'native') return native.seekToLiveEdge();
      const edge = getLiveSyncPosition();
      if (!Number.isFinite(edge))
        return { ok: false, reason: 'provider-error' };
      return native.seekTo(edge as number);
    }
  };
};
