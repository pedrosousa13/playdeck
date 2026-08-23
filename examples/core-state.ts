import {
  createInitialPlayerState,
  isNotice,
  textTrackLabel,
  type PlayerState
} from '@playdeck/core';

// The state a controller starts from. Safe to render on a server, where no
// provider exists yet — and the same state a test fixture should start from.
const initial = createInitialPlayerState();

console.log(initial.duration); // null — nothing has loaded
console.log(initial.capabilities.seek.status); // 'unknown', not 'unavailable'

// A control reading an `unknown` capability renders nothing rather than
// something disabled: the answer is not "no", it is "not yet".
export const seekIsUndecided = initial.capabilities.seek.status === 'unknown';

// Whether the published error is a notice — a rejected option reported while
// the player carries on with a fall-back — rather than something that stopped
// playback. Ask before covering the player: a notice must never be rendered as
// a failure, and only the lifecycle beside it tells the two apart.
export const rendersAsFailure = (state: PlayerState): boolean =>
  state.error !== null && !isNotice(state.error, state.lifecycle);

// The label a provider should publish for a track, given the track's own label
// and its language. Falls back to the language's own name, then to 'Unknown'.
export const labelled = textTrackLabel('', 'pt-BR'); // 'português (Brasil)'
export const named = textTrackLabel('Commentary', 'en'); // 'Commentary'
