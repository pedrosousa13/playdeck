import type {
  Availability,
  CommandResult,
  PlayerCapabilities,
  TextTrack
} from '@playdeck/core';
import { textTrackLabel } from '@playdeck/core';
import {
  available,
  runYouTubeCommand,
  type EmitProviderState
} from './adapter-values.js';
import type { YouTubePlayer } from './loader.js';

// A video without caption tracks is a property of the source, not of the
// provider — every provider reports the empty-track case the same way.
const sourceUnavailable: Availability = {
  status: 'unavailable',
  reason: 'source'
};

// YouTube renders captions inside its own iframe (captionRendering:
// 'provider'), so this adapter only normalizes track discovery and
// selection -- no cue overlay. Shape and field names follow the
// community-documented (unofficial) "captions" module; unverified against a
// real player (see issue #11).
type YouTubeCaptionTrack = {
  readonly languageCode: string;
  readonly displayName?: string;
  readonly languageName?: string;
  readonly vssId?: string;
  readonly kind?: string;
};

const youtubeTextTrackId = (
  track: YouTubeCaptionTrack,
  index: number,
  tracks: readonly YouTubeCaptionTrack[]
): string =>
  tracks.filter((candidate) => candidate.languageCode === track.languageCode)
    .length > 1
    ? `youtube:${track.languageCode}:${index}`
    : `youtube:${track.languageCode}`;

const resolveYouTubeTextTrack = (
  id: string,
  tracks: readonly YouTubeCaptionTrack[]
): YouTubeCaptionTrack | undefined =>
  tracks.find(
    (candidate, index) => youtubeTextTrackId(candidate, index, tracks) === id
  );

const findYouTubeTextTrackId = (
  languageCode: string,
  tracks: readonly YouTubeCaptionTrack[]
): string | null => {
  const index = tracks.findIndex(
    (track) => track.languageCode === languageCode
  );
  return index === -1
    ? null
    : youtubeTextTrackId(tracks[index]!, index, tracks);
};

const toCoreTextTracks = (
  tracks: readonly YouTubeCaptionTrack[]
): TextTrack[] =>
  tracks.map((track, index) => ({
    id: youtubeTextTrackId(track, index, tracks),
    label: textTrackLabel(
      track.displayName || track.languageName,
      track.languageCode
    ),
    language: track.languageCode,
    kind: 'captions',
    readiness: 'loaded'
  }));

const youtubeCaptionRendering = (
  tracks: readonly YouTubeCaptionTrack[]
): 'provider' | 'unavailable' =>
  tracks.length > 0 ? 'provider' : 'unavailable';

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
