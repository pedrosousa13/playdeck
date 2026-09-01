import type {
  Availability,
  CommandResult,
  PlayerEventDetailMap,
  PlayerEventType,
  ProviderEvent,
  ProviderEventFor,
  ProviderStatePatch
} from '@playdeck/core';

// The element a Vimeo player mounts into. A consumer may set the media-ish
// properties on it before attach, and the adapter pushes them into the embed
// once the player answers.
export type VimeoMountElement = HTMLElement & {
  muted?: boolean;
  volume?: number;
  playbackRate?: number;
};

// Publishes a provider-state patch to every subscriber, optionally paired with
// the provider event that caused it. Every seam takes this as its sink.
export type EmitProviderState = (
  patch: ProviderStatePatch,
  event?: ProviderEvent
) => void;

// True once the adapter is destroyed or the player has been superseded, so an
// SDK answer awaited on a discarded player is dropped rather than published.
// Takes the seam's own slice of the player, which identity comparison is all
// this needs.
export type IsStalePlayer = (player: object) => boolean;

export const providerEvent = <Type extends PlayerEventType>(
  type: Type,
  detail: PlayerEventDetailMap[Type],
  originalEvent?: unknown
): ProviderEventFor<Type> => ({
  type,
  detail,
  origin: 'provider',
  ...(originalEvent === undefined ? {} : { originalEvent })
});

export const available: Availability = { status: 'available' };
export const providerCheck: Availability = {
  status: 'unknown',
  reason: 'provider-check'
};
export const noChapterSource: Availability = {
  status: 'unavailable',
  reason: 'source'
};

export const errorString = (cause: unknown, property: 'message' | 'name') => {
  if (
    (typeof cause !== 'object' || cause === null) &&
    typeof cause !== 'function'
  ) {
    return undefined;
  }
  try {
    const value = Reflect.get(cause, property);
    return typeof value === 'string' ? value : undefined;
  } catch {
    return undefined;
  }
};

const commandFailure = (
  cause: unknown
): Exclude<CommandResult, { ok: true }> => {
  const name = errorString(cause, 'name');
  const message = errorString(cause, 'message') || 'The Vimeo command failed.';
  if (name === 'NotAllowedError') {
    return {
      ok: false,
      reason: 'blocked',
      error: {
        category: 'policy',
        fatal: false,
        recoverable: true,
        message,
        cause
      }
    };
  }
  if (name === 'UnsupportedError' || name === 'NotSupportedError') {
    return {
      ok: false,
      reason: 'unsupported',
      error: {
        category: 'unsupported',
        fatal: false,
        recoverable: true,
        message,
        cause
      }
    };
  }
  return {
    ok: false,
    reason: 'provider-error',
    error: {
      category: 'provider',
      fatal: false,
      recoverable: true,
      message,
      cause
    }
  };
};

// Runs one SDK call against a player the attachment seam has already guarded
// for readiness, keeping a rejecting player inside the provider boundary.
// Generic in the player so each seam passes only the slice of it that seam
// calls.
export const runVimeoCommand = async <Player>(
  player: Player | undefined,
  command: (player: Player) => Promise<unknown>
): Promise<CommandResult> => {
  if (!player) return { ok: false, reason: 'not-ready' };
  try {
    await command(player);
    return { ok: true };
  } catch (cause) {
    return commandFailure(cause);
  }
};

export const asRecord = (data: unknown): Record<string, unknown> =>
  typeof data === 'object' && data !== null
    ? (data as Record<string, unknown>)
    : {};

// Reads one finite number out of an SDK payload, accepting a number that
// arrived in string form.
//
// The string case is not a curiosity. The SDK's own `checkUrlTimeParam` calls
// `setCurrentTime` with the substring it matched out of the embedding page's
// url (`@vimeo/player@2.30.4/dist/player.js:1052`), never coercing it, and the
// embed echoes that value back in the `seconds` of everything it publishes
// afterwards. Refusing it meant the adapter never learned the playhead had
// moved: the embed sat at one position and the published state reported
// another, with nothing to say the two disagreed (#463).
//
// **This is deliberately every field on this bridge, not just the time.** What
// varies is not the field, it is the transport — these values cross a
// `postMessage` boundary as untyped JSON from another origin, and nothing on
// the way types them. A second helper reading strings for `seconds` alone would
// leave the next field to be reported as a string carrying exactly this bug,
// and would leave the choice of which helper to call to whoever writes the next
// handler. Widening changes `percent`, `duration`, `volume`, `playbackRate`,
// `videoWidth` and `videoHeight` too, and it changes them in one direction
// only: a value that is a number is read as that number however it arrived.
// Nothing that is not a number becomes one.
//
// The rejections are the load-bearing half, and `Number` alone will not give
// them: `Number('')` is 0, and so are `Number(' ')`, `Number([])` and
// `Number(false)`. Coercing straight through would turn a report carrying
// nothing into a valid playhead position of zero and publish it — a worse
// failure than the one being fixed, because the library would be asserting a
// position rather than missing one. Hence the string gate before the coercion,
// and `Number.isFinite` after it, which is also what keeps `NaN` out: a `NaN`
// position has already produced a feedback loop here once, a `NaN` report
// "corrected" by a seek to `NaN`, because every comparison against `NaN` is
// false and so no boundary check can catch it.
export const numberField = (
  data: unknown,
  field: string
): number | undefined => {
  const value = asRecord(data)[field];
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : undefined;
  }
  if (typeof value !== 'string' || value.trim() === '') return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
};
