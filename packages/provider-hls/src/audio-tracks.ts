import type {
  AudioTrack,
  Availability,
  CommandResult,
  ProviderStatePatch
} from '@playdeck/core';
import { textTrackLabel } from '@playdeck/core';
import type {
  EmitProviderState,
  HlsAudioTrackLike,
  HlsInstanceLike
} from './adapter-values.js';

const hlsAudioTrackId = (track: HlsAudioTrackLike, index: number): string =>
  track.id !== undefined && track.id !== null
    ? `hls:${track.id}`
    : `hls:${index}`;

export type HlsAudioTracksDeps = {
  readonly emit: EmitProviderState;
  readonly isDestroyed: () => boolean;
  // The live engine instance selections are pushed into; undefined until the
  // hls.js engine has started.
  readonly getInstance: () => Pick<HlsInstanceLike, 'audioTrack'> | undefined;
  // The host's re-decorated capabilities, as a spreadable patch fragment --
  // empty until the first capabilities snapshot has been seen.
  readonly capabilitiesPatch: () => ProviderStatePatch;
};

// The hls.js audio-tracks seam: track discovery and selection, keyed to
// hls.js's own audioTracks/audioTrack surface rather than the media
// element's (non-standard) AudioTrackList. Mirrors
// packages/provider-hls/src/text-tracks.ts's manifest-settle-then-list-update
// shape, minus a cues pipeline -- an audio track carries nothing to window to
// the current time -- and minus a held "explicitly selected" flag: `active`
// is rebuilt from the live `instance.audioTrack` on every rebuild, but that
// getter is not settled yet when `AUDIO_TRACKS_UPDATED` fires --
// `AudioTrackController.switchLevel` triggers that event before it resolves
// a default track, so a rebuild driven by it alone reads every track as
// inactive. `AUDIO_TRACK_SWITCHING` is what carries the settled selection,
// for both that internal default pick and an explicit `selectAudioTrack`,
// mirroring `SUBTITLE_TRACK_SWITCH`'s role for `subtitleTrack`. The host
// wires `handlers` to the engine's events, guarding staleness itself.
export type HlsAudioTracks = {
  readonly selectAudioTrack: (id: string) => Promise<CommandResult>;
  // The `selectAudioTrack` facet of the host's capabilities on the hls.js
  // engine.
  readonly selectAudioTrackAvailability: () => Availability;
  // Returns the seam to its pre-engine state; called on retry.
  readonly reset: () => void;
  readonly handlers: {
    // Settles the capability from the manifest, which is the only reading
    // both hls.js builds agree on. `buildSupportsAudioTracks` comes from
    // `hlsBuildSupportsAudioTracks`.
    readonly onManifestParsed: (
      data: unknown,
      buildSupportsAudioTracks: boolean
    ) => void;
    readonly onAudioTracksUpdated: (
      instance: Pick<HlsInstanceLike, 'audioTrack' | 'audioTracks'>,
      data: unknown
    ) => void;
    // Rebuilds `active` from the now-settled `instance.audioTrack`, for both
    // hls.js's own default-track pick and an explicit `selectAudioTrack` --
    // see this file's header comment for why `AUDIO_TRACKS_UPDATED` alone
    // cannot answer this.
    readonly onAudioTrackSwitching: (
      instance: Pick<HlsInstanceLike, 'audioTrack'>
    ) => void;
  };
};

export const createHlsAudioTracks = ({
  emit,
  isDestroyed,
  getInstance,
  capabilitiesPatch
}: HlsAudioTracksDeps): HlsAudioTracks => {
  let selectAudioTrackAvailability: Availability = {
    status: 'unknown',
    reason: 'provider-check'
  };
  let hlsAudioTrackList: AudioTrack[] = [];

  return {
    selectAudioTrack: async (id) => {
      const instance = getInstance();
      if (isDestroyed() || !instance) {
        return { ok: false, reason: 'not-ready' };
      }
      const index = hlsAudioTrackList.findIndex((track) => track.id === id);
      if (index === -1) return { ok: false, reason: 'unsupported' };
      // `AUDIO_TRACK_SWITCHING` fires synchronously off this assignment (both
      // in real hls.js and in the fake); `onAudioTrackSwitching` rebuilds
      // `active` from it rather than this method remapping it itself -- see
      // this file's header comment. `handlers.onAudioTracksUpdated` also
      // writes `active`, on a full track-list rebuild.
      instance.audioTrack = index;
      return { ok: true };
    },
    selectAudioTrackAvailability: () => selectAudioTrackAvailability,
    reset: () => {
      selectAudioTrackAvailability = {
        status: 'unknown',
        reason: 'provider-check'
      };
      hlsAudioTrackList = [];
    },
    handlers: {
      // Mirrors `HlsTextTracks.handlers.onManifestParsed` exactly, off the
      // sibling `audioTracks` field the same `ManifestParsedData` payload
      // carries -- see that handler's comment for why the manifest, rather
      // than `AUDIO_TRACKS_UPDATED` alone, is what settles a
      // no-renditions-at-all verdict.
      onManifestParsed: (data, buildSupportsAudioTracks) => {
        const declared = (data as { audioTracks?: ReadonlyArray<unknown> })
          .audioTracks;
        if (!Array.isArray(declared)) return;
        const hasAudioRenditions = declared.length > 0;
        if (hasAudioRenditions && buildSupportsAudioTracks) return;
        selectAudioTrackAvailability = hasAudioRenditions
          ? { status: 'unavailable', reason: 'provider-build' }
          : { status: 'unavailable', reason: 'source' };
        emit({ ...capabilitiesPatch() });
      },
      onAudioTracksUpdated: (instance, data) => {
        const rawTracks =
          (data as { audioTracks?: ReadonlyArray<HlsAudioTrackLike> })
            .audioTracks ?? instance.audioTracks;
        const activeIndex = instance.audioTrack;
        hlsAudioTrackList = rawTracks.map((track, index) => ({
          id: hlsAudioTrackId(track, index),
          label: textTrackLabel(track.name, track.lang),
          language: track.lang || null,
          active: index === activeIndex
        }));
        selectAudioTrackAvailability =
          hlsAudioTrackList.length > 0
            ? { status: 'available' }
            : { status: 'unavailable', reason: 'source' };
        emit({
          audioTracks: hlsAudioTrackList,
          ...capabilitiesPatch()
        });
      },
      onAudioTrackSwitching: (instance) => {
        const activeIndex = instance.audioTrack;
        hlsAudioTrackList = hlsAudioTrackList.map((track, index) => ({
          ...track,
          active: index === activeIndex
        }));
        emit({
          audioTracks: hlsAudioTrackList,
          ...capabilitiesPatch()
        });
      }
    }
  };
};
