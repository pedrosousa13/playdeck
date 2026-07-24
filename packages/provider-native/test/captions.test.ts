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
  default?: boolean;
  mode: string;
  cues: { length: number } | null;
  activeCues: readonly unknown[] | null;
  addEventListener: (type: string, listener: () => void) => void;
  removeEventListener: (type: string, listener: () => void) => void;
  dispatch: (type: string) => void;
};

type FakeTrackList = FakeTrack[] & {
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
const createFakeTrack = (
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
  // s1 has no `default` flag and nothing has been explicitly selected, so it
  // is not the held selection — mode now reflects actual selection state
  // (`disabled`) rather than the old blanket `hidden` applied to every
  // caption/subtitle entry regardless of selection.
  expect(tracks[0]?.mode).toBe('disabled');
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
  expect(last.captionRendering).toBe('unavailable');
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

// `default` is an HTMLTrackElement IDL attribute per spec, not exposed on the
// associated TextTrack — real browsers never put it on the track object. This
// appends a real <track default> element (the DOM signal the fix must read)
// while the corresponding fake TextTrack entry carries no `default` property
// at all, proving discovery reads the flag from the <track> element rather
// than the (spec-inaccurate) track object.
test('reads the default flag from a real <track> element rather than the TextTrack object', async () => {
  const { media, provider, patches } = mountNative([
    { kind: 'captions', label: 'English', language: 'en', id: 't1' }
  ]);

  const trackElement = document.createElement('track');
  trackElement.setAttribute('kind', 'captions');
  trackElement.id = 't1';
  trackElement.default = true;
  media.appendChild(trackElement);

  await provider.attach();

  const last = latest(patches);
  expect(last.selectedTextTrackId).toBe('t1');
});

test('selectTextTrack(id) hides the chosen track, disables the rest, and emits the selection', async () => {
  const { provider, patches, tracks } = mountNative([
    { kind: 'captions', label: 'English', language: 'en', id: 't1' },
    { kind: 'subtitles', label: 'Spanish', language: 'es', id: 't2' }
  ]);
  await provider.attach();
  patches.length = 0;

  const result = await provider.selectTextTrack?.('t2');

  expect(result).toEqual({ ok: true });
  expect(tracks[0]?.mode).toBe('disabled');
  expect(tracks[1]?.mode).toBe('hidden');
  expect(latest(patches).selectedTextTrackId).toBe('t2');
});

test('selectTextTrack(null) disables all caption tracks and clears the cue channel', async () => {
  const { provider, patches, tracks } = mountNative([
    { kind: 'captions', label: 'English', language: 'en', id: 't1' }
  ]);
  await provider.attach();
  await provider.selectTextTrack?.('t1');
  patches.length = 0;
  const cueFrames: Array<readonly unknown[]> = [];
  provider.subscribeCues?.((cues) => cueFrames.push(cues));

  const result = await provider.selectTextTrack?.(null);

  expect(result).toEqual({ ok: true });
  expect(tracks[0]?.mode).toBe('disabled');
  expect(latest(patches).selectedTextTrackId).toBeNull();
  expect(cueFrames).toEqual([[]]);
});

test('subscribeCues receives a normalized TextCue when the selected track fires cuechange', async () => {
  const { provider, tracks } = mountNative([
    { kind: 'captions', label: 'English', language: 'en', id: 't1' }
  ]);
  await provider.attach();
  await provider.selectTextTrack?.('t1');
  const cueFrames: Array<readonly unknown[]> = [];
  provider.subscribeCues?.((cues) => cueFrames.push(cues));
  // Extra property proves the mapper builds a plain object instead of
  // forwarding the VTTCue-like reference itself.
  const fakeCue = {
    id: 'cue-1',
    startTime: 1,
    endTime: 2,
    text: 'Hello',
    extra: 'leak-check'
  };
  const track = tracks[0];
  if (track) track.activeCues = [fakeCue];
  track?.dispatch('cuechange');

  expect(cueFrames).toEqual([
    [{ id: 'cue-1', startTime: 1, endTime: 2, text: 'Hello' }]
  ]);
  expect(cueFrames[0]?.[0]).not.toBe(fakeCue);
});

test('cuechange clearing active cues emits an empty array', async () => {
  const { provider, tracks } = mountNative([
    { kind: 'captions', label: 'English', language: 'en', id: 't1' }
  ]);
  await provider.attach();
  await provider.selectTextTrack?.('t1');
  const track = tracks[0];
  if (track)
    track.activeCues = [
      { id: 'cue-1', startTime: 1, endTime: 2, text: 'Hello' }
    ];
  track?.dispatch('cuechange');
  const cueFrames: Array<readonly unknown[]> = [];
  provider.subscribeCues?.((cues) => cueFrames.push(cues));

  if (track) track.activeCues = [];
  track?.dispatch('cuechange');

  expect(cueFrames).toEqual([[]]);
});

test('keeps an explicit selection across a re-discovery triggered by a change event', async () => {
  const { provider, patches, trackList } = mountNative([
    { kind: 'captions', label: 'English', language: 'en', id: 't1' },
    { kind: 'subtitles', label: 'Spanish', language: 'es', id: 't2' }
  ]);
  await provider.attach();
  await provider.selectTextTrack?.('t2');
  patches.length = 0;

  // Simulates an unrelated `change` event on the TextTrackList (e.g. one
  // queued by the engine itself) rather than one caused by our own writes.
  trackList.dispatch('change');

  expect(latest(patches).selectedTextTrackId).toBe('t2');
});

test('selectTextTrack settles on the chosen id even when assigning mode self-triggers a change cascade', async () => {
  const { provider, patches, tracks } = mountNative([
    { kind: 'captions', label: 'English', language: 'en', id: 't1' },
    { kind: 'subtitles', label: 'Spanish', language: 'es', id: 't2' }
  ]);
  await provider.attach();
  patches.length = 0;

  const result = await provider.selectTextTrack?.('t2');

  expect(result).toEqual({ ok: true });
  expect(tracks[0]?.mode).toBe('disabled');
  expect(tracks[1]?.mode).toBe('hidden');
  expect(latest(patches).selectedTextTrackId).toBe('t2');
});

test('removing the currently-selected track clears the selection and the cue channel', async () => {
  const { provider, patches, trackList } = mountNative([
    { kind: 'captions', label: 'English', language: 'en', id: 't1' },
    { kind: 'subtitles', label: 'Spanish', language: 'es', id: 't2' }
  ]);
  await provider.attach();
  await provider.selectTextTrack?.('t2');
  const cueFrames: Array<readonly unknown[]> = [];
  provider.subscribeCues?.((cues) => cueFrames.push(cues));
  patches.length = 0;

  trackList.pop();
  trackList.dispatch('removetrack');

  expect(latest(patches).selectedTextTrackId).toBeNull();
  expect(cueFrames).toEqual([[]]);
});

test('setCaptionRenderer toggles the selected track between hidden and showing and updates captionRendering', async () => {
  const { provider, patches, tracks } = mountNative([
    {
      kind: 'captions',
      label: 'English',
      language: 'en',
      id: 't1',
      default: true
    }
  ]);
  await provider.attach();
  patches.length = 0;

  provider.setCaptionRenderer?.('native');

  expect(tracks[0]?.mode).toBe('showing');
  expect(latest(patches).captionRendering).toBe('native');

  provider.setCaptionRenderer?.('custom');

  expect(tracks[0]?.mode).toBe('hidden');
  expect(latest(patches).captionRendering).toBe('custom');
});

test('load() resets caption state and re-honors the new source default on rediscovery', async () => {
  const { provider, patches, trackList } = mountNative([
    {
      kind: 'captions',
      label: 'English',
      language: 'en',
      id: 't1',
      default: true
    },
    { kind: 'subtitles', label: 'Spanish', language: 'es', id: 't2' }
  ]);
  await provider.attach();
  // Explicitly select the non-default track, so the reset below is
  // observably distinct from a fresh discovery: if `hasExplicitSelection`
  // survived the reset, resolving selection against the new source's tracks
  // would try to keep 't2' (not found -> null) instead of honoring the new
  // default.
  await provider.selectTextTrack?.('t2');
  const cueFrames: Array<readonly unknown[]> = [];
  provider.subscribeCues?.((cues) => cueFrames.push(cues));
  patches.length = 0;

  await provider.load();

  expect(latest(patches).textTracks).toEqual([]);
  expect(latest(patches).selectedTextTrackId).toBeNull();
  expect(cueFrames).toEqual([[]]);

  // Simulate the new source's tracks arriving, with a different default.
  trackList.length = 0;
  trackList.push(
    createFakeTrack({
      kind: 'captions',
      label: 'French',
      language: 'fr',
      id: 't3',
      default: true
    })
  );
  trackList.dispatch('addtrack');

  expect(latest(patches).selectedTextTrackId).toBe('t3');
});

test('cuechange with an empty, whitespace-only, or missing cue text normalizes to an empty string without throwing', async () => {
  const { provider, tracks } = mountNative([
    { kind: 'captions', label: 'English', language: 'en', id: 't1' }
  ]);
  await provider.attach();
  await provider.selectTextTrack?.('t1');
  const cueFrames: Array<readonly unknown[]> = [];
  provider.subscribeCues?.((cues) => cueFrames.push(cues));
  const track = tracks[0];

  expect(() => {
    if (track)
      track.activeCues = [
        { id: 'cue-empty', startTime: 0, endTime: 1, text: '' },
        { id: 'cue-whitespace', startTime: 1, endTime: 2, text: '   ' },
        { id: 'cue-missing', startTime: 2, endTime: 3 }
      ];
    track?.dispatch('cuechange');
  }).not.toThrow();

  expect(cueFrames).toEqual([
    [
      { id: 'cue-empty', startTime: 0, endTime: 1, text: '' },
      { id: 'cue-whitespace', startTime: 1, endTime: 2, text: '' },
      { id: 'cue-missing', startTime: 2, endTime: 3, text: '' }
    ]
  ]);
});
