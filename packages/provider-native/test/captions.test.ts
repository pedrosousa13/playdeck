// @vitest-environment happy-dom

import { expect, test } from 'vitest';
import { createNativeProvider } from '../src/index';

// happy-dom's real TextTrack/TextTrackList implementation is too limited to
// drive this test: `kind`/`label`/`language`/`id` have no public setters,
// there is no `default` flag, and `mode` rejects `'hidden'`. We fabricate a
// minimal stand-in that shapes the properties the adapter actually reads and
// attach it over the media element's `textTracks` getter, the same way
// existing tests in index.test.ts override `duration`/`buffered`/`seekable`.
type FakeTrackInit = {
  readonly kind: string;
  readonly label: string;
  readonly language: string | null;
  readonly id?: string;
  readonly default?: boolean;
  readonly hasCues?: boolean;
};

type FakeTrack = {
  kind: string;
  label: string;
  language: string | null;
  id: string;
  default: boolean;
  mode: string;
  cues: { length: number } | null;
  addEventListener: () => void;
  removeEventListener: () => void;
};

type FakeTrackList = FakeTrack[] & {
  addEventListener: (type: string, listener: () => void) => void;
  removeEventListener: (type: string, listener: () => void) => void;
  dispatch: (type: string) => void;
};

const createFakeTrack = (init: FakeTrackInit): FakeTrack => ({
  kind: init.kind,
  label: init.label,
  language: init.language,
  id: init.id ?? '',
  default: init.default ?? false,
  mode: 'disabled',
  cues: init.hasCues ? { length: 1 } : null,
  addEventListener: () => undefined,
  removeEventListener: () => undefined
});

const createFakeTrackList = (tracks: readonly FakeTrack[]): FakeTrackList => {
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

const mountNative = (trackInits: readonly FakeTrackInit[]) => {
  const media = document.createElement('video');
  const tracks = trackInits.map(createFakeTrack);
  const trackList = createFakeTrackList(tracks);
  Object.defineProperty(media, 'textTracks', {
    configurable: true,
    value: trackList
  });
  const provider = createNativeProvider(media);
  const patches: Array<Record<string, unknown>> = [];
  provider.subscribe((patch) => patches.push(patch as Record<string, unknown>));
  return { media, provider, patches, tracks, trackList };
};

const latest = (
  patches: ReadonlyArray<Record<string, unknown>>
): Record<string, unknown> =>
  patches.reduce<Record<string, unknown>>(
    (merged, patch) => ({ ...merged, ...patch }),
    {}
  );

test('discovers external tracks and normalizes them', async () => {
  const { provider, patches } = mountNative([
    {
      kind: 'captions',
      label: 'English',
      language: 'en',
      id: 't1',
      default: true,
      hasCues: true
    },
    { kind: 'metadata', label: 'chapters', language: null, id: 'm1' }
  ]);

  await provider.attach();

  const last = latest(patches);
  expect(last.textTracks).toEqual([
    {
      id: 't1',
      label: 'English',
      language: 'en',
      kind: 'captions',
      readiness: 'loaded'
    }
  ]);
  expect(last.selectedTextTrackId).toBe('t1');
  expect(last.captionRendering).toBe('custom');
  expect(
    (last.capabilities as { selectTextTrack: { status: string } })
      .selectTextTrack.status
  ).toBe('available');
});

test('excludes non-caption kinds and leaves their mode untouched', async () => {
  const { provider, patches, tracks } = mountNative([
    { kind: 'subtitles', label: 'Spanish', language: 'es', id: 's1' },
    { kind: 'chapters', label: 'chapters', language: null, id: 'c1' },
    { kind: 'descriptions', label: 'descriptions', language: null, id: 'd1' }
  ]);

  await provider.attach();

  const last = latest(patches);
  expect(last.textTracks).toEqual([
    {
      id: 's1',
      label: 'Spanish',
      language: 'es',
      kind: 'subtitles',
      readiness: 'loading'
    }
  ]);
  expect(tracks[0]?.mode).toBe('hidden');
  expect(tracks[1]?.mode).toBe('disabled');
  expect(tracks[2]?.mode).toBe('disabled');
});

test('falls back to a native:<index> id when the track has no id', async () => {
  const { provider, patches } = mountNative([
    { kind: 'metadata', label: 'chapters', language: null },
    { kind: 'captions', label: 'English', language: 'en' }
  ]);

  await provider.attach();

  const last = latest(patches);
  expect(last.textTracks).toEqual([
    {
      id: 'native:1',
      label: 'English',
      language: 'en',
      kind: 'captions',
      readiness: 'loading'
    }
  ]);
});

test('normalizes an empty language to null and reports no default selection', async () => {
  const { provider, patches } = mountNative([
    { kind: 'captions', label: 'English', language: '', id: 't1' }
  ]);

  await provider.attach();

  const last = latest(patches);
  expect(last.textTracks).toEqual([
    {
      id: 't1',
      label: 'English',
      language: null,
      kind: 'captions',
      readiness: 'loading'
    }
  ]);
  expect(last.selectedTextTrackId).toBeNull();
});

test('reports unavailable text-track selection and no tracks when none are discovered', async () => {
  const { provider, patches } = mountNative([]);

  await provider.attach();

  const last = latest(patches);
  expect(last.textTracks).toEqual([]);
  expect(last.selectedTextTrackId).toBeNull();
  expect(last.captionRendering).toBe('custom');
  expect(
    (
      last.capabilities as {
        selectTextTrack: { status: string; reason?: string };
      }
    ).selectTextTrack
  ).toEqual({ status: 'unavailable', reason: 'provider' });
});

test('re-discovers tracks when the native track list changes after attach', async () => {
  const { provider, patches, trackList } = mountNative([]);
  await provider.attach();
  patches.length = 0;

  trackList.push(
    createFakeTrack({
      kind: 'captions',
      label: 'English',
      language: 'en',
      id: 't1'
    })
  );
  trackList.dispatch('addtrack');

  const last = latest(patches);
  expect(last.textTracks).toEqual([
    {
      id: 't1',
      label: 'English',
      language: 'en',
      kind: 'captions',
      readiness: 'loading'
    }
  ]);
  expect(
    (last.capabilities as { selectTextTrack: { status: string } })
      .selectTextTrack.status
  ).toBe('available');
});

test('stops re-discovering tracks after destroy', async () => {
  const { provider, patches, trackList } = mountNative([]);
  await provider.attach();
  await provider.destroy();
  patches.length = 0;

  trackList.push(
    createFakeTrack({
      kind: 'captions',
      label: 'English',
      language: 'en',
      id: 't1'
    })
  );
  trackList.dispatch('addtrack');

  expect(patches).toEqual([]);
});
