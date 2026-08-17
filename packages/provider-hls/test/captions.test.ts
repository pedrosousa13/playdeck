// @vitest-environment happy-dom

import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { createHlsProvider, type HlsSubtitleTrackLike } from '../src/index';
import { FakeHls, fakeHlsLoader } from './fixtures/fake-hls';
import {
  createFakeTrack,
  createFakeTrackList,
  type FakeTrackInit
} from './fixtures/fake-text-tracks';

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

// Mounts the hls.js engine. Unlike the native engine above, this never
// touches `media.textTracks` — see index.ts's `startHlsJs` for why the
// hls.js engine constructs its `Hls` instance with
// `renderTextTracksNatively: false` and drives captions purely off
// `SUBTITLE_TRACKS_UPDATED`/`CUES_PARSED`.
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

// Same as `mountHlsEngineHls`, but with a sidecar `<track>` present on the
// media element: `Player.Media` renders `<track>` children for both `video`
// and `hls` sources, and provider-native stays attached on the hls.js path.
const mountHlsEngineHlsWithSidecarTracks = async (
  trackInits: readonly FakeTrackInit[]
) => {
  const media = document.createElement('video');
  stubMseOnlySupport(media);
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
  const provider = createHlsProvider(media, source, {
    loadHls: loader.loadHls
  });
  const patches: Array<Record<string, unknown>> = [];
  provider.subscribe((patch) => patches.push(patch as Record<string, unknown>));
  await provider.attach();
  await provider.load();
  return { media, provider, patches, hls: currentFakeHls() };
};

const discoverHlsSubtitles = (
  hls: FakeHls,
  subtitleTracks: readonly HlsSubtitleTrackLike[]
): void => {
  hls.subtitleTracks = [...subtitleTracks];
  hls.emitSubtitleTracksUpdated();
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
      cues: [{}]
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

test('does not expose caption commands on an unresolved HLS engine', async () => {
  const media = document.createElement('video');
  vi.spyOn(media, 'canPlayType').mockReturnValue('');
  vi.stubGlobal('MediaSource', undefined);
  const loader = fakeHlsLoader();
  const provider = createHlsProvider(media, source, {
    loadHls: loader.loadHls
  });

  await provider.attach();

  expect(provider.selectTextTrack).toBeUndefined();
  expect(provider.subscribeCues).toBeUndefined();
  expect(provider.setCaptionRenderer).toBeUndefined();
});

// --- hls.js engine ---------------------------------------------------------

test('constructs hls.js with renderTextTracksNatively off to avoid colliding with the native caption subsystem', async () => {
  const { hls } = await mountHlsEngineHls();

  expect(hls.config).toEqual({ renderTextTracksNatively: false });
});

test('discovers hls.js subtitle tracks and honors the default selection', async () => {
  const { provider, patches, hls } = await mountHlsEngineHls();

  discoverHlsSubtitles(hls, [
    { id: 0, name: 'English', lang: 'en', default: false, type: 'SUBTITLES' },
    { id: 1, name: 'Spanish', lang: 'es', default: true, type: 'SUBTITLES' }
  ]);

  const last = latest(patches);
  expect(last.textTracks).toEqual([
    {
      id: 'hls:0',
      label: 'English',
      language: 'en',
      kind: 'subtitles',
      readiness: 'loaded'
    },
    {
      id: 'hls:1',
      label: 'Spanish',
      language: 'es',
      kind: 'subtitles',
      readiness: 'loaded'
    }
  ]);
  expect(last.selectedTextTrackId).toBe('hls:1');
  expect(last.captionRendering).toBe('custom');
  expect(hls.subtitleTrack).toBe(1);
  expect(last.capabilities).toMatchObject({
    selectTextTrack: { status: 'available' }
  });
  expect(provider.selectTextTrack).toBeInstanceOf(Function);
  expect(provider.subscribeCues).toBeInstanceOf(Function);
  expect(provider.setCaptionRenderer).toBeInstanceOf(Function);
});

test('keeps native caption state out of the hls.js engine path so hls.js is the only caption owner', async () => {
  const { patches, hls } = await mountHlsEngineHlsWithSidecarTracks([
    {
      kind: 'captions',
      label: 'Sidecar English',
      language: 'en',
      id: 'sidecar',
      default: true,
      cues: [{}]
    }
  ]);

  // provider-native discovered the sidecar `<track>` and emitted it, but on
  // the hls.js engine hls.js owns captions: nothing native says about them
  // may reach the state.
  const beforeHls = latest(patches);
  expect(beforeHls.textTracks).toBeUndefined();
  expect(beforeHls.selectedTextTrackId).toBeUndefined();
  expect(beforeHls.captionRendering).toBeUndefined();
  expect(beforeHls.capabilities).toMatchObject({
    selectTextTrack: { status: 'unknown', reason: 'provider-check' }
  });
  // Non-caption native state still comes through unchanged.
  expect(beforeHls.muted).toBe(false);

  discoverHlsSubtitles(hls, [
    { id: 0, name: 'English', lang: 'en', default: true, type: 'SUBTITLES' }
  ]);

  const afterHls = latest(patches);
  expect(afterHls.textTracks).toEqual([
    {
      id: 'hls:0',
      label: 'English',
      language: 'en',
      kind: 'subtitles',
      readiness: 'loaded'
    }
  ]);
  expect(afterHls.selectedTextTrackId).toBe('hls:0');
  expect(afterHls.captionRendering).toBe('custom');
});

test('falls back to a CLOSED-CAPTIONS kind and an index-based id when hls.js omits one', async () => {
  const { patches, hls } = await mountHlsEngineHls();

  discoverHlsSubtitles(hls, [
    { name: 'CC1', default: false, type: 'CLOSED-CAPTIONS' }
  ]);

  expect(latest(patches).textTracks).toEqual([
    {
      id: 'hls:0',
      label: 'CC1',
      language: null,
      kind: 'captions',
      readiness: 'loaded'
    }
  ]);
});

test('names an unnamed hls.js subtitle track after its language', async () => {
  const { patches, hls } = await mountHlsEngineHls();

  discoverHlsSubtitles(hls, [
    { id: 0, name: '', lang: 'fr', default: false, type: 'SUBTITLES' }
  ]);

  expect(latest(patches).textTracks).toEqual([
    {
      id: 'hls:0',
      label: 'français',
      language: 'fr',
      kind: 'subtitles',
      readiness: 'loaded'
    }
  ]);
});

test('reports captionRendering as unavailable when hls.js has no subtitle tracks', async () => {
  const { patches, hls } = await mountHlsEngineHls();

  discoverHlsSubtitles(hls, []);

  expect(latest(patches).captionRendering).toBe('unavailable');
  expect(latest(patches).selectedTextTrackId).toBeNull();
});

test('reports the selectTextTrack capability as unavailable with zero tracks and available once tracks appear', async () => {
  const { patches, hls } = await mountHlsEngineHls();

  discoverHlsSubtitles(hls, []);

  expect(latest(patches).capabilities).toMatchObject({
    selectTextTrack: { status: 'unavailable', reason: 'source' }
  });

  discoverHlsSubtitles(hls, [
    { id: 0, name: 'English', lang: 'en', default: false, type: 'SUBTITLES' }
  ]);

  expect(latest(patches).capabilities).toMatchObject({
    selectTextTrack: { status: 'available' }
  });
});

test('retry() clears the selectTextTrack capability instead of leaving it stale until tracks are rediscovered', async () => {
  const { provider, patches, hls } = await mountHlsEngineHls();
  discoverHlsSubtitles(hls, [
    { id: 0, name: 'English', lang: 'en', default: true, type: 'SUBTITLES' }
  ]);
  expect(latest(patches).capabilities).toMatchObject({
    selectTextTrack: { status: 'available' }
  });

  await provider.retry?.();
  patches.length = 0;
  const retriedHls = currentFakeHls();
  // A capabilities-emitting event (e.g. MANIFEST_PARSED) can fire on the
  // fresh instance before SUBTITLE_TRACKS_UPDATED repopulates the track
  // list; the capability must not still read 'available' from before the
  // retry in that window — it resets to 'unknown', mirroring how
  // selectQualityAvailability is reset on retry.
  retriedHls.emit(FakeHls.Events.MANIFEST_PARSED, {});

  expect(latest(patches).capabilities).toMatchObject({
    selectTextTrack: { status: 'unknown', reason: 'provider-check' }
  });
});

test('selectTextTrack sets hls.js subtitleTrack, and null turns captions off with no cues', async () => {
  const { provider, patches, hls } = await mountHlsEngineHls();
  discoverHlsSubtitles(hls, [
    { id: 0, name: 'English', lang: 'en', default: false, type: 'SUBTITLES' },
    { id: 1, name: 'Spanish', lang: 'es', default: false, type: 'SUBTITLES' }
  ]);
  patches.length = 0;

  const result = await provider.selectTextTrack?.('hls:1');

  expect(result).toEqual({ ok: true });
  expect(hls.subtitleTrack).toBe(1);
  expect(latest(patches).selectedTextTrackId).toBe('hls:1');
  expect(latest(patches).captionRendering).toBe('custom');

  const cueFrames: Array<readonly unknown[]> = [];
  provider.subscribeCues?.((cues) => cueFrames.push(cues));

  const nullResult = await provider.selectTextTrack?.(null);

  expect(nullResult).toEqual({ ok: true });
  expect(hls.subtitleTrack).toBe(-1);
  expect(cueFrames).toEqual([[]]);
});

test('selectTextTrack rejects an id hls.js does not know about', async () => {
  const { provider, hls } = await mountHlsEngineHls();
  discoverHlsSubtitles(hls, [
    { id: 0, name: 'English', lang: 'en', default: false, type: 'SUBTITLES' }
  ]);

  await expect(provider.selectTextTrack?.('hls:99')).resolves.toEqual({
    ok: false,
    reason: 'unsupported'
  });
});

test('subscribeCues normalizes CUES_PARSED cues windowed to the current time, and leaks no hls.js cue reference', async () => {
  const { provider, media, hls } = await mountHlsEngineHls();
  discoverHlsSubtitles(hls, [
    { id: 0, name: 'English', lang: 'en', default: true, type: 'SUBTITLES' }
  ]);
  const cueFrames: Array<readonly unknown[]> = [];
  provider.subscribeCues?.((cues) => cueFrames.push(cues));
  const rawCue = {
    id: 'cue-1',
    startTime: 1,
    endTime: 2,
    text: 'Hello',
    extra: 'leak-check'
  };

  media.currentTime = 1.5;
  hls.emitCuesParsed([rawCue]);

  expect(cueFrames.at(-1)).toEqual([
    { id: 'cue-1', startTime: 1, endTime: 2, text: 'Hello' }
  ]);
  expect(cueFrames.at(-1)?.[0]).not.toBe(rawCue);

  media.currentTime = 5;
  media.dispatchEvent(new Event('timeupdate'));

  expect(cueFrames.at(-1)).toEqual([]);
});

test('ignores CUES_PARSED cues once no text track is selected', async () => {
  const { provider, media, hls } = await mountHlsEngineHls();
  discoverHlsSubtitles(hls, [
    { id: 0, name: 'English', lang: 'en', default: false, type: 'SUBTITLES' }
  ]);
  const cueFrames: Array<readonly unknown[]> = [];
  provider.subscribeCues?.((cues) => cueFrames.push(cues));

  media.currentTime = 1.5;
  hls.emitCuesParsed([
    { id: 'cue-1', startTime: 1, endTime: 2, text: 'Hello' }
  ]);

  expect(cueFrames).toEqual([]);
});

test('selection persists across a later SUBTITLE_TRACKS_UPDATED and resets once the track disappears', async () => {
  const { provider, patches, hls } = await mountHlsEngineHls();
  discoverHlsSubtitles(hls, [
    { id: 0, name: 'English', lang: 'en', default: false, type: 'SUBTITLES' },
    { id: 1, name: 'Spanish', lang: 'es', default: false, type: 'SUBTITLES' }
  ]);
  await provider.selectTextTrack?.('hls:1');
  patches.length = 0;

  discoverHlsSubtitles(hls, [
    { id: 0, name: 'English', lang: 'en', default: false, type: 'SUBTITLES' },
    { id: 1, name: 'Spanish', lang: 'es', default: false, type: 'SUBTITLES' }
  ]);
  expect(latest(patches).selectedTextTrackId).toBe('hls:1');
  expect(hls.subtitleTrack).toBe(1);

  discoverHlsSubtitles(hls, [
    { id: 0, name: 'English', lang: 'en', default: false, type: 'SUBTITLES' }
  ]);
  expect(latest(patches).selectedTextTrackId).toBeNull();
  expect(hls.subtitleTrack).toBe(-1);
});

test('setCaptionRenderer accepts native but honestly keeps reporting custom rendering', async () => {
  const { provider, patches, hls } = await mountHlsEngineHls();
  discoverHlsSubtitles(hls, [
    { id: 0, name: 'English', lang: 'en', default: true, type: 'SUBTITLES' }
  ]);
  patches.length = 0;

  provider.setCaptionRenderer?.('native');

  expect(latest(patches).captionRendering).toBe('custom');

  provider.setCaptionRenderer?.('custom');

  expect(latest(patches).captionRendering).toBe('custom');
});

// HLS carries no chapters concept of its own on either engine: chapters come
// off the media element's own track list, which the native adapter under this
// one already reads. What this guards is that the hls.js engine's caption
// stripping does not take them with it -- chapters are not caption state, and
// hls.js has nothing of its own to publish in their place (#182).
const chapterTrack = (cues: readonly unknown[] | null): FakeTrackInit => ({
  kind: 'chapters',
  label: 'Chapters',
  language: null,
  id: 'ch1',
  cues
});

test('publishes chapters from a chapters track on the native HLS engine', async () => {
  const { provider, patches, tracks } = mountNativeEngineHls([
    chapterTrack(null)
  ]);

  await provider.attach();
  const track = tracks[0];
  if (track)
    track.cues = [
      { id: 'c1', startTime: 0, endTime: 1, text: 'Intro' },
      { id: 'c2', startTime: 30, endTime: 31, text: 'Body' }
    ];
  track?.dispatch('cuechange');

  expect(latest(patches).chapters).toEqual([
    { id: 'c1', title: 'Intro', startTime: 0, endTime: 30 },
    { id: 'c2', title: 'Body', startTime: 30, endTime: null }
  ]);
});

test('keeps sidecar chapters on the hls.js engine, which strips only caption state', async () => {
  const { patches } = await mountHlsEngineHlsWithSidecarTracks([
    chapterTrack([{ id: 'c1', startTime: 0, endTime: 1, text: 'Intro' }])
  ]);

  const last = latest(patches);
  expect(last.textTracks).toBeUndefined();
  expect(last.chapters).toEqual([
    { id: 'c1', title: 'Intro', startTime: 0, endTime: null }
  ]);
  expect(last.capabilities).toMatchObject({
    chapters: { status: 'available' }
  });
});
