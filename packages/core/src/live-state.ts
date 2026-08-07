// The one liveness derivation in the workspace. Every adapter that can tell
// whether its media is live consumes this, so `PlayerState.live` means the same
// thing whoever published it.
//
// Liveness is derived from provider signals and normalized state alone — a
// duration, a seekable window, a playhead, and the provider's own answer where
// it has one. Never from a source URL, an id or a filename: a name is a guess,
// and a guess published as state is a control that lies.

import type { PlayerLiveState, TimeRange } from './types.js';

// The shared at-edge tolerance, in seconds. Deliberately not exported: an
// omitted `atEdgeThreshold` *is* the shared value, so no adapter carries a
// number of its own. At-edge is a coarse "close to the live edge" window, not
// the tight target of DVR/LL-HLS tuning (out of MVP scope).
const LIVE_EDGE_THRESHOLD_SECONDS = 10;

export type LiveDerivationInput = {
  // Authoritative liveness when defined (for example hls.js level details).
  // Left undefined by engines that have no such signal, where liveness is
  // inferred from duration instead.
  readonly isLiveHint?: boolean;
  // Raw media duration: Infinity or NaN for an ordinary live stream.
  readonly duration: number;
  readonly seekable: ReadonlyArray<TimeRange>;
  readonly currentTime: number;
  // The target live edge when known (hls.js's liveSyncPosition), behind the raw
  // seekable end. Falls back to the seekable end when undefined.
  readonly liveEdge?: number;
  // Omit to use the shared tolerance above, which is what every adapter does.
  readonly atEdgeThreshold?: number;
};

// Derives normalized live status from stream data alone. Liveness comes from
// the provider's live flag when present, otherwise from an infinite duration —
// never from the source URL. Edge state is measured against a moving window,
// clamped so a current time at or beyond the edge never reads as behind and no
// arithmetic escapes as NaN or a negative distance.
export const deriveLiveState = (
  input: LiveDerivationInput
): PlayerLiveState => {
  const isLive =
    input.isLiveHint ?? input.duration === Number.POSITIVE_INFINITY;
  if (!isLive) return null;
  const seekableEnd = input.seekable.reduce(
    (end, range) => Math.max(end, range.end),
    Number.NEGATIVE_INFINITY
  );
  const edge = Number.isFinite(input.liveEdge)
    ? (input.liveEdge as number)
    : seekableEnd;
  if (!Number.isFinite(edge) || !Number.isFinite(input.currentTime)) {
    return Object.freeze({ isLive: true, atLiveEdge: true });
  }
  const distance = Math.max(0, edge - input.currentTime);
  return Object.freeze({
    isLive: true,
    atLiveEdge:
      distance <= (input.atEdgeThreshold ?? LIVE_EDGE_THRESHOLD_SECONDS)
  });
};

export const liveStateEqual = (
  a: PlayerLiveState,
  b: PlayerLiveState
): boolean =>
  a === b ||
  (a !== null &&
    b !== null &&
    a.isLive === b.isLive &&
    a.atLiveEdge === b.atLiveEdge);
