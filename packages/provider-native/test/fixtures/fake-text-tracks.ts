import { createNativeProvider } from '../../src/index';

// happy-dom's real TextTrack/TextTrackList implementation is too limited to
// drive these tests: `kind`/`label`/`language`/`id` have no public setters,
// there is no `default` flag, and `mode` rejects `'hidden'`. We fabricate a
// minimal stand-in that shapes the properties the adapter actually reads and
// attach it over the media element's `textTracks` getter, the same way
// existing tests in index.test.ts override `duration`/`buffered`/`seekable`.
export type FakeTrackInit = {
  readonly kind: string;
  readonly label: string;
  readonly language: string | null;
  readonly id?: string;
  readonly default?: boolean;
  // The cues the track arrives with. A track whose WebVTT has not been fetched
  // yet has none at all, which is `null` — the state a `disabled` track never
  // leaves.
  readonly cues?: readonly unknown[] | null;
};

export type FakeTrack = {
  kind: string;
  label: string;
  language: string | null;
  id: string;
  default?: boolean;
  mode: string;
  cues: readonly unknown[] | null;
  activeCues: readonly unknown[] | null;
  addEventListener: (type: string, listener: () => void) => void;
  removeEventListener: (type: string, listener: () => void) => void;
  dispatch: (type: string) => void;
};

export type FakeTrackList = FakeTrack[] & {
  addEventListener: (type: string, listener: () => void) => void;
  removeEventListener: (type: string, listener: () => void) => void;
  dispatch: (type: string) => void;
};

// `default` is only set when the init explicitly provides it, so tests can
// produce a fake track that omits the property entirely (as real `TextTrack`
// objects do) rather than defaulting it to `false`.
//
// `mode` is a real accessor (not a plain field) that calls `onModeChange`
// when assigned — mirroring the DOM spec, where assigning `TextTrack.mode`
// queues a `change` event on the owning `TextTrackList`. Tests that don't
// care about that cascade can ignore the callback entirely.
export const createFakeTrack = (
  init: FakeTrackInit,
  onModeChange?: () => void
): FakeTrack => {
  const listeners = new Map<string, Set<() => void>>();
  let mode = 'disabled';
  return {
    kind: init.kind,
    label: init.label,
    language: init.language,
    id: init.id ?? '',
    ...(init.default !== undefined ? { default: init.default } : {}),
    get mode() {
      return mode;
    },
    set mode(value: string) {
      mode = value;
      onModeChange?.();
    },
    cues: init.cues ?? null,
    activeCues: null,
    addEventListener: (type, listener) => {
      const set = listeners.get(type) ?? new Set<() => void>();
      set.add(listener);
      listeners.set(type, set);
    },
    removeEventListener: (type, listener) => {
      listeners.get(type)?.delete(listener);
    },
    dispatch: (type) => {
      listeners.get(type)?.forEach((listener) => listener());
    }
  };
};

export const createFakeTrackList = (
  tracks: readonly FakeTrack[]
): FakeTrackList => {
  const listeners = new Map<string, Set<() => void>>();
  const list = [...tracks] as FakeTrackList;
  list.addEventListener = (type, listener) => {
    const set = listeners.get(type) ?? new Set<() => void>();
    set.add(listener);
    listeners.set(type, set);
  };
  list.removeEventListener = (type, listener) => {
    listeners.get(type)?.delete(listener);
  };
  list.dispatch = (type) => {
    listeners.get(type)?.forEach((listener) => listener());
  };
  return list;
};

export const mountNative = (trackInits: readonly FakeTrackInit[]) => {
  const media = document.createElement('video');
  const trackList = createFakeTrackList([]);
  const tracks = trackInits.map((init) =>
    createFakeTrack(init, () => trackList.dispatch('change'))
  );
  trackList.push(...tracks);
  Object.defineProperty(media, 'textTracks', {
    configurable: true,
    value: trackList
  });
  const provider = createNativeProvider(media);
  const patches: Array<Record<string, unknown>> = [];
  provider.subscribe((patch) => patches.push(patch as Record<string, unknown>));
  return { media, provider, patches, tracks, trackList };
};

export const latest = (
  patches: ReadonlyArray<Record<string, unknown>>
): Record<string, unknown> =>
  patches.reduce<Record<string, unknown>>(
    (merged, patch) => ({ ...merged, ...patch }),
    {}
  );
