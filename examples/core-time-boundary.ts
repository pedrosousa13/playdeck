import { createTimeBoundary } from '@reely/core';

// The `[startTime, endTime]` window a provider plays inside, sanitised once.
// A start that is absent, non-positive or non-finite is no start; an end that
// is absent, non-finite, or not above the start is no end.
const bounds = createTimeBoundary({ startTime: 30, endTime: 90 });

console.log(bounds.startTime, bounds.endTime); // 30 90 — the load hints

// Every question is asked against the duration, which caps the window: pass
// `null` or `undefined` before the media reports one.
export const startsAt = bounds.start(120); // 30 — where playback begins
export const endsAt = bounds.end(60); // 60 — the duration caps the end
export const reachedEnd = bounds.atEnd(120, 91); // true — publish `ended` here
export const seekTarget = bounds.clamp(120, 999); // 90 — seeks stay inside

// The two loop questions. A platform loop wraps to zero rather than to the
// start boundary, so a playhead behind the start of a positioned player is that
// wrap; and the platform's own end is only worth correcting when the window
// begins somewhere other than zero.
export const wrapped = bounds.atWrap(120, 5, { loop: true, positioned: true });
export const restarts = bounds.restartsAtStart(true); // true

// A nonsense window is dropped rather than reported: this plays the whole video.
export const unbounded = createTimeBoundary({ startTime: -1, endTime: 0 });
