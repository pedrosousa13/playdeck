import type {
  Availability,
  CaptionRendering,
  CommandResult,
  ProviderStatePatch,
  TextCue,
  TextTrack,
  TextTrackKind
} from '@playdeck/core';
import { notifySafely, textTrackLabel } from '@playdeck/core';
import type {
  EmitProviderState,
  HlsInstanceLike,
  HlsParsedCueLike,
  HlsSubtitleTrackLike
} from './adapter-values.js';

const hlsSubtitleTrackId = (
  track: HlsSubtitleTrackLike,
  index: number
): string =>
  track.id !== undefined && track.id !== null
    ? `hls:${track.id}`
    : `hls:${index}`;

const hlsSubtitleTrackKind = (track: HlsSubtitleTrackLike): TextTrackKind =>
  track.type === 'CLOSED-CAPTIONS' ? 'captions' : 'subtitles';

const normalizeHlsCue = (cue: HlsParsedCueLike): TextCue => {
  const text = typeof cue.text === 'string' ? cue.text : '';
  return {
    id: cue.id ?? null,
    startTime: cue.startTime,
    endTime: cue.endTime,
    text: text.trim().length === 0 ? '' : text
  };
};

export type HlsTextTracksDeps = {
  readonly emit: EmitProviderState;
  readonly isDestroyed: () => boolean;
  // The live engine instance the held selection is pushed into; undefined
  // until the hls.js engine has started.
  readonly getInstance: () =>
    Pick<HlsInstanceLike, 'subtitleTrack'> | undefined;
  // The host's re-decorated capabilities, as a spreadable patch fragment —
  // empty until the first capabilities snapshot has been seen.
  readonly capabilitiesPatch: () => ProviderStatePatch;
};

// The hls.js tracks-and-captions seam: track discovery, selection, cue
// windowing and delivery, keyed to hls.js's own subtitleTracks/subtitleTrack
// surface instead of `<track>` elements. Mirrors
// packages/provider-native/src/text-tracks.ts's shape (held selection + "has
// the user explicitly chosen" flag so a later SUBTITLE_TRACKS_UPDATED can
// tell "keep the held id" apart from "apply the default-track rule"). The
// host wires `handlers` to the engine's events (guarding staleness itself)
// and to the media element's `timeupdate`.
export type HlsTextTracks = {
  readonly selectTextTrack: (id: string | null) => Promise<CommandResult>;
  readonly subscribeCues: (
    listener: (cues: readonly TextCue[]) => void
  ) => () => void;
  readonly setCaptionRenderer: () => void;
  // The `selectTextTrack` facet of the host's capabilities on the hls.js
  // engine.
  readonly selectTextTrackAvailability: () => Availability;
  // Returns the seam to its pre-engine state; called on retry.
  readonly reset: () => void;
  readonly destroy: () => void;
  readonly handlers: {
    // Settles the capability from the manifest, which is the only reading both
    // hls.js builds agree on. `buildSupportsSubtitles` comes from
    // `hlsBuildSupportsSubtitles`.
    readonly onManifestParsed: (
      data: unknown,
      buildSupportsSubtitles: boolean
    ) => void;
    readonly onSubtitleTracksUpdated: (
      instance: Pick<HlsInstanceLike, 'subtitleTracks'>,
      data: unknown
    ) => void;
    readonly onCuesParsed: (data: unknown) => void;
    readonly onTimeUpdate: () => void;
  };
};

export const createHlsTextTracks = (
  media: HTMLVideoElement,
  { emit, isDestroyed, getInstance, capabilitiesPatch }: HlsTextTracksDeps
): HlsTextTracks => {
  let selectTextTrackAvailability: Availability = {
    status: 'unknown',
    reason: 'provider-check'
  };
  let hlsTextTracks: TextTrack[] = [];
  let hlsSelectedTextTrackId: string | null = null;
  let hlsHasExplicitTextTrackSelection = false;
  // Cues parsed for the held selection (see `handlers.onCuesParsed` for why
  // no further per-track filtering is needed), windowed down to the
  // currently active ones on every `timeupdate`.
  let hlsParsedCues: TextCue[] = [];
  const hlsCueListeners = new Set<(cues: readonly TextCue[]) => void>();

  // Mirrors provider-native's `resolveSelection`: a held explicit selection
  // always overrides and persists as long as it still names an existing
  // track; otherwise the `default` track applies (native's `<track
  // default>` rule, here hls.js's `MediaPlaylist.default` flag); otherwise
  // no selection.
  const resolveHlsTextTrackSelection = (
    ids: ReadonlyArray<string>,
    defaultIndex: number
  ): string | null => {
    if (hlsHasExplicitTextTrackSelection) {
      return hlsSelectedTextTrackId !== null &&
        ids.includes(hlsSelectedTextTrackId)
        ? hlsSelectedTextTrackId
        : null;
    }
    return defaultIndex === -1 ? null : (ids[defaultIndex] ?? null);
  };

  // No 'native' branch: real browser-native rendering needs hls.js's
  // `renderTextTracksNatively`, which the engine start keeps off (see the
  // comment there), so there is no native surface to report. See
  // `setCaptionRenderer` below.
  const resolveHlsCaptionRendering = (): CaptionRendering =>
    hlsTextTracks.length === 0 ? 'unavailable' : 'custom';

  const emitHlsCues = (cues: readonly TextCue[]): void =>
    hlsCueListeners.forEach((listener) => notifySafely(listener, cues));

  // Windows the held cues down to the ones active at the media's current
  // time — mirrors what a native `TextTrack`'s `activeCues`/`cuechange`
  // would give us, computed by hand since `CUES_PARSED` delivers cues as
  // they are parsed (which can be well ahead of playback), not as they
  // become active. Driven by `timeupdate`, which the HTML spec fires at
  // roughly 4Hz — cue enter/exit precision is bounded by that cadence, an
  // accepted limitation for this hand-rolled windowing (a real `cuechange`
  // event would be exact).
  const recomputeActiveHlsCues = (): void => {
    const currentTime = media.currentTime;
    emitHlsCues(
      hlsParsedCues.filter(
        (cue) => currentTime >= cue.startTime && currentTime < cue.endTime
      )
    );
  };

  // Pushes the held selection down into the engine (`instance.subtitleTrack`,
  // `-1` for none) and clears the held cues — the previous selection's cues
  // no longer apply, and hls.js only fetches/parses fragments for the
  // subtitle track that is actually selected, so nothing will refill the
  // buffer until the new selection's own cues are parsed.
  const applyHlsTextTrackSelection = (): void => {
    const instance = getInstance();
    if (!instance) return;
    instance.subtitleTrack =
      hlsSelectedTextTrackId === null
        ? -1
        : hlsTextTracks.findIndex(
            (track) => track.id === hlsSelectedTextTrackId
          );
    hlsParsedCues = [];
    emitHlsCues([]);
  };

  return {
    selectTextTrack: async (id) => {
      if (isDestroyed() || !getInstance()) {
        return { ok: false, reason: 'not-ready' };
      }
      if (id !== null && !hlsTextTracks.some((track) => track.id === id)) {
        return { ok: false, reason: 'unsupported' };
      }
      hlsHasExplicitTextTrackSelection = true;
      hlsSelectedTextTrackId = id;
      applyHlsTextTrackSelection();
      emit({
        selectedTextTrackId: hlsSelectedTextTrackId,
        captionRendering: resolveHlsCaptionRendering()
      });
      return { ok: true };
    },
    subscribeCues: (listener) => {
      hlsCueListeners.add(listener);
      return () => hlsCueListeners.delete(listener);
    },
    // Real browser-native rendering needs `renderTextTracksNatively`, which
    // the engine start keeps off (see its comment), so there is no native
    // surface this engine can hand a 'native' request to. Honor the call
    // without pretending otherwise: cues keep flowing through
    // `subscribeCues` either way, and captionRendering keeps honestly
    // reporting 'custom'.
    setCaptionRenderer: () => {
      emit({ captionRendering: resolveHlsCaptionRendering() });
    },
    selectTextTrackAvailability: () => selectTextTrackAvailability,
    reset: () => {
      selectTextTrackAvailability = {
        status: 'unknown',
        reason: 'provider-check'
      };
      hlsTextTracks = [];
      hlsSelectedTextTrackId = null;
      hlsHasExplicitTextTrackSelection = false;
      hlsParsedCues = [];
      emitHlsCues([]);
    },
    destroy: () => {
      hlsCueListeners.clear();
    },
    handlers: {
      // `MANIFEST_PARSED` is where the capability stops being a guess, and it
      // is the one report both hls.js builds make: its payload carries the
      // subtitle renditions the manifest declared, parsed by machinery the
      // light build keeps.
      //
      // Before this, the capability was only ever written by
      // `onSubtitleTracksUpdated` below, and real hls.js does not fire that
      // event when a manifest declares no subtitle renditions at all -- so an
      // ordinary subtitle-less stream left `selectTextTrack` reading
      // `unknown` / `provider-check` for the whole session, still claiming to
      // be checking something it had already finished. The unit test covering
      // that branch fired `SUBTITLE_TRACKS_UPDATED` with an empty array by
      // hand, which is a thing the real library never does.
      //
      // Nothing is settled here when the manifest has subtitles and the build
      // can show them: `SUBTITLE_TRACKS_UPDATED` follows a few milliseconds
      // later with the tracks themselves, and it owns the `available` answer.
      // Staying `unknown` across that gap is honest, because the tracks really
      // have not been read yet.
      onManifestParsed: (data, buildSupportsSubtitles) => {
        const declared = (data as { subtitleTracks?: ReadonlyArray<unknown> })
          .subtitleTracks;
        // A payload carrying no `subtitleTracks` at all has taught us nothing,
        // which is not the same as one carrying an empty array -- that is the
        // manifest saying there are no subtitle renditions, and it is a fact.
        // The same distinction the Buffered window draws between "none" and
        // "not telling you", and the capability stays `unknown` for the second
        // rather than reporting a refusal it cannot support. Real hls.js always
        // sends the array, in both builds, so this guard is for a shape that
        // is not hls.js rather than for a case in the field.
        if (!Array.isArray(declared)) return;
        const hasSubtitleRenditions = declared.length > 0;
        if (hasSubtitleRenditions && buildSupportsSubtitles) return;
        selectTextTrackAvailability = hasSubtitleRenditions
          ? { status: 'unavailable', reason: 'provider-build' }
          : { status: 'unavailable', reason: 'source' };
        emit({ ...capabilitiesPatch() });
      },
      onSubtitleTracksUpdated: (instance, data) => {
        const rawTracks =
          (data as { subtitleTracks?: ReadonlyArray<HlsSubtitleTrackLike> })
            .subtitleTracks ?? instance.subtitleTracks;
        const ids = rawTracks.map((track, index) =>
          hlsSubtitleTrackId(track, index)
        );
        hlsTextTracks = rawTracks.map((track, index) => ({
          id: ids[index],
          label: textTrackLabel(track.name, track.lang),
          language: track.lang || null,
          kind: hlsSubtitleTrackKind(track),
          readiness: 'loaded'
        }));
        const defaultIndex = rawTracks.findIndex((track) => track.default);
        hlsSelectedTextTrackId = resolveHlsTextTrackSelection(
          ids,
          defaultIndex
        );
        // Mirrors the native engine's `hasSelectableTextTracks()` rule: the
        // capability is only 'available' once there is at least one track to
        // select among.
        selectTextTrackAvailability =
          hlsTextTracks.length > 0
            ? { status: 'available' }
            : { status: 'unavailable', reason: 'source' };
        applyHlsTextTrackSelection();
        emit({
          textTracks: hlsTextTracks,
          selectedTextTrackId: hlsSelectedTextTrackId,
          captionRendering: resolveHlsCaptionRendering(),
          ...capabilitiesPatch()
        });
      },
      // hls.js only downloads/parses subtitle fragments for the currently
      // selected `subtitleTrack`, so every cue that arrives while a selection
      // is held belongs to it — no need to correlate hls.js's internal
      // `data.track` label (an implementation-private "default"/"subtitlesN"
      // string, not a documented stable identifier) back to our own track
      // ids.
      onCuesParsed: (data) => {
        if (hlsSelectedTextTrackId === null) return;
        const parsedCues =
          (data as { cues?: ReadonlyArray<HlsParsedCueLike> }).cues ?? [];
        hlsParsedCues = [...hlsParsedCues, ...parsedCues.map(normalizeHlsCue)];
        recomputeActiveHlsCues();
      },
      onTimeUpdate: recomputeActiveHlsCues
    }
  };
};
