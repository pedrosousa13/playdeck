import type {
  Availability,
  CommandResult,
  PlayerCapabilities
} from '@reely/core';
import {
  available,
  findYouTubeTextTrackId,
  resolveYouTubeTextTrack,
  runYouTubeCommand,
  sourceUnavailable,
  toCoreTextTracks,
  youtubeCaptionRendering,
  type EmitProviderState,
  type YouTubeCaptionTrack
} from './adapter-values.js';
import type { YouTubePlayer } from './loader.js';

// The slice of the player this seam drives: the unofficial "captions" module's
// option accessors, nothing else.
export type YouTubeCaptionPlayer = Pick<
  YouTubePlayer,
  'getOption' | 'setOption'
>;

export type YouTubeTextTracksDeps = {
  readonly emit: EmitProviderState;
  // The player once it is ready to take commands; undefined before onReady,
  // after a teardown, and after destroy.
  readonly getReadyPlayer: () => YouTubeCaptionPlayer | undefined;
  // The host's ready capabilities snapshot, which folds this seam's own
  // availability in with the presentation seam's.
  readonly getCapabilities: () => PlayerCapabilities;
};

// The tracks-and-captions seam: discovery of the captions module's tracklist,
// the held selection, and the `selectTextTrack` command. YouTube renders the
// cues itself inside the iframe, so there is no cue pipeline here — only the
// normalized track list and which of them is on.
export type YouTubeTextTracks = {
  // Reads the captions module's tracklist and current track, then publishes
  // both. Driven by the player's onApiChange.
  readonly discover: () => void;
  readonly selectTextTrack: (id: string | null) => Promise<CommandResult>;
  // The `selectTextTrack` facet of the host's capabilities.
  readonly selectTextTrackAvailability: () => Availability;
  // Forgets the discovered tracks; called when the player is torn down.
  readonly reset: () => void;
};

export const createYouTubeTextTracks = ({
  emit,
  getReadyPlayer,
  getCapabilities
}: YouTubeTextTracksDeps): YouTubeTextTracks => {
  let textTracks: readonly YouTubeCaptionTrack[] = [];
  let selectedTextTrackId: string | null = null;

  return {
    // The captions module is undocumented: onApiChange is the community-known
    // signal that it (and its tracklist) has become available. Unverified
    // against a real player (see issue #11).
    discover: () => {
      const current = getReadyPlayer();
      if (!current) return;
      let rawTracklist: unknown;
      try {
        rawTracklist = current.getOption('captions', 'tracklist');
      } catch {
        rawTracklist = undefined;
      }
      textTracks = Array.isArray(rawTracklist)
        ? (rawTracklist as YouTubeCaptionTrack[])
        : [];
      let rawTrack: unknown;
      try {
        rawTrack = current.getOption('captions', 'track');
      } catch {
        rawTrack = undefined;
      }
      const languageCode =
        rawTrack !== null &&
        typeof rawTrack === 'object' &&
        'languageCode' in rawTrack
          ? (rawTrack as { languageCode?: unknown }).languageCode
          : undefined;
      selectedTextTrackId =
        typeof languageCode === 'string' && languageCode
          ? findYouTubeTextTrackId(languageCode, textTracks)
          : null;
      emit({
        textTracks: toCoreTextTracks(textTracks),
        selectedTextTrackId,
        captionRendering: youtubeCaptionRendering(textTracks),
        capabilities: getCapabilities()
      });
    },
    selectTextTrack: (id) => {
      if (id === null) {
        return runYouTubeCommand(getReadyPlayer(), (current) => {
          // Community convention for turning captions off; unverified
          // against a real player (see issue #11).
          current.setOption('captions', 'track', {});
          selectedTextTrackId = null;
          emit({ selectedTextTrackId: null });
        });
      }
      const match = resolveYouTubeTextTrack(id, textTracks);
      if (!match) return Promise.resolve({ ok: false, reason: 'unsupported' });
      return runYouTubeCommand(getReadyPlayer(), (current) => {
        current.setOption('captions', 'track', {
          languageCode: match.languageCode
        });
        // Intent model, consistent with the rest of this provider: emit the
        // requested track immediately rather than waiting on a confirming
        // event the unofficial API does not reliably provide.
        selectedTextTrackId = id;
        emit({ selectedTextTrackId: id });
      });
    },
    selectTextTrackAvailability: () =>
      textTracks.length > 0 ? available : sourceUnavailable,
    reset: () => {
      textTracks = [];
      selectedTextTrackId = null;
    }
  };
};
