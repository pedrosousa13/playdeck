import {
  createInitialPlayerState,
  isNotice,
  isValidTextTrackLanguage,
  plainCueText,
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

// The plain text a caption overlay should render for a cue: WebVTT tag spans
// removed, its character references decoded. Every provider runs its own cue
// payload through this before publishing it as `TextCue.text`.
export const cue = plainCueText('<v Bob><i>Look out</i> &amp; run'); // 'Look out & run'

// A BCP 47 tag's shape, not its registry membership: letters, digits and
// hyphens, bounded length. `Player.Root`'s `preferredTextTrackLanguage` runs
// every value through this before using it for matching or, on YouTube,
// folding it into the embed's `cc_lang_pref` var -- a value that fails is
// ignored exactly as an absent prop would be.
console.log(isValidTextTrackLanguage('en-GB')); // true
console.log(isValidTextTrackLanguage('en&autoplay=1')); // false
