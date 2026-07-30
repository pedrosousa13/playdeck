import type {
  Availability,
  CaptionRendering,
  CommandResult,
  PlayerCapabilities,
  ProviderStatePatch,
  TextCue,
  TextTrack,
  TextTrackKind,
  TextTrackReadiness
} from '@reely/core';
import { textTrackLabel } from '@reely/core';
import { available } from './adapter-values.js';

// The `default` IDL attribute lives on HTMLTrackElement per spec, but engines
// commonly surface it on the associated TextTrack too; treat it as optional.
type NativeTextTrack = globalThis.TextTrack & { readonly default?: boolean };

// `text` is a VTTCue-specific member absent from the base TextTrackCue
// interface that `TextTrack.activeCues` is typed with.
type NativeTextTrackCue = globalThis.TextTrackCue & { readonly text: string };

export type NativeTextTracks = {
  readonly selectTextTrack: (id: string | null) => Promise<CommandResult>;
  readonly subscribeCues: (
    listener: (cues: readonly TextCue[]) => void
  ) => () => void;
  readonly setCaptionRenderer: (mode: 'custom' | 'native') => void;
  // Initial discovery — call once after attach.
  readonly discover: () => void;
  readonly attachListeners: () => void;
  readonly destroy: () => void;
  // The `selectTextTrack` facet of the host's capabilities: available only
  // while the current source exposes at least one caption/subtitle track.
  readonly selectTextTrackAvailability: () => Availability;
};

const isCaptionTrackKind = (kind: string): kind is TextTrackKind =>
  kind === 'captions' || kind === 'subtitles';

const nativeTextTrackId = (track: NativeTextTrack, index: number): string =>
  track.id || `native:${index}`;

const nativeTextTrackReadiness = (
  track: NativeTextTrack
): TextTrackReadiness =>
  track.cues && track.cues.length > 0 ? 'loaded' : 'loading';

// Builds the caption/subtitle subsystem that layers on top of an
// `HTMLMediaElement`'s native `textTracks`: discovery, selection, renderer
// mode, and cue delivery. `emit` publishes provider-state patches (textTracks,
// selectedTextTrackId, captionRendering) and `getCapabilities` recomputes the
// host's full `PlayerCapabilities` snapshot for patches that need it, since
// caption availability is only one facet of the host's overall capabilities.
export const createNativeTextTracks = (
  media: HTMLMediaElement,
  emit: (patch: ProviderStatePatch) => void,
  getCapabilities: () => PlayerCapabilities
): NativeTextTracks => {
  let hasSelectableTextTracks = false;
  let textTrackList: globalThis.TextTrackList | undefined;
  let cueChangeTrack: NativeTextTrack | undefined;
  // Holds the current caption selection — the single source of truth for
  // `selectedTextTrackId`. `hasExplicitSelection` distinguishes "never
  // selected yet" (discovery may still apply the `<track default>` rule)
  // from "explicitly selected `null`" (user turned captions off; discovery
  // must not resurrect the default). Per spec, user selection always
  // overrides and persists until source switch.
  let selectedTextTrackId: string | null = null;
  let hasExplicitSelection = false;
  // 'custom' (default): the selected track is `hidden` and cues are drawn by
  // the consumer via `subscribeCues`. 'native': the selected track is
  // `showing` and the browser draws its own caption UI.
  let captionRendererMode: 'custom' | 'native' = 'custom';
  // Suppresses re-entrant discovery while we assign `track.mode` ourselves.
  // Per spec, assigning `TextTrack.mode` queues a `change` event on the
  // TextTrackList, so our own mode writes would otherwise self-trigger
  // `discoverTextTracks` and reset selection state mid-write.
  let suppressDiscovery = false;
  const cueListeners = new Set<(cues: readonly TextCue[]) => void>();

  const captionTrackEntries = (): Array<{
    track: NativeTextTrack;
    index: number;
  }> => {
    const nativeTracks = media.textTracks;
    const entries: Array<{ track: NativeTextTrack; index: number }> = [];
    for (let index = 0; index < nativeTracks.length; index += 1) {
      const track = nativeTracks[index] as NativeTextTrack | undefined;
      if (track && isCaptionTrackKind(track.kind))
        entries.push({ track, index });
    }
    return entries;
  };

  // `default` is an HTMLTrackElement IDL attribute per spec — it is not
  // exposed on the associated TextTrack, so real `<track default>` markup
  // must be read from the DOM element, not the track object. Matches by
  // object identity first (holds in spec-conformant engines), falling back
  // to id equality for engines/environments where `HTMLTrackElement.track`
  // does not return a stable reference.
  const defaultCaptionTrackEntry = (
    entries: Array<{ track: NativeTextTrack; index: number }>
  ): { track: NativeTextTrack; index: number } | undefined => {
    const trackElements = media.querySelectorAll('track');
    for (let index = 0; index < trackElements.length; index += 1) {
      const element = trackElements[index];
      if (!element.default) continue;
      const elementTrack = element.track;
      const match =
        entries.find(({ track }) => track === elementTrack) ??
        (element.id
          ? entries.find(({ track }) => track.id === element.id)
          : undefined);
      if (match) return match;
    }
    return undefined;
  };

  // Derives the `captionRendering` patch value from the current renderer
  // mode, the selected track, and whether any caption/subtitle tracks exist
  // at all: no tracks is always `unavailable`; a native renderer with a
  // selection is `native` (the browser is drawing); everything else falls
  // back to `custom` (our `subscribeCues` pipeline is the one drawing, even
  // if nothing is currently selected to draw).
  const resolveCaptionRendering = (
    entries: Array<{ track: NativeTextTrack; index: number }>,
    selected: string | null
  ): CaptionRendering => {
    if (entries.length === 0) return 'unavailable';
    return captionRendererMode === 'native' && selected !== null
      ? 'native'
      : 'custom';
  };

  // Reapplies every caption/subtitle track's mode from the given selection
  // (the selected track is `hidden` in custom-renderer mode so cues are
  // processed without native rendering — that pipeline is custom, via
  // subscribeCues — or `showing` in native-renderer mode so the browser
  // draws it; everything else is `disabled`) and refreshes the cuechange
  // listener to match. Mode writes are wrapped so a self-triggered `change`
  // event (assigning `.mode` queues one per spec) cannot re-enter discovery
  // mid-write.
  const applySelection = (
    entries: Array<{ track: NativeTextTrack; index: number }>,
    selected: string | null
  ): void => {
    suppressDiscovery = true;
    try {
      entries.forEach(({ track, index }) => {
        track.mode =
          nativeTextTrackId(track, index) === selected
            ? captionRendererMode === 'native'
              ? 'showing'
              : 'hidden'
            : 'disabled';
      });
    } finally {
      suppressDiscovery = false;
    }
    const matchEntry =
      selected === null
        ? undefined
        : entries.find(
            ({ track, index }) => nativeTextTrackId(track, index) === selected
          );
    if (matchEntry) {
      attachCueChangeTrack(matchEntry.track);
    } else if (cueChangeTrack) {
      detachCueChangeTrack();
      emitCues([]);
    }
  };

  // Selection precedence on (re-)discovery: keep the held selection if it
  // still names an existing caption/subtitle track — user selection always
  // overrides and persists; otherwise, if nothing has been explicitly
  // selected yet, fall back to the `<track default>` rule; otherwise (the
  // selected track was removed) selection resets to null.
  const resolveSelection = (
    entries: Array<{ track: NativeTextTrack; index: number }>
  ): string | null => {
    if (hasExplicitSelection) {
      const stillExists = entries.some(
        ({ track, index }) =>
          nativeTextTrackId(track, index) === selectedTextTrackId
      );
      return stillExists ? selectedTextTrackId : null;
    }
    const defaultEntry =
      defaultCaptionTrackEntry(entries) ??
      entries.find(({ track }) => track.default === true);
    return defaultEntry
      ? nativeTextTrackId(defaultEntry.track, defaultEntry.index)
      : null;
  };

  const discoverTextTracks = (): void => {
    const entries = captionTrackEntries();
    hasSelectableTextTracks = entries.length > 0;
    const textTracks: TextTrack[] = entries.map(({ track, index }) => ({
      id: nativeTextTrackId(track, index),
      label: textTrackLabel(track.label, track.language),
      language: track.language || null,
      kind: track.kind as TextTrackKind,
      readiness: nativeTextTrackReadiness(track)
    }));
    selectedTextTrackId = resolveSelection(entries);
    applySelection(entries, selectedTextTrackId);
    emit({
      textTracks,
      selectedTextTrackId,
      captionRendering: resolveCaptionRendering(entries, selectedTextTrackId),
      capabilities: getCapabilities()
    });
  };

  const onTextTracksChange = (): void => {
    if (suppressDiscovery) return;
    discoverTextTracks();
  };

  const emitCues = (cues: readonly TextCue[]): void =>
    cueListeners.forEach((listener) => listener(cues));

  // Normalizes a cue's text so downstream overlay rendering never has to
  // guard against a missing, empty, or whitespace-only value: all three
  // collapse to `''` rather than throwing or leaking `undefined`.
  const cueText = (cue: NativeTextTrackCue): string => {
    const text = typeof cue.text === 'string' ? cue.text : '';
    return text.trim().length === 0 ? '' : text;
  };

  // Builds plain TextCue objects so no VTTCue reference escapes the adapter.
  const activeTextCues = (track: NativeTextTrack): TextCue[] => {
    const activeCues = track.activeCues;
    if (!activeCues) return [];
    return Array.from({ length: activeCues.length }, (_, index) => {
      const cue = activeCues[index] as NativeTextTrackCue;
      return {
        id: cue.id,
        startTime: cue.startTime,
        endTime: cue.endTime,
        text: cueText(cue)
      };
    });
  };

  const onCueChange = (): void => {
    if (!cueChangeTrack) return;
    emitCues(activeTextCues(cueChangeTrack));
  };

  const detachCueChangeTrack = (): void => {
    cueChangeTrack?.removeEventListener('cuechange', onCueChange);
    cueChangeTrack = undefined;
  };

  const attachCueChangeTrack = (track: NativeTextTrack): void => {
    detachCueChangeTrack();
    cueChangeTrack = track;
    track.addEventListener('cuechange', onCueChange);
  };

  return {
    selectTextTrack: async (id) => {
      const entries = captionTrackEntries();
      if (
        id !== null &&
        !entries.some(
          ({ track, index }) => nativeTextTrackId(track, index) === id
        )
      ) {
        return { ok: false, reason: 'unsupported' };
      }
      hasExplicitSelection = true;
      selectedTextTrackId = id;
      applySelection(entries, selectedTextTrackId);
      emit({
        selectedTextTrackId,
        captionRendering: resolveCaptionRendering(entries, selectedTextTrackId)
      });
      return { ok: true };
    },
    subscribeCues: (listener) => {
      cueListeners.add(listener);
      return () => cueListeners.delete(listener);
    },
    setCaptionRenderer: (mode) => {
      captionRendererMode = mode;
      const entries = captionTrackEntries();
      applySelection(entries, selectedTextTrackId);
      emit({
        captionRendering: resolveCaptionRendering(entries, selectedTextTrackId)
      });
    },
    discover: () => discoverTextTracks(),
    attachListeners: () => {
      textTrackList = media.textTracks;
      textTrackList.addEventListener('addtrack', onTextTracksChange);
      textTrackList.addEventListener('removetrack', onTextTracksChange);
      textTrackList.addEventListener('change', onTextTracksChange);
    },
    destroy: () => {
      textTrackList?.removeEventListener('addtrack', onTextTracksChange);
      textTrackList?.removeEventListener('removetrack', onTextTracksChange);
      textTrackList?.removeEventListener('change', onTextTracksChange);
      textTrackList = undefined;
      detachCueChangeTrack();
      cueListeners.clear();
    },
    selectTextTrackAvailability: () =>
      hasSelectableTextTracks
        ? available
        : { status: 'unavailable', reason: 'source' }
  };
};
