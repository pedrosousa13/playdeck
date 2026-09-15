import {
  createFakeAudioTrack,
  createFakeAudioTrackList,
  type FakeAudioTrackInit
} from '@playdeck/test-support/fake-audio-tracks';
import { createNativeProvider } from '../../src/index';

// The fake `AudioTrack`/`AudioTrackList` itself is shared with the HLS
// provider tests and lives in tests/support; that file records why. What
// stays here is native-only: mounting the fake over a video element's
// `audioTracks` getter and wiring a provider to it.
export const mountNativeAudio = (trackInits: readonly FakeAudioTrackInit[]) => {
  const media = document.createElement('video');
  const trackList = createFakeAudioTrackList(
    trackInits.map((init) => createFakeAudioTrack(init))
  );
  Object.defineProperty(media, 'audioTracks', {
    configurable: true,
    value: trackList
  });
  const provider = createNativeProvider(media);
  const patches: Array<Record<string, unknown>> = [];
  provider.subscribe((patch) => patches.push(patch as Record<string, unknown>));
  return { media, provider, patches, trackList };
};

export const latest = (
  patches: ReadonlyArray<Record<string, unknown>>
): Record<string, unknown> =>
  patches.reduce<Record<string, unknown>>(
    (merged, patch) => ({ ...merged, ...patch }),
    {}
  );
