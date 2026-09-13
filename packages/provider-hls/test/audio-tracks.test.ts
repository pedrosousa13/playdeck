// @vitest-environment happy-dom

import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { createHlsProvider, type HlsAudioTrackLike } from '../src/index';
import { FakeHls, fakeHlsLoader } from './fixtures/fake-hls';
import {
  createFakeAudioTrack,
  createFakeAudioTrackList,
  type FakeAudioTrackInit
} from '@playdeck/test-support/fake-audio-tracks';

const source = { type: 'hls', src: '/hls/master.m3u8' } as const;

beforeEach(() => {
  FakeHls.reset();
});

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

// Forces `selectHlsEngine` onto the hls.js engine, the same way
// packages/provider-hls/test/index.test.ts's `stubMseOnlySupport` does.
const stubMseOnlySupport = (media: HTMLVideoElement): void => {
  vi.spyOn(media, 'canPlayType').mockReturnValue('');
  vi.stubGlobal('MediaSource', { isTypeSupported: () => true });
};

const currentFakeHls = (): FakeHls => {
  const instance = FakeHls.instances.at(-1);
  if (!instance) throw new Error('No fake hls.js instance was created.');
  return instance;
};

const mountHlsEngineHls = async () => {
  const media = document.createElement('video');
  stubMseOnlySupport(media);
  const loader = fakeHlsLoader();
  const provider = createHlsProvider(media, source, {
    loadHls: loader.loadHls
  });
  const patches: Array<Record<string, unknown>> = [];
  provider.subscribe((patch) => patches.push(patch as Record<string, unknown>));
  await provider.attach();
  await provider.load();
  return { media, provider, patches, hls: currentFakeHls() };
};

const mountNativeEngineHls = (trackInits: readonly FakeAudioTrackInit[]) => {
  const media = document.createElement('video');
  stubNativeHlsSupport(media);
  const trackList = createFakeAudioTrackList(
    trackInits.map((init) => createFakeAudioTrack(init))
  );
  Object.defineProperty(media, 'audioTracks', {
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
  return { media, provider, patches, trackList };
};

const discoverHlsAudio = (
  hls: FakeHls,
  audioTracks: readonly HlsAudioTrackLike[]
): void => {
  hls.audioTracks = [...audioTracks];
  hls.emitAudioTracksUpdated();
};

const parseManifest = (
  hls: FakeHls,
  audioTracks: readonly unknown[] | undefined
): void => {
  hls.emit(FakeHls.Events.MANIFEST_PARSED, {
    levels: hls.levels,
    ...(audioTracks === undefined ? {} : { audioTracks })
  });
};

const latest = (
  patches: ReadonlyArray<Record<string, unknown>>
): Record<string, unknown> =>
  patches.reduce<Record<string, unknown>>(
    (merged, patch) => ({ ...merged, ...patch }),
    {}
  );

// --- native HLS engine -------------------------------------------------------

test('discovers audio tracks from the media element on the native HLS engine', async () => {
  const { provider, patches } = mountNativeEngineHls([
    { label: 'English', language: 'en', id: 'a1', enabled: true },
    { label: 'Spanish', language: 'es', id: 'a2', enabled: false }
  ]);

  await provider.attach();

  expect(latest(patches).audioTracks).toEqual([
    { id: 'a1', label: 'English', language: 'en', active: true },
    { id: 'a2', label: 'Spanish', language: 'es', active: false }
  ]);
  expect(latest(patches).capabilities).toMatchObject({
    selectAudioTrack: { status: 'available' }
  });
  expect(provider.selectAudioTrack).toBeInstanceOf(Function);
});

test('does not expose selectAudioTrack on an unresolved HLS engine', async () => {
  const media = document.createElement('video');
  vi.spyOn(media, 'canPlayType').mockReturnValue('');
  vi.stubGlobal('MediaSource', undefined);
  const loader = fakeHlsLoader();
  const provider = createHlsProvider(media, source, {
    loadHls: loader.loadHls
  });

  await provider.attach();

  expect(provider.selectAudioTrack).toBeUndefined();
});

// --- hls.js engine -----------------------------------------------------------

test('discovers hls.js audio tracks and reports the currently active one', async () => {
  const { provider, patches, hls } = await mountHlsEngineHls();
  hls.audioTrack = 1;

  discoverHlsAudio(hls, [
    { id: 0, name: 'English', lang: 'en', default: true },
    { id: 1, name: 'Spanish', lang: 'es', default: false }
  ]);

  const last = latest(patches);
  expect(last.audioTracks).toEqual([
    { id: 'hls:0', label: 'English', language: 'en', active: false },
    { id: 'hls:1', label: 'Spanish', language: 'es', active: true }
  ]);
  expect(last.capabilities).toMatchObject({
    selectAudioTrack: { status: 'available' }
  });
  expect(provider.selectAudioTrack).toBeInstanceOf(Function);
});

test('falls back to an index-based id when hls.js omits one, and names an unnamed track after its language', async () => {
  const { patches, hls } = await mountHlsEngineHls();

  discoverHlsAudio(hls, [{ name: '', lang: 'fr', default: false }]);

  expect(latest(patches).audioTracks).toEqual([
    { id: 'hls:0', label: 'français', language: 'fr', active: false }
  ]);
});

test('keeps native audio-track state out of the hls.js engine path so hls.js is the only audio-track owner', async () => {
  const media = document.createElement('video');
  stubMseOnlySupport(media);
  const trackList = createFakeAudioTrackList([
    createFakeAudioTrack({
      label: 'Sidecar',
      language: 'en',
      id: 'sidecar',
      enabled: true
    })
  ]);
  Object.defineProperty(media, 'audioTracks', {
    configurable: true,
    value: trackList
  });
  const loader = fakeHlsLoader();
  const provider = createHlsProvider(media, source, {
    loadHls: loader.loadHls
  });
  const patches: Array<Record<string, unknown>> = [];
  provider.subscribe((patch) => patches.push(patch as Record<string, unknown>));
  await provider.attach();
  await provider.load();

  const beforeHls = latest(patches);
  expect(beforeHls.audioTracks).toBeUndefined();
  expect(beforeHls.capabilities).toMatchObject({
    selectAudioTrack: { status: 'unknown', reason: 'provider-check' }
  });

  const hls = currentFakeHls();
  // A real engine resolves its own default-track selection internally before
  // `AUDIO_TRACKS_UPDATED` reaches a listener; the fake has no such mechanism,
  // so the index it would have settled on is set directly here.
  hls.audioTrack = 0;
  discoverHlsAudio(hls, [
    { id: 0, name: 'English', lang: 'en', default: true }
  ]);

  const afterHls = latest(patches);
  expect(afterHls.audioTracks).toEqual([
    { id: 'hls:0', label: 'English', language: 'en', active: true }
  ]);
});

test('a manifest declaring no audio renditions settles the capability instead of leaving it checking forever', async () => {
  const { patches, hls } = await mountHlsEngineHls();

  expect(latest(patches).capabilities).toMatchObject({
    selectAudioTrack: { status: 'unknown', reason: 'provider-check' }
  });

  parseManifest(hls, []);

  expect(latest(patches).capabilities).toMatchObject({
    selectAudioTrack: { status: 'unavailable', reason: 'source' }
  });
});

test('a build with no audio-track controller reports provider-build for a manifest that does declare audio tracks', async () => {
  FakeHls.DefaultConfig = {};
  const { patches, hls } = await mountHlsEngineHls();

  parseManifest(hls, [{ id: 0, name: 'English', lang: 'en' }]);

  expect(latest(patches).capabilities).toMatchObject({
    selectAudioTrack: { status: 'unavailable', reason: 'provider-build' }
  });
});

test('a build that does carry the controller waits for the tracks rather than answering from the manifest', async () => {
  FakeHls.DefaultConfig = { audioTrackController: class {} };
  const { patches, hls } = await mountHlsEngineHls();

  parseManifest(hls, [{ id: 0, name: 'English', lang: 'en' }]);

  expect(latest(patches).capabilities).toMatchObject({
    selectAudioTrack: { status: 'unknown', reason: 'provider-check' }
  });

  discoverHlsAudio(hls, [
    { id: 0, name: 'English', lang: 'en', default: false }
  ]);

  expect(latest(patches).capabilities).toMatchObject({
    selectAudioTrack: { status: 'available' }
  });
});

test('a manifest payload carrying no audioTracks at all teaches the capability nothing', async () => {
  FakeHls.DefaultConfig = {};
  const { patches, hls } = await mountHlsEngineHls();

  parseManifest(hls, undefined);

  expect(latest(patches).capabilities).toMatchObject({
    selectAudioTrack: { status: 'unknown', reason: 'provider-check' }
  });
});

test('retry() clears the selectAudioTrack capability instead of leaving it stale until tracks are rediscovered', async () => {
  const { provider, patches, hls } = await mountHlsEngineHls();
  discoverHlsAudio(hls, [
    { id: 0, name: 'English', lang: 'en', default: true }
  ]);
  expect(latest(patches).capabilities).toMatchObject({
    selectAudioTrack: { status: 'available' }
  });

  await provider.retry?.();
  patches.length = 0;
  const retriedHls = currentFakeHls();
  retriedHls.emit(FakeHls.Events.MANIFEST_PARSED, {});

  expect(latest(patches).capabilities).toMatchObject({
    selectAudioTrack: { status: 'unknown', reason: 'provider-check' }
  });
});

test('selectAudioTrack sets hls.js audioTrack and marks the chosen entry active', async () => {
  const { provider, patches, hls } = await mountHlsEngineHls();
  discoverHlsAudio(hls, [
    { id: 0, name: 'English', lang: 'en', default: true },
    { id: 1, name: 'Spanish', lang: 'es', default: false }
  ]);
  patches.length = 0;

  const result = await provider.selectAudioTrack?.('hls:1');

  expect(result).toEqual({ ok: true });
  expect(hls.audioTrack).toBe(1);
  expect(latest(patches).audioTracks).toEqual([
    { id: 'hls:0', label: 'English', language: 'en', active: false },
    { id: 'hls:1', label: 'Spanish', language: 'es', active: true }
  ]);
});

test('selectAudioTrack rejects an id hls.js does not know about', async () => {
  const { provider, hls } = await mountHlsEngineHls();
  discoverHlsAudio(hls, [
    { id: 0, name: 'English', lang: 'en', default: false }
  ]);

  await expect(provider.selectAudioTrack?.('hls:99')).resolves.toEqual({
    ok: false,
    reason: 'unsupported'
  });
});
