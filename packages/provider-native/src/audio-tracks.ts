import type {
  AudioTrack,
  Availability,
  CommandResult,
  PlayerCapabilities,
  ProviderStatePatch
} from '@playdeck/core';
import { textTrackLabel } from '@playdeck/core';
import { available, unsupported } from './adapter-values.js';

// The DOM's own `AudioTrackList`/`AudioTrack` never made it into
// TypeScript's bundled `lib.dom.d.ts` -- unlike `TextTrackList`, which is
// there even on engines that implement neither -- so this seam defines its
// own structural slice instead of augmenting a global. Chrome exposes no
// `audioTracks` property on `HTMLMediaElement` at all; Firefox and Safari do.
type NativeAudioTrack = {
  readonly id: string;
  readonly label: string;
  readonly language: string;
  enabled: boolean;
};

type NativeAudioTrackList = {
  readonly length: number;
  readonly [index: number]: NativeAudioTrack | undefined;
  addEventListener: (type: string, listener: () => void) => void;
  removeEventListener: (type: string, listener: () => void) => void;
};

type MediaWithAudioTracks = HTMLMediaElement & {
  readonly audioTracks?: NativeAudioTrackList;
};

export type NativeAudioTracks = {
  readonly selectAudioTrack: (id: string) => Promise<CommandResult>;
  // Initial discovery -- call once after attach.
  readonly discover: () => void;
  readonly attachListeners: () => void;
  readonly destroy: () => void;
  // The `selectAudioTrack` facet of the host's capabilities: `browser` where
  // the media element exposes no `AudioTrackList` at all, `source` where it
  // does but the current media has nothing in it, and `available` once at
  // least one audio track is in hand.
  readonly selectAudioTrackAvailability: () => Availability;
};

const nativeAudioTrackId = (track: NativeAudioTrack, index: number): string =>
  track.id || `native:${index}`;

// Builds the audio-track subsystem that layers on top of an
// `HTMLMediaElement`'s (non-standard, browser-dependent) `audioTracks`:
// discovery and selection. `emit` publishes provider-state patches
// (`audioTracks`) and `getCapabilities` recomputes the host's full
// `PlayerCapabilities` snapshot, since audio-track availability is only one
// facet of the host's overall capabilities. Unlike captions, an audio
// track's selection lives on the track itself (`enabled`, enforced
// exclusive by the browser) rather than in a held selection this seam has
// to reconcile against a default-track rule, so there is no explicit
// discovery here beyond a fresh read on every call.
export const createNativeAudioTracks = (
  media: HTMLMediaElement,
  emit: (patch: ProviderStatePatch) => void,
  getCapabilities: () => PlayerCapabilities
): NativeAudioTracks => {
  const nativeMedia = media as MediaWithAudioTracks;
  let audioTrackList: NativeAudioTrackList | undefined;
  let hasSelectableAudioTracks = false;

  const entries = (): NativeAudioTrack[] => {
    const list = nativeMedia.audioTracks;
    if (!list) return [];
    const result: NativeAudioTrack[] = [];
    for (let index = 0; index < list.length; index += 1) {
      const track = list[index];
      if (track) result.push(track);
    }
    return result;
  };

  const discoverAudioTracks = (): void => {
    const list = entries();
    hasSelectableAudioTracks = list.length > 0;
    const audioTracks: AudioTrack[] = list.map((track, index) => ({
      id: nativeAudioTrackId(track, index),
      label: textTrackLabel(track.label, track.language),
      language: track.language || null,
      active: track.enabled === true
    }));
    emit({ audioTracks, capabilities: getCapabilities() });
  };

  const onAudioTracksChange = (): void => discoverAudioTracks();

  return {
    selectAudioTrack: async (id) => {
      const list = entries();
      const index = list.findIndex(
        (track, trackIndex) => nativeAudioTrackId(track, trackIndex) === id
      );
      if (index === -1) return { ok: false, reason: 'unsupported' };
      list.forEach((track, trackIndex) => {
        track.enabled = trackIndex === index;
      });
      discoverAudioTracks();
      return { ok: true };
    },
    discover: () => discoverAudioTracks(),
    attachListeners: () => {
      audioTrackList = nativeMedia.audioTracks;
      audioTrackList?.addEventListener('addtrack', onAudioTracksChange);
      audioTrackList?.addEventListener('removetrack', onAudioTracksChange);
      audioTrackList?.addEventListener('change', onAudioTracksChange);
    },
    destroy: () => {
      audioTrackList?.removeEventListener('addtrack', onAudioTracksChange);
      audioTrackList?.removeEventListener('removetrack', onAudioTracksChange);
      audioTrackList?.removeEventListener('change', onAudioTracksChange);
      audioTrackList = undefined;
    },
    selectAudioTrackAvailability: () =>
      !nativeMedia.audioTracks
        ? unsupported
        : hasSelectableAudioTracks
          ? available
          : { status: 'unavailable', reason: 'source' }
  };
};
