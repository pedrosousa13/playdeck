import { deriveLiveState } from '@reely/provider-hls';

// Liveness is derived from what the stream reports — never from the URL or a
// filename. `isLiveHint` is hls.js's own answer where it has one; the native
// engine leaves it undefined and an infinite duration decides instead.
export const live = deriveLiveState({
  isLiveHint: true,
  duration: Number.POSITIVE_INFINITY,
  seekable: [{ start: 120, end: 3600 }],
  currentTime: 3598,
  // hls.js's liveSyncPosition: the target edge, behind the raw seekable end.
  liveEdge: 3594
});

// -> { isLive: true, atLiveEdge: true }. `null` means "not live, or not yet
// known" — a control should not claim either until it is.
export const atEdge = live?.atLiveEdge ?? false;
