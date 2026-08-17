import type {
  Availability,
  CaptionRendering,
  CommandResult,
  PlayerCapabilities,
  ProviderStatePatch,
  TextCue,
  TextTrack,
  TextTrackKind
} from '@reely/core';
import { notifySafely, textTrackLabel } from '@reely/core';
import {
  asRecord,
  available,
  providerCheck,
  runVimeoCommand,
  type EmitProviderState,
  type IsStalePlayer
} from './adapter-values.js';
import type { VimeoSdkPlayer, VimeoSdkTextTrack } from './loader.js';

// `language` is Vimeo's stable per-track key, so it doubles as the id; the
// array index only disambiguates the rare case of two tracks sharing a
// language.
const vimeoTextTrackKind = (kind: string): TextTrackKind =>
  kind === 'captions' ? 'captions' : 'subtitles';

const vimeoTextTrackId = (
  track: VimeoSdkTextTrack,
  index: number,
  tracks: ReadonlyArray<VimeoSdkTextTrack>
): string =>
  tracks.filter((candidate) => candidate.language === track.language).length > 1
    ? `vimeo:${track.language}:${index}`
    : `vimeo:${track.language}`;

const resolveVimeoTextTrack = (
  id: string,
  tracks: ReadonlyArray<VimeoSdkTextTrack>
): VimeoSdkTextTrack | undefined =>
  tracks.find(
    (candidate, index) => vimeoTextTrackId(candidate, index, tracks) === id
  );

const toCoreTextTracks = (
  tracks: ReadonlyArray<VimeoSdkTextTrack>
): TextTrack[] =>
  tracks.map((track, index) => ({
    id: vimeoTextTrackId(track, index, tracks),
    label: textTrackLabel(track.label, track.language),
    language: track.language || null,
    kind: vimeoTextTrackKind(track.kind),
    readiness: 'loaded'
  }));

const showingVimeoTextTrackId = (
  tracks: ReadonlyArray<VimeoSdkTextTrack>
): string | null => {
  const index = tracks.findIndex((track) => track.mode === 'showing');
  return index === -1 ? null : vimeoTextTrackId(tracks[index]!, index, tracks);
};

const vimeoTextTrackCandidates = (
  language: string,
  kind: string,
  tracks: ReadonlyArray<VimeoSdkTextTrack>
): Array<{ id: string; mode: string }> =>
  language === ''
    ? []
    : tracks
        .filter(
          (track) =>
            track.language === language && (kind === '' || track.kind === kind)
        )
        .map((track) => ({
          id: vimeoTextTrackId(track, tracks.indexOf(track), tracks),
          mode: track.mode
        }));

// `texttrackchange` carries language and kind, never an id or an index, so two
// tracks sharing both (a plain and a forced-narrative English subtitle track,
// say) are indistinguishable from the payload alone (#57). Two things break
// the tie, in order of authority:
//   1. the SDK's own `mode`, which marks the track actually showing. It is the
//      only signal that reflects a change made inside Vimeo's CC menu, so it
//      outranks anything we remember — an earlier draft checked our own id
//      first and, because that id is sticky, never consulted mode again once
//      Reely had selected either sibling;
//   2. the id we last enabled ourselves, when it is one of the candidates —
//      the fallback for an SDK build that does not mark the pair distinctly.
// If neither applies the first candidate wins, as before.
const resolveActiveVimeoTextTrackId = (
  language: string,
  kind: string,
  tracks: ReadonlyArray<VimeoSdkTextTrack>,
  preferredId: string | null
): string | null => {
  const candidates = vimeoTextTrackCandidates(language, kind, tracks);
  if (candidates.length === 0) return null;
  const showing = candidates.find((candidate) => candidate.mode === 'showing');
  if (showing) return showing.id;
  if (
    preferredId !== null &&
    candidates.some((candidate) => candidate.id === preferredId)
  ) {
    return preferredId;
  }
  return candidates[0]!.id;
};

// Vimeo can either draw the cues itself or hand them over as `cuechange`
// payloads, so the renderer mode picks the owner: 'custom' means we enabled
// the track with `showing: false` and draw it in Reely's overlay, 'native'
// means Vimeo's in-iframe renderer draws it -- which is what 'provider'
// reports, and the fallback for anything the overlay cannot render.
const vimeoCaptionRendering = (
  tracks: ReadonlyArray<VimeoSdkTextTrack>,
  renderer: 'custom' | 'native'
): CaptionRendering =>
  tracks.length === 0
    ? 'unavailable'
    : renderer === 'custom'
      ? 'custom'
      : 'provider';

// Vimeo's cue payload is markup, not plain text: WebVTT tags survive in the
// `text` property (their own docs' example contains `<i>`), lines are joined
// with U+21B5 instead of a newline, and WebVTT requires `&`/`<`/`>` in cue
// text to arrive escaped. `TextCue.text` is plain text with real newlines, so
// this is a parse rather than a passthrough -- handing `text` straight through
// would render literal tags in the overlay.
// Exactly the six escapes the WebVTT cue-text grammar defines, and no more:
// anything else (`&quot;`, numeric references) is not required to be escaped in
// cue text, so passing it through matches what the other providers do with the
// same file rather than inventing a Vimeo-only decode.
const decodeCueEntities = (text: string): string =>
  text
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    // A no-break space, not a plain one: captions use `&nbsp;` precisely to
    // stop the overlay breaking a line there.
    .replace(/&nbsp;/g, '\u00a0')
    // Bidi marks — the whole reason they are escapable is that right-to-left
    // subtitles need them, so leaving them literal breaks exactly the tracks
    // that use them.
    .replace(/&lrm;/g, '\u200e')
    .replace(/&rlm;/g, '\u200f')
    // `&amp;` last, so an escaped entity like `&amp;lt;` survives as `&lt;`
    // instead of being decoded twice into `<`.
    .replace(/&amp;/g, '&');

const vimeoCueText = (text: string): string =>
  decodeCueEntities(text.replace(/↵/g, '\n').replace(/<[^>]*>/g, ''));

// The slice of the player this seam drives: track discovery and the two
// enable/disable calls, nothing else.
export type VimeoTextTrackPlayer = Pick<
  VimeoSdkPlayer,
  'getTextTracks' | 'enableTextTrack' | 'disableTextTrack'
>;

export type VimeoTextTracksDeps = {
  readonly emit: EmitProviderState;
  readonly isStale: IsStalePlayer;
  readonly getPlayer: () => VimeoTextTrackPlayer | undefined;
  // Vimeo's cue payload carries no timings at all, so the playhead is the only
  // honest thing to report for a cue's bounds.
  readonly getCurrentTime: () => number;
  // The host's capabilities snapshot, which folds this seam's own availability
  // in with the others'.
  readonly getCapabilities: () => PlayerCapabilities;
};

// The tracks-and-captions seam: the discovered tracklist, the held selection,
// the renderer mode that decides whether Vimeo or Reely's overlay draws the
// cues, and the cue pipeline that feeds the overlay when it is Reely's turn.
export type VimeoTextTracks = {
  readonly selectTextTrack: (id: string | null) => Promise<CommandResult>;
  readonly subscribeCues: (
    listener: (cues: readonly TextCue[]) => void
  ) => () => void;
  readonly setCaptionRenderer: (mode: 'custom' | 'native') => void;
  // Adopts the tracklist read at attach and re-enables whatever Vimeo arrived
  // showing, returning the patch fragment the attachment seam folds into its
  // ready state.
  readonly adopt: (
    player: VimeoTextTrackPlayer,
    tracks: ReadonlyArray<VimeoSdkTextTrack>
  ) => ProviderStatePatch;
  readonly handlers: {
    readonly onCueChange: (data?: unknown) => void;
    readonly onTextTrackChange: (
      player: VimeoTextTrackPlayer,
      data?: unknown
    ) => void;
  };
  // Drops the cues and the memory of what was enabled; called on teardown.
  readonly reset: () => void;
  // Drops the cue subscribers; called on destroy.
  readonly clearCueListeners: () => void;
  // The `selectTextTrack` facet of the host's capabilities.
  readonly selectTextTrackAvailability: () => Availability;
};

export const createVimeoTextTracks = ({
  emit,
  isStale,
  getPlayer,
  getCurrentTime,
  getCapabilities
}: VimeoTextTracksDeps): VimeoTextTracks => {
  const cueListeners = new Set<(cues: readonly TextCue[]) => void>();
  let textTracks: ReadonlyArray<VimeoSdkTextTrack> = [];
  let selectedTextTrackId: string | null = null;
  let selectTextTrackAvailability: Availability = providerCheck;
  let captionRenderer: 'custom' | 'native' = 'custom';
  let activeCues: readonly TextCue[] = [];
  // The track this adapter last asked Vimeo to enable. Vimeo's own UI can
  // change the active track too, and only this tells the two apart.
  let lastEnabledTrackId: string | null = null;

  const emitCues = (cues: readonly TextCue[]): void => {
    activeCues = cues;
    cueListeners.forEach((listener) => notifySafely(listener, cues));
  };

  const clearCues = (): void => {
    if (activeCues.length === 0) return;
    emitCues([]);
  };

  // `showing: false` is what makes Vimeo hand the cues over instead of drawing
  // them, so every enable has to carry the current renderer mode.
  //
  // The id is recorded synchronously, before the SDK call settles, because two
  // things read it: the `texttrackchange` reconcile (to tell a change Vimeo's
  // own UI made apart from the echo of our own enable) and `setCaptionRenderer`
  // (which would otherwise see a selection that has not been written yet).
  const enableWithRenderer = (
    player: VimeoTextTrackPlayer,
    track: VimeoSdkTextTrack,
    id: string
  ): Promise<unknown> => {
    lastEnabledTrackId = id;
    return player.enableTextTrack(
      track.language,
      track.kind,
      captionRenderer === 'native'
    );
  };

  // A track change Vimeo made itself (its in-iframe CC menu) arrives enabled
  // `showing: true`, so Vimeo is drawing it -- while `cuechange` fires
  // regardless of `showing`, which would leave the overlay drawing it too.
  // Re-enabling under the current renderer puts ownership back where the
  // renderer mode says it belongs. Our own enables echo back through here as
  // well, and `lastEnabledTrackId` is what tells the two apart.
  const reconcileActiveTrack = (
    player: VimeoTextTrackPlayer,
    tracks: ReadonlyArray<VimeoSdkTextTrack>
  ): void => {
    // Cues stop arriving for the track being left, so anything already
    // emitted would stay painted: the old language's line lingering over the
    // new one, or over nothing at all once captions are off.
    if (selectedTextTrackId === null) {
      clearCues();
      lastEnabledTrackId = null;
      return;
    }
    if (selectedTextTrackId === lastEnabledTrackId) return;
    clearCues();
    const track = resolveVimeoTextTrack(selectedTextTrackId, tracks);
    if (!track) return;
    void Promise.resolve(
      enableWithRenderer(player, track, selectedTextTrackId)
    ).catch(() => undefined);
  };

  const adoptAvailability = (
    tracks: ReadonlyArray<VimeoSdkTextTrack>
  ): void => {
    selectTextTrackAvailability =
      tracks.length > 0
        ? available
        : { status: 'unavailable', reason: 'source' };
  };

  return {
    selectTextTrack: (id) => {
      if (id === null) {
        return runVimeoCommand(getPlayer(), (player) =>
          player.disableTextTrack()
        ).then((result) => {
          if (result.ok) {
            selectedTextTrackId = null;
            lastEnabledTrackId = null;
            clearCues();
            emit({ selectedTextTrackId: null });
          }
          return result;
        });
      }
      const match = resolveVimeoTextTrack(id, textTracks);
      if (!match) return Promise.resolve({ ok: false, reason: 'unsupported' });
      return runVimeoCommand(getPlayer(), (player) =>
        enableWithRenderer(player, match, id)
      ).then((result) => {
        if (result.ok) {
          selectedTextTrackId = id;
          // Cues stop arriving for the track being left, so the previous
          // language's line would stay painted until the new one delivers.
          // Same reason the Vimeo-UI path clears; the menu is the path most
          // viewers actually take.
          clearCues();
          emit({ selectedTextTrackId: id });
          return result;
        }
        // The enable never took effect, so the optimistic id has to roll back
        // -- otherwise a renderer flip hands Vimeo the track that failed.
        lastEnabledTrackId = selectedTextTrackId;
        return result;
      });
    },
    subscribeCues: (listener) => {
      cueListeners.add(listener);
      return () => cueListeners.delete(listener);
    },
    setCaptionRenderer: (mode) => {
      if (mode === captionRenderer) return;
      captionRenderer = mode;
      // Vimeo decides whether to draw the cues at enable time, so the active
      // track has to be re-enabled for a mode flip to take effect. Prefer the
      // id we last asked Vimeo to enable over `selectedTextTrackId`: a flip in
      // the same tick as a `selectTextTrack` would otherwise read a selection
      // that has not been written back yet, and re-enable the wrong track (or
      // none, leaving neither Vimeo nor the overlay drawing).
      const player = getPlayer();
      const activeId = lastEnabledTrackId ?? selectedTextTrackId;
      if (player && activeId !== null) {
        const active = resolveVimeoTextTrack(activeId, textTracks);
        if (active) {
          void Promise.resolve(
            enableWithRenderer(player, active, activeId)
          ).catch(() => undefined);
        }
      }
      if (captionRenderer === 'native') clearCues();
      emit({
        captionRendering: vimeoCaptionRendering(textTracks, captionRenderer)
      });
    },
    adopt: (player, tracks) => {
      textTracks = tracks;
      selectedTextTrackId = showingVimeoTextTrackId(tracks);
      // Vimeo can arrive with a track already showing -- a viewer's stored
      // preference, or `texttrack=` on the embed URL. Discovery only reads it,
      // so re-enable it under the current renderer: otherwise Vimeo keeps
      // drawing a track the overlay is also about to draw.
      if (selectedTextTrackId !== null) {
        const showing = resolveVimeoTextTrack(selectedTextTrackId, tracks);
        if (showing) {
          void Promise.resolve(
            enableWithRenderer(player, showing, selectedTextTrackId)
          ).catch(() => undefined);
        }
      }
      adoptAvailability(tracks);
      return {
        textTracks: toCoreTextTracks(textTracks),
        selectedTextTrackId,
        captionRendering: vimeoCaptionRendering(textTracks, captionRenderer)
      };
    },
    handlers: {
      onCueChange: (data) => {
        const rawCues = asRecord(data).cues;
        if (!Array.isArray(rawCues)) return;
        // Vimeo's payload carries no cue timings at all, so the position the
        // cue became active at is the only honest thing to report for both
        // bounds.
        const position = getCurrentTime();
        emitCues(
          rawCues.flatMap((raw): TextCue[] => {
            const text = asRecord(raw).text;
            if (typeof text !== 'string') return [];
            const normalized = vimeoCueText(text);
            if (normalized.trim() === '') return [];
            return [
              {
                id: null,
                startTime: position,
                endTime: position,
                text: normalized
              }
            ];
          })
        );
      },
      onTextTrackChange: (player, data) => {
        // Fires whenever the active track changes, including through Vimeo's
        // own in-iframe UI, so this keeps our selection state honest with it.
        const record = asRecord(data);
        const language =
          typeof record.language === 'string' ? record.language : '';
        const kind = typeof record.kind === 'string' ? record.kind : '';
        // ANY ambiguity has to go the slow way. The modes we hold are stale by
        // definition once the change came from Vimeo's own UI, and mode is the
        // only signal that can break the tie then. Skipping the refresh when our
        // own last-enabled id happens to be among the candidates looks like a
        // cheap win and is not: that id is sticky, so it would suppress the
        // refresh forever after the first selection — measured, that resolves
        // the wrong sibling AND skips the ownership reconcile, leaving Vimeo and
        // the overlay both drawing (#57).
        const candidates = vimeoTextTrackCandidates(language, kind, textTracks);
        if (candidates.length === 1 || language === '') {
          selectedTextTrackId = resolveActiveVimeoTextTrackId(
            language,
            kind,
            textTracks,
            lastEnabledTrackId
          );
          reconcileActiveTrack(player, textTracks);
          emit({ selectedTextTrackId });
          return;
        }
        // The reported track isn't part of the last known set -- refresh it
        // from the SDK before resolving the selection.
        void player.getTextTracks().then(
          (freshTracks) => {
            if (isStale(player)) return;
            textTracks = freshTracks;
            adoptAvailability(freshTracks);
            selectedTextTrackId = resolveActiveVimeoTextTrackId(
              language,
              kind,
              freshTracks,
              lastEnabledTrackId
            );
            reconcileActiveTrack(player, freshTracks);
            emit({
              textTracks: toCoreTextTracks(freshTracks),
              selectedTextTrackId,
              captionRendering: vimeoCaptionRendering(
                freshTracks,
                captionRenderer
              ),
              capabilities: getCapabilities()
            });
          },
          () => undefined
        );
      }
    },
    reset: () => {
      // Cues belong to the player being discarded; a retry must not inherit
      // them. Neither must the memory of what was enabled: the fresh player has
      // nothing enabled, so a stale id would both re-enable a track the state
      // reports as unselected and swallow a real Vimeo-UI change as our own
      // echo.
      clearCues();
      lastEnabledTrackId = null;
    },
    clearCueListeners: () => cueListeners.clear(),
    selectTextTrackAvailability: () => selectTextTrackAvailability
  };
};
