import type { Availability, PlayerCapabilities } from '@playdeck/core';

// The four fields 1.2.0 added to `PlayerCapabilities`, filled with the value
// a provider that does not support the feature returns for each -- the same
// `unavailable`/`provider` pair `examples/provider-setup-file-adapter.tsx`'s
// `unimplemented` already reports for every other capability its reference
// adapter leaves out.
const unsupported: Availability = { status: 'unavailable', reason: 'provider' };

export const newCapabilitiesFields: Pick<
  PlayerCapabilities,
  'liveEdge' | 'selectQualityAuto' | 'selectAudioTrack' | 'remotePlayback'
> = {
  liveEdge: unsupported,
  selectQualityAuto: unsupported,
  selectAudioTrack: unsupported,
  remotePlayback: unsupported
};
