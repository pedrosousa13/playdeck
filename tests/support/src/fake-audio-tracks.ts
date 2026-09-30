// A stand-in for `AudioTrack`/`AudioTrackList`, shared by the native and HLS
// provider tests.
//
// It exists for the reason `fake-text-tracks.ts` does, and more so: neither
// happy-dom nor TypeScript's own `lib.dom.d.ts` carries any implementation of
// this surface at all -- `AudioTrackList`/`AudioTrack` never made it into the
// bundled DOM types the way `TextTrackList` did, even on engines that
// implement neither. Tests attach the fake over a media element's
// `audioTracks` getter, the same way `fake-text-tracks.ts` overrides
// `textTracks`.
export type FakeAudioTrackInit = {
  readonly label: string;
  readonly language: string | null;
  readonly id?: string;
  readonly enabled?: boolean;
};

export type FakeAudioTrack = {
  readonly id: string;
  readonly label: string;
  readonly language: string | null;
  enabled: boolean;
};

export type FakeAudioTrackList = FakeAudioTrack[] & {
  addEventListener: (type: string, listener: () => void) => void;
  removeEventListener: (type: string, listener: () => void) => void;
  dispatch: (type: string) => void;
};

export const createFakeAudioTrack = (
  init: FakeAudioTrackInit
): FakeAudioTrack => ({
  id: init.id ?? '',
  label: init.label,
  language: init.language,
  enabled: init.enabled ?? false
});

export const createFakeAudioTrackList = (
  tracks: readonly FakeAudioTrack[]
): FakeAudioTrackList => {
  const listeners = new Map<string, Set<() => void>>();
  const list = [...tracks] as FakeAudioTrackList;
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
