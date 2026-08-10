import type { CommandResult } from '@reely/core';

// The optimistic-request policy a control shares with the commands it issues:
// the value the user last asked for, held until the published state answers
// for it, and the command traffic that asks for it coalesced.
//
// It exists because a control whose `value` comes from `PlayerState` is
// controlled by state the media element only publishes from its own
// asynchronous events. On a change React holds no new state yet, so it
// restores the input's DOM value to the old one and commits the real one
// milliseconds later; a range input fires no `input` and no `change` when a key
// asks it for the value it already holds, so a keypress that arrives inside
// that restore window is silently swallowed. Holding the requested value over
// the round trip is what keeps the control showing where the user is.
//
// A plain state machine rather than a hook, and the held value is mirrored out
// through `onChange` rather than read back through a subscription, because the
// scope a request has to live in is the caller's business and the policy's
// business is only the policy. A control that owns its request keeps it in its
// own React state, where a render can release it in the same pass that reads
// the published value. A request that two sibling controls both consume cannot
// live in either of them: it has to be player-scoped and reach them through a
// subscription, the shape `lastSelectedTextTrackId` (`root.tsx`) already takes
// for the same reason, after two controls each keeping their own copy
// disagreed (#58). Coalescing, the command timeout, the echo release, the
// deadline and the invalidation are identical in both scopes; the storage is
// not, so the storage is the only part left to the caller.

// How long a single command may go unanswered before the chain gives up on it.
// Nothing below this layer has a timeout — the controller awaits the adapter,
// and the iframe providers hand back raw SDK promises across a postMessage
// bridge that a torn-down frame, a navigation or a dropped message leaves
// unsettled forever. A chain that never drains is worse than a late command:
// `settling` would never clear, so every later change event would be swallowed
// into `pending` and the control would be dead for the rest of the session.
// Four seconds is what Vimeo's `CHROMELESS_PROBE_TIMEOUT_MS` allows a
// cross-document round trip, comfortably above any live one; losing the race
// costs only an early reconcile, since the abandoned promise is ignored either
// way.
const COMMAND_TIMEOUT_MS = 4000;

// Resolves to whether the command succeeded, and to `false` if it has not
// answered in time. The invented failure never leaves this module: only `ok`
// is read, so a timeout and a refusal reconcile the control the same way.
const answeredInTime = (command: Promise<CommandResult>): Promise<boolean> => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    command.then((result) => result.ok),
    new Promise<boolean>((resolve) => {
      timer = setTimeout(() => resolve(false), COMMAND_TIMEOUT_MS);
    })
  ]).finally(() => clearTimeout(timer));
};

export type OptimisticRequest<Value, Published = Value> = {
  // Ask for `value`, holding it until something answers for it.
  readonly request: (value: Value) => void;
  // Offer the value the player has published. Returns whether the held request
  // was released by it, so a caller reconciling during its own render can act
  // on the answer in the same pass rather than a render later.
  readonly reconcile: (published: Published) => boolean;
  // Release the held request now, and invalidate whatever is still queued in
  // the chain, because the thing those values were aimed at has gone.
  readonly abandon: () => void;
  // End the request, for a caller whose scope is ending.
  readonly dispose: () => void;
};

export const createOptimisticRequest = <Value, Published = Value>({
  answers,
  command,
  deadlineMs,
  onChange
}: {
  // Whether the published value counts as an answer to the requested one. The
  // tolerance is domain-specific — a seek can land on the nearest keyframe,
  // and a volume can be quantised by the platform — so the comparison belongs
  // to the caller and never to the policy.
  readonly answers: (published: Published, requested: Value) => boolean;
  readonly command: (value: Value) => Promise<CommandResult>;
  readonly deadlineMs: number;
  // The held request on its way out to wherever the caller stores it: the
  // requested value on every request, and `null` on every release.
  readonly onChange: (requested: Value | null) => void;
}): OptimisticRequest<Value, Published> => {
  // The value the user last asked for, held until the player answers for it.
  // Every change takes this path: a pointer drag is a burst of change events
  // and an arrow press is a single one, and the two are not distinguished, so a
  // keyboard change previews exactly as a drag does and nothing here depends on
  // a release event. Commands are coalesced by trailing-edge supersession —
  // one in flight at a time, and a change arriving during one overwrites the
  // pending value rather than queuing behind it — so a drag through N values
  // costs far fewer than N round trips and still ends on the drag's last value.
  let requested: Value | null = null;
  // Whether the chain is outstanding. Deliberately not React state in any
  // caller's scope: a drag's change events all land in the same tick, before
  // React has re-rendered, so every one of them would still read a rendered
  // flag as false and issue its own command. Only a value written the moment
  // the chain starts is read soon enough to supersede.
  let settling = false;
  let pending: Value | null = null;
  // A chain is aimed at whatever media was loaded when it started. Replacing
  // the provider, or losing the window a value was chosen against — which is
  // how a swap to another source of the same kind shows up — invalidates every
  // value still queued in it.
  let generation = 0;
  let deadline: ReturnType<typeof setTimeout> | undefined;

  const disarm = (): void => {
    clearTimeout(deadline);
    deadline = undefined;
  };

  const release = (): void => {
    if (requested === null) return;
    requested = null;
    disarm();
    onChange(null);
  };

  // Armed once the command chain drains, and deliberately not re-armed by a
  // moving published value: playback reports several times a second, which
  // would push the deadline out forever.
  const arm = (): void => {
    if (requested === null || settling) return;
    deadline = setTimeout(release, deadlineMs);
  };

  return {
    request: (value) => {
      requested = value;
      // The deadline measures a drained chain only, so a fresh request disarms
      // it and the drain below arms it again.
      disarm();
      onChange(value);
      if (settling) {
        pending = value;
        return;
      }
      settling = true;
      const chain = generation;
      void (async () => {
        let next: Value | null = value;
        let ok = true;
        while (next !== null) {
          // A command that never settles at all is counted as failed rather
          // than left holding the chain open.
          ok = await answeredInTime(command(next));
          // Abandon a queued value whose media has gone, rather than drive
          // whatever is loaded now to a value chosen on the last source.
          next = generation === chain ? pending : null;
          pending = null;
        }
        settling = false;
        // A failed command has no published value coming, so it reconciles at
        // once; a successful one starts the backstop instead.
        if (ok) arm();
        else release();
      })();
    },
    reconcile: (published) => {
      // The chain is held first — a value published while more commands are
      // still outstanding answers an earlier request, not the latest.
      if (requested === null || settling) return false;
      if (!answers(published, requested)) return false;
      release();
      return true;
    },
    abandon: () => {
      // Nothing is queued behind a request that is not held: every value the
      // chain carries was held from the moment it was asked for until it was
      // answered, failed, timed out or abandoned. So a generation the caller
      // cannot see move is a generation with nothing to invalidate.
      if (requested === null) return;
      generation += 1;
      release();
    },
    // The held value goes with the deadline, and unannounced: a scope that is
    // ending has nobody left to tell. An outstanding chain is not stopped —
    // its result is discarded either way — but with nothing held it can no
    // longer arm a deadline that would outlive the caller.
    dispose: () => {
      requested = null;
      disarm();
    }
  };
};
