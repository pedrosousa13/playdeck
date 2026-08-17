// @vitest-environment happy-dom

import { expect, test } from 'vitest';
import { latest, mountNative } from './fixtures/fake-text-tracks';

const cue = (id: string, startTime: number, text: string) => ({
  id,
  startTime,
  // A WebVTT chapter cue carries its own end, which is deliberately ignored:
  // it is not guaranteed to abut the next cue, and the published shape has to
  // match the providers that report no end at all.
  endTime: startTime + 1,
  text
});

const withDuration = (media: HTMLVideoElement, duration: number): void => {
  Object.defineProperty(media, 'duration', {
    configurable: true,
    value: duration
  });
};

const chapterTrack = (cues: readonly unknown[] | null) => ({
  kind: 'chapters',
  label: 'Chapters',
  language: null,
  id: 'ch1',
  cues
});

const capability = (patches: ReadonlyArray<Record<string, unknown>>): unknown =>
  (latest(patches).capabilities as Record<string, unknown> | undefined)
    ?.chapters;

test('moves a chapters track off disabled to hidden rather than showing', async () => {
  const { provider, tracks } = mountNative([chapterTrack(null)]);

  await provider.attach();

  expect(tracks[0]?.mode).toBe('hidden');
});

test('reads the chapter cues on cuechange rather than at the mode assignment', async () => {
  const { media, provider, patches, tracks } = mountNative([
    chapterTrack(null)
  ]);
  withDuration(media, 90);

  await provider.attach();

  // The mode write alone obtains nothing: a track the user agent has only just
  // been told to load has no cues yet, so a synchronous read here publishes an
  // empty list that is indistinguishable from "this video has no chapters".
  // The capability is what keeps the two apart — a chapters track is there,
  // and what is in it is not known yet.
  expect(latest(patches).chapters).toEqual([]);
  expect(capability(patches)).toEqual({
    status: 'unknown',
    reason: 'provider-check'
  });

  const track = tracks[0];
  if (track) track.cues = [cue('c1', 0, 'Intro'), cue('c2', 30, 'Body')];
  track?.dispatch('cuechange');

  expect(latest(patches).chapters).toEqual([
    { id: 'c1', title: 'Intro', startTime: 0, endTime: 30 },
    { id: 'c2', title: 'Body', startTime: 30, endTime: 90 }
  ]);
  expect(capability(patches)).toEqual({ status: 'available' });
});

test('reads the chapter cues when the track element reports them loaded', async () => {
  const { media, provider, patches, tracks } = mountNative([
    chapterTrack(null)
  ]);
  withDuration(media, 60);
  const trackElement = document.createElement('track');
  trackElement.setAttribute('kind', 'chapters');
  trackElement.id = 'ch1';
  media.appendChild(trackElement);

  await provider.attach();
  const track = tracks[0];
  if (track) track.cues = [cue('c1', 0, 'Intro')];
  trackElement.dispatchEvent(new Event('load'));

  expect(latest(patches).chapters).toEqual([
    { id: 'c1', title: 'Intro', startTime: 0, endTime: 60 }
  ]);
});

test('orders chapters by start time and keeps the last one open when the duration is unknown', async () => {
  const { provider, patches, tracks } = mountNative([chapterTrack(null)]);

  await provider.attach();
  const track = tracks[0];
  if (track) track.cues = [cue('c2', 30, 'Body'), cue('c1', 0, 'Intro')];
  track?.dispatch('cuechange');

  expect(latest(patches).chapters).toEqual([
    { id: 'c1', title: 'Intro', startTime: 0, endTime: 30 },
    { id: 'c2', title: 'Body', startTime: 30, endTime: null }
  ]);
});

test('closes the last chapter once the duration becomes known', async () => {
  const { media, provider, patches, tracks } = mountNative([
    chapterTrack(null)
  ]);
  await provider.attach();
  const track = tracks[0];
  if (track) track.cues = [cue('c1', 0, 'Intro')];
  track?.dispatch('cuechange');

  withDuration(media, 120);
  media.dispatchEvent(new Event('durationchange'));

  expect(latest(patches).chapters).toEqual([
    { id: 'c1', title: 'Intro', startTime: 0, endTime: 120 }
  ]);
});

test('names an unidentified cue after its position in the collection', async () => {
  const { provider, patches, tracks } = mountNative([chapterTrack(null)]);

  await provider.attach();
  const track = tracks[0];
  if (track)
    track.cues = [
      { startTime: 0, endTime: 1, text: 'Intro' },
      { startTime: 30, endTime: 31, text: 'Body' }
    ];
  track?.dispatch('cuechange');

  expect(
    (latest(patches).chapters as ReadonlyArray<{ id: string }>).map(
      ({ id }) => id
    )
  ).toEqual(['chapters:0', 'chapters:1']);
});

test('reports the chapter capability unavailable for a source with no chapters track', async () => {
  const { provider, patches } = mountNative([
    { kind: 'captions', label: 'English', language: 'en', id: 't1' }
  ]);

  await provider.attach();

  expect(latest(patches).chapters).toEqual([]);
  expect(capability(patches)).toEqual({
    status: 'unavailable',
    reason: 'source'
  });
});

test('keeps a chapters track hidden when the caption renderer switches to native', async () => {
  const { provider, tracks } = mountNative([
    chapterTrack(null),
    { kind: 'captions', label: 'English', language: 'en', id: 't1' }
  ]);
  await provider.attach();
  await provider.selectTextTrack?.('t1');

  provider.setCaptionRenderer?.('native');

  expect(tracks[0]?.mode).toBe('hidden');
  expect(tracks[1]?.mode).toBe('showing');
});

test('keeps a chapters track out of the published text-track collection', async () => {
  const { provider, patches, tracks } = mountNative([
    chapterTrack([cue('c1', 0, 'Intro')]),
    { kind: 'captions', label: 'English', language: 'en', id: 't1' }
  ]);

  await provider.attach();

  expect(latest(patches).textTracks).toEqual([
    {
      id: 't1',
      label: 'English',
      language: 'en',
      kind: 'captions',
      readiness: 'loading'
    }
  ]);
  // A chapters track discovered with its cues already in place is published as
  // chapters all the same — the event-driven read covers the first load, not
  // a re-discovery of a track that has already loaded.
  expect(latest(patches).chapters).toEqual([
    { id: 'c1', title: 'Intro', startTime: 0, endTime: null }
  ]);
  expect(tracks[1]?.mode).toBe('disabled');
});

// The four regressions widening `TextTrackKind` would cause all begin here: a
// chapters track that reached the published collection would make the captions
// menu render, and `selectTextTrack` claim to be available, for a source with
// no captions at all.
test('leaves text-track selection unavailable for a source with chapters and no captions', async () => {
  const { provider, patches } = mountNative([
    chapterTrack([cue('c1', 0, 'Intro')])
  ]);

  await provider.attach();

  const last = latest(patches);
  expect(last.textTracks).toEqual([]);
  expect(last.captionRendering).toBe('unavailable');
  expect(
    (last.capabilities as Record<string, unknown>).selectTextTrack
  ).toEqual({ status: 'unavailable', reason: 'source' });
});

test('stops publishing chapters after destroy', async () => {
  const { provider, patches, tracks } = mountNative([chapterTrack(null)]);
  await provider.attach();
  await provider.destroy();
  patches.length = 0;

  const track = tracks[0];
  if (track) track.cues = [cue('c1', 0, 'Intro')];
  track?.dispatch('cuechange');

  expect(patches).toEqual([]);
});
