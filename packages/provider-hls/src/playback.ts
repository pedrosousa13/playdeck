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
  | 'showAirPlayPicker';

export type HlsPlaybackDeps = {
  readonly isDestroyed: () => boolean;
  // Rolls every seam's engine-scoped state back before the engine restarts;
  // what `retry` must do that a plain `load` must not.
  readonly resetEngineState: () => void;
  readonly startHlsJs: () => Promise<CommandResult>;
};

// The playback-command seam: the delegated transport commands plus `retry`,
// the one command whose meaning depends on the selected engine.
export type HlsPlayback = Pick<NativeProviderAdapter, HlsDelegatedCommand> & {
  readonly retry: () => Promise<CommandResult>;
};

export const createHlsPlayback = (
  native: Pick<NativeProviderAdapter, HlsDelegatedCommand | 'retry'>,
  selection: HlsEngineSelection,
  { isDestroyed, resetEngineState, startHlsJs }: HlsPlaybackDeps
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
    retry: async (): Promise<CommandResult> => {
      if (isDestroyed()) return { ok: false, reason: 'not-ready' };
      if (!engine) {
        return { ok: false, reason: 'unsupported', error: selection.error };
      }
      if (engine === 'native') return native.retry();
      resetEngineState();
      // No engine teardown here: the engine start owns it (#85).
      return startHlsJs();
    }
  };
};
