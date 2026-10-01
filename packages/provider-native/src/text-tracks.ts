import type {
  Availability,
  CaptionRendering,
  Chapter,
  ChapterInput,
  CommandResult,
  PlayerCapabilities,
  ProviderStatePatch,
  TextCue,
  TextTrack,
  TextTrackKind,
  TextTrackReadiness
} from '@playdeck/core';
import {
  chaptersEqual,
  deriveChapters,
  notifySafely,
  plainCueText,
  textTrackLabel
} from '@playdeck/core';
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
  // The `chapters` facet of the host's capabilities. A media element can always
  // report chapters, so this never says `provider`: it says `source` until cues
  // are actually in hand, and `available` once they are.
  readonly chaptersAvailability: () => Availability;
};

const isCaptionTrackKind = (kind: string): kind is TextTrackKind =>
  kind === 'captions' || kind === 'subtitles';

// Deliberately not folded into `isCaptionTrackKind`, and `TextTrackKind` is
// deliberately not widened to admit it: nothing downstream of the published
// track collection filters on kind, so a chapters track allowed into it would
// reach the captions menu, the captions toggle and the cue overlay. Chapters
// get their own collection instead (#182).
const isChapterTrackKind = (kind: string): boolean => kind === 'chapters';

// No chapters to report — the state a source stays in until cues are in hand.
// Deliberately not `unknown`/`provider-check` while a chapters track is present
// but empty: nothing would ever resolve that verdict. A WebVTT that 404s fires
// only `error`, an in-band chapters track has no `<track>` element to fire
// `load` at all, and a track that parses to zero cues fires no `cuechange` — so
// a consumer gating a chapter list on it would wait forever.
const noChapterSource: Availability = {
  status: 'unavailable',
  reason: 'source'
};

const nativeTextTrackId = (track: NativeTextTrack, index: number): string =>
  track.id || `native:${index}`;

// `observedReadiness` holds what `syncCaptionTrackListeners`'s `load`/`error`
// listeners have seen for each track's `<track>` element, alongside the
// `src` the element reported at the moment the event fired: readiness
// follows those events rather than reading `HTMLTrackElement.readyState`,
// since every engine fires `load`/`error` on the element and a unit test can
// drive both directly. An observed value wins over the cue-count snapshot
// below while its `src` still matches `currentSrc` -- a track that fired
// `load` with zero cues (an empty WebVTT) has still finished loading, not
// stalled in `loading`. Once the element's `src` is reassigned, though, the
// override is stale: the `TextTrack` is unchanged (same object, so
// `syncCaptionTrackListeners` binds no new listener for it), but the
// verdict it recorded belongs to a resource that is no longer the one
// loading, and the snapshot is read again until the new resource's own
// `load`/`error` arrives.
const nativeTextTrackReadiness = (
  track: NativeTextTrack,
  observedReadiness: ReadonlyMap<
    NativeTextTrack,
    { readonly value: TextTrackReadiness; readonly src: string }
  >,
  currentSrc: string | undefined
): TextTrackReadiness => {
  const observed = observedReadiness.get(track);
  if (observed && observed.src === currentSrc) return observed.value;
  return track.cues && track.cues.length > 0 ? 'loaded' : 'loading';
};

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
  // The chapters slice: the published collection, the track it was read off,
  // the `<track>` element behind that track when the source has one, and the
  // capability facet the three of them decide.
  let chapters: readonly Chapter[] = Object.freeze([]);
  let chapterTrack: NativeTextTrack | undefined;
  let chapterTrackElement: HTMLTrackElement | undefined;
  let chapterAvailability: Availability = noChapterSource;
  const cueListeners = new Set<(cues: readonly TextCue[]) => void>();
  // What each caption/subtitle track's `<track>` element has reported via
  // `load`/`error` (and the `src` it reported it for, so a later `src`
  // reassignment on the same element can be told apart from the one the
  // verdict belongs to — see `nativeTextTrackReadiness`), and the listener
  // pair currently bound to that element — both keyed by the `TextTrack`
  // object so `syncCaptionTrackListeners` can diff a discovery pass against
  // the previous one and detach exactly what a departed track or element
  // added.
  const captionReadinessOverrides = new Map<
    NativeTextTrack,
    { readonly value: TextTrackReadiness; readonly src: string }
  >();
  const captionTrackListeners = new Map<
    NativeTextTrack,
    { element: HTMLTrackElement; onLoad: () => void; onError: () => void }
  >();

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

  const chapterTrackEntry = (): NativeTextTrack | undefined => {
    const nativeTracks = media.textTracks;
    for (let index = 0; index < nativeTracks.length; index += 1) {
      const track = nativeTracks[index] as NativeTextTrack | undefined;
      if (track && isChapterTrackKind(track.kind)) return track;
    }
    return undefined;
  };

  // The `<track>` element behind a text track (chapters or caption/subtitle),
  // matched the way `defaultCaptionTrackEntry` matches one: by object
  // identity first, falling back to id equality. Absent for an in-band
  // chapters track, which is why the element's `load` event cannot be the
  // only read trigger for chapters.
  const trackElementFor = (
    track: NativeTextTrack
  ): HTMLTrackElement | undefined => {
    const elements = media.querySelectorAll('track');
    for (let index = 0; index < elements.length; index += 1) {
      const element = elements[index];
      if (!element) continue;
      if (element.track === track) return element;
      if (element.id && element.id === track.id) return element;
    }
    return undefined;
  };

  const chapterCueInputs = (track: NativeTextTrack): ChapterInput[] => {
    const cues = track.cues;
    if (!cues) return [];
    return Array.from({ length: cues.length }, (_, index) => {
      const cue = cues[index] as NativeTextTrackCue;
      return {
        id: cue.id || `chapters:${index}`,
        title: cueText(cue),
        startTime: cue.startTime
      };
    });
  };

  // Recomputes the published collection and its capability from whatever the
  // chapters track currently holds, and reports whether either moved — so a
  // duration report or a cue event that changes nothing publishes nothing.
  const syncChapters = (): boolean => {
    const nextChapters = chapterTrack
      ? deriveChapters(chapterCueInputs(chapterTrack), media.duration)
      : Object.freeze([]);
    const nextAvailability =
      nextChapters.length > 0 ? available : noChapterSource;
    const moved =
      !chaptersEqual(chapters, nextChapters) ||
      chapterAvailability !== nextAvailability;
    chapters = nextChapters;
    chapterAvailability = nextAvailability;
    return moved;
  };

  const onChapterUpdate = (): void => {
    if (!syncChapters()) return;
    emit({ chapters, capabilities: getCapabilities() });
  };

  const detachChapterTrack = (): void => {
    chapterTrack?.removeEventListener('cuechange', onChapterUpdate);
    chapterTrackElement?.removeEventListener('load', onChapterUpdate);
    chapterTrack = undefined;
    chapterTrackElement = undefined;
  };

  // Points the chapters slice at the source's chapters track, and moves that
  // track off `disabled`. This is the whole reason chapters need a mode write
  // at all: a track's cues are not obtained while its mode is `disabled` — the
  // WebVTT file is not even requested — and `disabled` is the default for any
  // track without the `default` attribute, so a chapters track left alone would
  // sit empty for the whole session. `hidden` is what populates the cues
  // without drawing anything; `showing` would ask the browser to render them.
  //
  // The cues are read on the track's `cuechange` and the `<track>` element's
  // `load` instead of here, because at this point there are none to read: the
  // fetch the mode write starts has not finished. The read below covers the
  // other case only — a re-discovery of a track whose cues are already in
  // place.
  const syncChapterTrack = (): void => {
    const track = chapterTrackEntry();
    if (track !== chapterTrack) {
      detachChapterTrack();
      if (track) {
        chapterTrack = track;
        track.addEventListener('cuechange', onChapterUpdate);
        chapterTrackElement = trackElementFor(track);
        chapterTrackElement?.addEventListener('load', onChapterUpdate);
      }
    }
    if (!chapterTrack || chapterTrack.mode === 'hidden') return;
    // Wrapped in the same guard the caption mode writes use: assigning
    // `TextTrack.mode` queues a `change` event on the TextTrackList, which
    // would otherwise re-enter discovery mid-write.
    suppressDiscovery = true;
    try {
      chapterTrack.mode = 'hidden';
    } finally {
      suppressDiscovery = false;
    }
  };

  const buildTextTracks = (
    entries: Array<{ track: NativeTextTrack; index: number }>
  ): TextTrack[] =>
    entries.map(({ track, index }) => ({
      id: nativeTextTrackId(track, index),
      label: textTrackLabel(track.label, track.language),
      language: track.language || null,
      kind: track.kind as TextTrackKind,
      readiness: nativeTextTrackReadiness(
        track,
        captionReadinessOverrides,
        captionTrackListeners.get(track)?.element.src
      )
    }));

  // Keeps each caption/subtitle track's `<track>`-element `load`/`error`
  // listeners in step with the current track set, diffed against the
  // previous pass: a track no longer discovered, or whose element changed,
  // has its old listeners removed (and its observed readiness forgotten)
  // before a new pair is bound for whatever is there now.
  const syncCaptionTrackListeners = (
    entries: Array<{ track: NativeTextTrack; index: number }>
  ): void => {
    const currentTracks = new Set(entries.map(({ track }) => track));
    captionTrackListeners.forEach((listener, track) => {
      if (currentTracks.has(track)) return;
      listener.element.removeEventListener('load', listener.onLoad);
      listener.element.removeEventListener('error', listener.onError);
      captionTrackListeners.delete(track);
      captionReadinessOverrides.delete(track);
    });
    entries.forEach(({ track }) => {
      const element = trackElementFor(track);
      const existing = captionTrackListeners.get(track);
      if (existing && existing.element === element) return;
      if (existing) {
        existing.element.removeEventListener('load', existing.onLoad);
        existing.element.removeEventListener('error', existing.onError);
        captionTrackListeners.delete(track);
      }
      if (!element) return;
      const onLoad = (): void =>
        setCaptionReadiness(track, 'loaded', element.src);
      const onError = (): void =>
        setCaptionReadiness(track, 'error', element.src);
      element.addEventListener('load', onLoad);
      element.addEventListener('error', onError);
      captionTrackListeners.set(track, { element, onLoad, onError });
    });
  };

  // Republishes the track collection when an element's `load`/`error`
  // changes what it reports for readiness — and only then, so a redundant
  // event (or one confirming the cue-count snapshot's existing verdict)
  // emits nothing. `previous` is read before the new override is recorded,
  // through the same staleness check `nativeTextTrackReadiness` applies on
  // every other read: passing this event's own `src` as `currentSrc` means
  // a prior override from a since-reassigned `src` is already treated as
  // gone, so a track settling on the same verdict for a *new* resource
  // still counts as a change from whatever the stale override, or the
  // cue-count snapshot, was reading a moment ago.
  const setCaptionReadiness = (
    track: NativeTextTrack,
    value: TextTrackReadiness,
    src: string
  ): void => {
    const previous = nativeTextTrackReadiness(
      track,
      captionReadinessOverrides,
      src
    );
    captionReadinessOverrides.set(track, { value, src });
    if (previous === value) return;
    emit({ textTracks: buildTextTracks(captionTrackEntries()) });
  };

  const discoverTextTracks = (): void => {
    const entries = captionTrackEntries();
    hasSelectableTextTracks = entries.length > 0;
    syncCaptionTrackListeners(entries);
    const textTracks = buildTextTracks(entries);
    selectedTextTrackId = resolveSelection(entries);
    applySelection(entries, selectedTextTrackId);
    syncChapterTrack();
    syncChapters();
    emit({
      textTracks,
      chapters,
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
    cueListeners.forEach((listener) => notifySafely(listener, cues));

  // Normalizes a cue's text so downstream overlay rendering never has to
  // guard against a missing, empty, or whitespace-only value: all three
  // collapse to `''` rather than throwing or leaking `undefined`. The engine
  // hands `VTTCue.text` through with its WebVTT tags and entities intact, so
  // `plainCueText` (`@playdeck/core`) turns it into the plain text
  // `TextCue.text`'s own doc comment promises before this returns.
  const cueText = (cue: NativeTextTrackCue): string => {
    const text = typeof cue.text === 'string' ? plainCueText(cue.text) : '';
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
      // The last chapter ends where the media does, and the duration is often
      // not known when the chapter cues arrive — a `<track>` load can beat
      // `loadedmetadata`. Without this the last chapter would stay open for the
      // whole session on a source whose duration is perfectly well known.
      media.addEventListener('durationchange', onChapterUpdate);
    },
    destroy: () => {
      textTrackList?.removeEventListener('addtrack', onTextTracksChange);
      textTrackList?.removeEventListener('removetrack', onTextTracksChange);
      textTrackList?.removeEventListener('change', onTextTracksChange);
      textTrackList = undefined;
      media.removeEventListener('durationchange', onChapterUpdate);
      detachCueChangeTrack();
      detachChapterTrack();
      cueListeners.clear();
      captionTrackListeners.forEach((listener) => {
        listener.element.removeEventListener('load', listener.onLoad);
        listener.element.removeEventListener('error', listener.onError);
      });
      captionTrackListeners.clear();
      captionReadinessOverrides.clear();
    },
    selectTextTrackAvailability: () =>
      hasSelectableTextTracks
        ? available
        : { status: 'unavailable', reason: 'source' },
    chaptersAvailability: () => chapterAvailability
  };
};
