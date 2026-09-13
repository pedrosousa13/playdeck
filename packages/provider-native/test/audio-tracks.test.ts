// @vitest-environment happy-dom

import { expect, test } from 'vitest';
import { createFakeAudioTrack } from '@playdeck/test-support/fake-audio-tracks';
import { createNativeProvider } from '../src/index';
import { mountNativeAudio, latest } from './fixtures/fake-audio-tracks';

test('discovers audio tracks and normalizes them', async () => {
  const { provider, patches } = mountNativeAudio([
    { label: 'English', language: 'en', id: 'a1', enabled: true },
    { label: 'Spanish', language: 'es', id: 'a2', enabled: false }
  ]);

  await provider.attach();

  expect(latest(patches).audioTracks).toEqual([
    { id: 'a1', label: 'English', language: 'en', active: true },
    { id: 'a2', label: 'Spanish', language: 'es', active: false }
  ]);
  expect(
    (latest(patches).capabilities as { selectAudioTrack: { status: string } })
      .selectAudioTrack.status
  ).toBe('available');
});

test('falls back to a native:<index> id when the track has no id', async () => {
  const { provider, patches } = mountNativeAudio([
    { label: 'English', language: 'en' }
  ]);

  await provider.attach();

  expect(latest(patches).audioTracks).toEqual([
    { id: 'native:0', label: 'English', language: 'en', active: false }
  ]);
});

test('normalizes an empty language to null', async () => {
  const { provider, patches } = mountNativeAudio([
    { label: 'English', language: '', id: 'a1' }
  ]);

  await provider.attach();

  expect(latest(patches).audioTracks).toEqual([
    { id: 'a1', label: 'English', language: null, active: false }
  ]);
});

test('names an unlabelled track after its language', async () => {
  const { provider, patches } = mountNativeAudio([
    { label: '', language: 'fr', id: 'a1' }
  ]);

  await provider.attach();

  expect(latest(patches).audioTracks).toEqual([
    { id: 'a1', label: 'français', language: 'fr', active: false }
  ]);
});

test('reports unavailable/browser when the media element exposes no AudioTrackList', async () => {
  const media = document.createElement('video');
  const provider = createNativeProvider(media);
  const patches: Array<Record<string, unknown>> = [];
  provider.subscribe((patch) => patches.push(patch as Record<string, unknown>));

  await provider.attach();

  expect(
    (latest(patches).capabilities as { selectAudioTrack: unknown })
      .selectAudioTrack
  ).toEqual({ status: 'unavailable', reason: 'browser' });
});

test('reports unavailable/source when the AudioTrackList is present but empty', async () => {
  const { provider, patches } = mountNativeAudio([]);

  await provider.attach();

  expect(
    (latest(patches).capabilities as { selectAudioTrack: unknown })
      .selectAudioTrack
  ).toEqual({ status: 'unavailable', reason: 'source' });
});

test('selectAudioTrack enables the chosen track, disables the rest, and emits the selection', async () => {
  const { provider, patches, trackList } = mountNativeAudio([
    { label: 'English', language: 'en', id: 'a1', enabled: true },
    { label: 'Spanish', language: 'es', id: 'a2', enabled: false }
  ]);
  await provider.attach();
  patches.length = 0;

  const result = await provider.selectAudioTrack?.('a2');

  expect(result).toEqual({ ok: true });
  expect(trackList[0]?.enabled).toBe(false);
  expect(trackList[1]?.enabled).toBe(true);
  expect(latest(patches).audioTracks).toEqual([
    { id: 'a1', label: 'English', language: 'en', active: false },
    { id: 'a2', label: 'Spanish', language: 'es', active: true }
  ]);
});

test('selectAudioTrack rejects an id it does not know about', async () => {
  const { provider } = mountNativeAudio([
    { label: 'English', language: 'en', id: 'a1' }
  ]);
  await provider.attach();

  await expect(provider.selectAudioTrack?.('missing')).resolves.toEqual({
    ok: false,
    reason: 'unsupported'
  });
});

test('rediscovers tracks on addtrack/removetrack', async () => {
  const { provider, patches, trackList } = mountNativeAudio([
    { label: 'English', language: 'en', id: 'a1', enabled: true }
  ]);
  await provider.attach();
  patches.length = 0;

  trackList.push(
    createFakeAudioTrack({
      label: 'Spanish',
      language: 'es',
      id: 'a2',
      enabled: false
    })
  );
  trackList.dispatch('addtrack');

  expect(latest(patches).audioTracks).toEqual([
    { id: 'a1', label: 'English', language: 'en', active: true },
    { id: 'a2', label: 'Spanish', language: 'es', active: false }
  ]);
});
