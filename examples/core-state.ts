import { createInitialPlayerState, textTrackLabel } from '@reely/core';

// The state a controller starts from. Safe to render on a server, where no
// provider exists yet — and the same state a test fixture should start from.
const initial = createInitialPlayerState();

console.log(initial.duration); // null — nothing has loaded
console.log(initial.capabilities.seek.status); // 'unknown', not 'unavailable'

// A control reading an `unknown` capability renders nothing rather than
// something disabled: the answer is not "no", it is "not yet".
export const seekIsUndecided = initial.capabilities.seek.status === 'unknown';

// The label a provider should publish for a track, given the track's own label
// and its language. Falls back to the language's own name, then to 'Unknown'.
export const labelled = textTrackLabel('', 'pt-BR'); // 'português (Brasil)'
export const named = textTrackLabel('Commentary', 'en'); // 'Commentary'
