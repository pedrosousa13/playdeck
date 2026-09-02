// A stand-in for `TextTrack`/`TextTrackList`, shared by the native and HLS
// provider tests.
//
// It exists because happy-dom's real implementation is too limited to drive
// caption and chapter tests: `kind`/`label`/`language`/`id` have no public
// setters, there is no `default` flag, and `mode` rejects `'hidden'`. Tests
// attach the fake over a media element's `textTracks` getter, the same way
// existing tests override `duration`/`buffered`/`seekable`.
//
// It lives in its own package so that the native and HLS tests share one
// definition, and so that neither provider has to reach into the other's test
// tree to get it.
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
    // Set only when the init provides it, so a fake track can omit the
    // property entirely the way a real `TextTrack` does, rather than carrying
    // a defaulted `false` no caller asked for.
    ...(init.default !== undefined ? { default: init.default } : {}),
    // A real accessor rather than a plain field: assigning `TextTrack.mode`
    // queues a `change` event on the owning `TextTrackList` in the DOM spec,
    // and `onModeChange` is how that cascade reaches the fake list. A test
    // that does not exercise the cascade can leave the callback off.
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
