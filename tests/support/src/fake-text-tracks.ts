// A stand-in for `TextTrack`/`TextTrackList`, shared by the native and HLS
// provider tests.
//
// It exists because happy-dom's real implementation is too limited to drive
// caption and chapter tests: `kind`/`label`/`language`/`id` have no public
// setters, there is no `default` flag, and `mode` rejects `'hidden'`. Tests
// attach the fake over a media element's `textTracks` getter, the same way
// existing tests override `duration`/`buffered`/`seekable`.
//
// Why it lives here (#314). Both provider packages carried their own copy.
// Diffing them found no behavioural difference at all: the two files differed
// only in comment wording, plus a native-only `mountNative`/`latest` pair that
// builds a video element around the fake and merges the patches it emits.
// Those two helpers are genuinely native-specific and stayed in
// packages/provider-native/test/fixtures/fake-text-tracks.ts — there was no
// deliberate difference in the fixture core that needed preserving as a
// parameter. The comment wording here is the union of the two copies.
//
// Two details are load-bearing and easy to lose when reading past them:
//
//   - `default` is only set when the init explicitly provides it, so tests can
//     produce a fake track that omits the property entirely (as real
//     `TextTrack` objects do) rather than defaulting it to `false`.
//
//   - `mode` is a real accessor (not a plain field) that calls `onModeChange`
//     when assigned — mirroring the DOM spec, where assigning `TextTrack.mode`
//     queues a `change` event on the owning `TextTrackList`. Tests that don't
//     care about that cascade can ignore the callback entirely.
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
