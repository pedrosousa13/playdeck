import { deriveLiveState, liveStateEqual } from '@playdeck/core';

// Liveness comes from what the provider reports — never from the URL, the id
// or a filename. `isLiveHint` is the provider's own answer where it has one;
// leave it undefined and an infinite duration decides instead.
export const live = deriveLiveState({
  isLiveHint: true,
  duration: Number.POSITIVE_INFINITY,
  seekable: [{ start: 120, end: 3600 }],
  currentTime: 3594
});

// -> { isLive: true, atLiveEdge: true }. `null` means "not live, or not yet
// known" — a control should not claim either until it is.
export const atEdge = live?.atLiveEdge ?? false;

// Omitting `atEdgeThreshold` uses the shared tolerance every adapter uses.
// Pass one only to answer a different question than the players do.
const tight = deriveLiveState({
  isLiveHint: true,
  duration: Number.POSITIVE_INFINITY,
  seekable: [{ start: 120, end: 3600 }],
  currentTime: 3594,
  atEdgeThreshold: 2
});

// An adapter publishes `live` only when the value changes. This is that test.
export const changed = !liveStateEqual(live, tight);
