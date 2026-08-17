// @vitest-environment happy-dom

import { expect, test } from 'vitest';
import { PlayerController } from '@reely/core';
import {
  createFakeTrack,
  latest,
  mountNative
} from './fixtures/fake-text-tracks';

test('discovers external tracks and normalizes them', async () => {
  const { provider, patches } = mountNative([
    {
      kind: 'captions',
      label: 'English',
      language: 'en',
      id: 't1',
      default: true,
      cues: [{}]
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

test('excludes non-caption kinds from the published track collection', async () => {
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
  // The chapters track is the one exception, and it is not a caption concern:
  // its cues are never obtained while its mode is `disabled`, so the chapters
  // slice moves it to `hidden` to read them. It is still excluded from the
  // collection above, which is what this test guards (#182).
  expect(tracks[1]?.mode).toBe('hidden');
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

test('names an unlabelled track after its language', async () => {
  const { provider, patches } = mountNative([
    { kind: 'captions', label: '', language: 'fr', id: 't1' }
  ]);

  await provider.attach();

  expect(latest(patches).textTracks).toEqual([
    {
      id: 't1',
      label: 'français',
      language: 'fr',
      kind: 'captions',
      readiness: 'loading'
    }
  ]);
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
  ).toEqual({ status: 'unavailable', reason: 'source' });
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

// `load()` is guarded by an internal `loaded` flag and providers are created
// per source, so it only ever runs once -- right after `attach()`, on the same
// source discovery just read. It must therefore leave caption state alone.
test('load() keeps the tracks and selection discovered by attach()', async () => {
  const { provider, patches } = mountNative([
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
  await provider.selectTextTrack?.('t2');
  const cueFrames: Array<readonly unknown[]> = [];
  provider.subscribeCues?.((cues) => cueFrames.push(cues));

  await provider.load();

  expect(
    (latest(patches).textTracks as ReadonlyArray<{ id: string }>).map(
      ({ id }) => id
    )
  ).toEqual(['t1', 't2']);
  expect(latest(patches).selectedTextTrackId).toBe('t2');
  expect(latest(patches).captionRendering).toBe('custom');
  expect(cueFrames).toEqual([]);
});

// The genuine source-switch boundary: React recreates the provider per source
// and hands it to the controller, which clears caption state (and the cue
// channel) on the swap.
test('swapping the provider through the controller clears caption state', async () => {
  const controller = new PlayerController();
  const first = mountNative([
    {
      kind: 'captions',
      label: 'English',
      language: 'en',
      id: 't1',
      default: true
    }
  ]);
  const cueFrames: Array<readonly unknown[]> = [];
  controller.subscribeCues((cues) => cueFrames.push(cues));
  controller.setProvider(first.provider);
  await Promise.resolve();
  await Promise.resolve();

  expect(controller.getState().selectedTextTrackId).toBe('t1');

  const second = mountNative([
    {
      kind: 'subtitles',
      label: 'French',
      language: 'fr',
      id: 't3',
      default: true
    }
  ]);
  controller.setProvider(second.provider);

  expect(cueFrames.at(-1)).toEqual([]);
  await Promise.resolve();
  await Promise.resolve();

  // The new source's own default is honored -- nothing leaks from the old one.
  expect(controller.getState().selectedTextTrackId).toBe('t3');
  expect(
    controller.getState().textTracks.map((textTrack) => textTrack.id)
  ).toEqual(['t3']);

  controller.setProvider(undefined);

  expect(controller.getState().textTracks).toEqual([]);
  expect(controller.getState().selectedTextTrackId).toBeNull();
  expect(controller.getState().captionRendering).toBe('unavailable');
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
