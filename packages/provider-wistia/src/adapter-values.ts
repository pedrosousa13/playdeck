import type {
  Availability,
  CommandResult,
  PlayerEventDetailMap,
  PlayerEventType,
  ProviderEvent,
  ProviderEventFor,
  ProviderStatePatch
} from '@playdeck/core';

// The element a Wistia player mounts into. A consumer may set the media-ish
// properties on it before attach, and the adapter pushes them into the embed
// once the player answers.
export type WistiaMountElement = HTMLElement & {
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
// answer that describes a discarded player is dropped rather than published.
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
  const message = errorString(cause, 'message') || 'The Wistia command failed.';
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

// Runs one handle call against a player the attachment seam has already
// guarded for readiness, keeping a throwing player inside the provider
// boundary. Generic in the player so each seam passes only the slice of it
// that seam calls. Aurora's handle answers synchronously where Vimeo's answers
// promises, so the command's return value is awaited rather than required to
// be thenable — every command still answers a `CommandResult`.
export const runWistiaCommand = async <Player>(
  player: Player | undefined,
  command: (player: Player) => unknown
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

export const numberField = (
  data: unknown,
  field: string
): number | undefined => {
  const value = asRecord(data)[field];
  return typeof value === 'number' && Number.isFinite(value)
    ? value
    : undefined;
};

export const booleanField = (
  data: unknown,
  field: string
): boolean | undefined => {
  const value = asRecord(data)[field];
  return typeof value === 'boolean' ? value : undefined;
};
