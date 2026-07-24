// @vitest-environment happy-dom

import { afterEach, expect, test, vi } from 'vitest';
import { createHlsProvider } from '../src/index';
import { fakeHlsLoader } from './fixtures/fake-hls';
import {
  createFakeTrack,
  createFakeTrackList,
  type FakeTrackInit
} from './fixtures/fake-text-tracks';

const source = { type: 'hls', src: '/hls/master.m3u8' } as const;

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

// Forces `selectHlsEngine` onto the native engine, the same way
// packages/provider-hls/test/index.test.ts's `stubNativeHlsSupport` does.
const stubNativeHlsSupport = (media: HTMLVideoElement): void => {
  vi.spyOn(media, 'canPlayType').mockImplementation((type) =>
    type === 'application/vnd.apple.mpegurl' ? 'maybe' : ''
  );
  vi.stubGlobal('MediaSource', undefined);
};

const mountNativeEngineHls = (trackInits: readonly FakeTrackInit[]) => {
  const media = document.createElement('video');
  stubNativeHlsSupport(media);
  const trackList = createFakeTrackList([]);
  const tracks = trackInits.map((init) =>
    createFakeTrack(init, () => trackList.dispatch('change'))
  );
  trackList.push(...tracks);
  Object.defineProperty(media, 'textTracks', {
    configurable: true,
    value: trackList
  });
  const loader = fakeHlsLoader();
  const provider = createHlsProvider(
    media,
    { ...source, engine: 'native' },
    { loadHls: loader.loadHls }
  );
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

test('discovers embedded WebVTT tracks on the native HLS engine and honors the default selection', async () => {
  const { provider, patches } = mountNativeEngineHls([
    {
      kind: 'captions',
      label: 'English',
      language: 'en',
      id: 't1',
      default: true,
      hasCues: true
    }
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
});

test('selectTextTrack hides the chosen track, disables the rest, and emits the selection', async () => {
  const { provider, patches, tracks } = mountNativeEngineHls([
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

test('subscribeCues receives a normalized TextCue when the selected track fires cuechange', async () => {
  const { provider, tracks } = mountNativeEngineHls([
    { kind: 'captions', label: 'English', language: 'en', id: 't1' }
  ]);
  await provider.attach();
  await provider.selectTextTrack?.('t1');
  const cueFrames: Array<readonly unknown[]> = [];
  provider.subscribeCues?.((cues) => cueFrames.push(cues));
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

test('does not expose caption commands on the hls.js engine path', async () => {
  const media = document.createElement('video');
  vi.spyOn(media, 'canPlayType').mockReturnValue('');
  vi.stubGlobal('MediaSource', { isTypeSupported: () => true });
  const loader = fakeHlsLoader();
  const provider = createHlsProvider(media, source, {
    loadHls: loader.loadHls
  });

  await provider.attach();

  expect(provider.selectTextTrack).toBeUndefined();
  expect(provider.subscribeCues).toBeUndefined();
  expect(provider.setCaptionRenderer).toBeUndefined();
});
