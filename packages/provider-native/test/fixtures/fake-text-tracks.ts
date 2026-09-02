import {
  createFakeTrack,
  createFakeTrackList,
  type FakeTrackInit
} from '@playdeck/test-support/fake-text-tracks';
import { createNativeProvider } from '../../src/index';

// The fake `TextTrack`/`TextTrackList` itself is shared with the HLS provider
// tests and lives in tests/support; that file records why. What stays here is
// native-only: mounting the fake over a video element's `textTracks` getter and
// wiring a provider to it. The HLS tests have no equivalent, so moving this
// would be extraction for its own sake.
export const mountNative = (trackInits: readonly FakeTrackInit[]) => {
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

export const latest = (
  patches: ReadonlyArray<Record<string, unknown>>
): Record<string, unknown> =>
  patches.reduce<Record<string, unknown>>(
    (merged, patch) => ({ ...merged, ...patch }),
    {}
  );
