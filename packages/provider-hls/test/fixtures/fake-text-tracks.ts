// happy-dom's real TextTrack/TextTrackList implementation is too limited to
// drive caption tests: `kind`/`label`/`language`/`id` have no public setters,
// there is no `default` flag, and `mode` rejects `'hidden'`. This fabricates a
// minimal stand-in shaping the properties the native caption subsystem
// actually reads, mirroring the fixture used by
// packages/provider-native/test/captions.test.ts.
export type FakeTrackInit = {
  readonly kind: string;
  readonly label: string;
  readonly language: string | null;
  readonly id?: string;
  readonly default?: boolean;
  readonly hasCues?: boolean;
};

export type FakeTrack = {
  kind: string;
  label: string;
  language: string | null;
  id: string;
  default?: boolean;
  mode: string;
  cues: { length: number } | null;
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
    ...(init.default !== undefined ? { default: init.default } : {}),
    get mode() {
      return mode;
    },
    set mode(value: string) {
      mode = value;
      onModeChange?.();
    },
    cues: init.hasCues ? { length: 1 } : null,
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
