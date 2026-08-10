import type { CommandResult } from '@reely/core';

// The optimistic-request policy the sliders share: the value the user last
// asked for, held until the published state answers for it, and the command
// traffic that asks for it coalesced.
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
// Two pieces, and deliberately not one object owning the requested value. What
// is scope-independent is the command chain: coalescing, the per-command
// timeout and generation invalidation are the same wherever the value is kept,
// and React has no opinion about any of them. What is not scope-independent is
// the requested value itself, because holding it is a React fact and giving it
// to a plain object costs two properties React was providing for free:
//
//   - **Rollback.** A render attempt React throws away — a sibling suspending
//     under the same boundary, a higher-priority update interrupting a
//     concurrent render — must leave nothing behind. A `setState` computed
//     purely from the state and props a render already has is recomputed on
//     the next attempt and reaches the same answer. A value released by
//     mutating a store during render is released once, in an attempt that
//     never commits, and the control and the store then disagree forever.
//   - **A commit at the drain.** `setSettling(false)` is what re-renders the
//     control when the chain empties, and that render is what re-evaluates the
//     echo. A provider can publish the value it was asked for *before* it
//     resolves the command, and that value answers nothing on the way in
//     (`requestAnswered` holds the chain first); the drain is the only moment
//     left at which it can be recognised. A drain that schedules no React work
//     leaves the control previewing a value the media already reached, for the
//     whole of the deadline.
//
// So the chain below is shared, the release rule below it is shared as a pure
// predicate, and each binding applies them in its own idiom: `useSeekPreview`
// stores its request in the control's own React state and times it out in an
// effect, while a request two sibling controls both consume has to be
// player-scoped and reach them through a subscription instead — the shape
// `lastSelectedTextTrackId` (`root.tsx`) already takes, after two controls each
// keeping their own copy disagreed (#58).

// How long a single command may go unanswered before the chain gives up on it.
// Nothing below this layer has a timeout — the controller awaits the adapter,
// and the iframe providers hand back raw SDK promises across a postMessage
// bridge that a torn-down frame, a navigation or a dropped message leaves
// unsettled forever. A chain that never drains is worse than a late command:
// `inFlight` would never clear, so every later change event would be swallowed
// into `pending` and the control would be dead for the rest of the session.
// Four seconds is what Vimeo's `CHROMELESS_PROBE_TIMEOUT_MS` allows a
// cross-document round trip, comfortably above any live one; losing the race
// costs only an early reconcile, since the abandoned promise is ignored either
// way.
const COMMAND_TIMEOUT_MS = 4000;

// How long a requested value may go on being shown after the chain that asked
// for it has drained with nothing published to answer it.
//
// It covers one failure only: a provider that answers the command and then
// reports nothing for it — HLS and YouTube never publish `seeking`, and neither
// a seek nor a volume change dropped after it was accepted announces itself.
// Without this the control would keep a value the media never reached. It is
// measured from the moment the last command settles, so a slow round trip
// spends none of it, and it is not what defends against a command that never
// answers at all: that one holds the chain open and never reaches this timer,
// which is what `COMMAND_TIMEOUT_MS` above is for.
//
// Shared by both bindings because the failure is the same failure and the
// duration is the same duration. The *timer* is not shared and must not be:
// arming it belongs wherever the requested value is kept, so `useSeekPreview`
// arms it in a commit-phase effect that no discarded render can cancel, and the
// player-scoped volume request arms it in the store at the drain.
export const ECHO_DEADLINE_MS = 2000;

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

export type CommandChain<Value> = {
  // Ask for `value`, now or as soon as the chain has room for it.
  readonly send: (value: Value) => void;
  // Abandon whatever is still queued, because the media it was aimed at has
  // gone. The command already in flight is left to settle: its result is a
  // fact about media that no longer matters, and the drain reports it anyway.
  readonly invalidate: () => void;
};

// One command in flight at a time, with the value asked for during one
// overwriting the value queued behind it rather than joining a queue.
//
// Every change takes this path: a pointer drag is a burst of change events and
// an arrow press is a single one, and the two are not distinguished, so a
// keyboard change is coalesced exactly as a drag is and nothing here depends on
// a release event. Trailing-edge supersession is what makes that affordable —
// a drag through N values costs far fewer than N round trips and still ends on
// the drag's last value.
export const createCommandChain = <Value>({
  command,
  onDrained
}: {
  readonly command: (value: Value) => Promise<CommandResult>;
  // The chain is empty again, carrying whether its last command succeeded. A
  // binding holding a requested value has to react to this: a failed command
  // has nothing coming to answer for it, and a successful one has just made
  // whatever the player published during the chain worth re-reading.
  readonly onDrained: (ok: boolean) => void;
}): CommandChain<Value> => {
  // Read the moment a change arrives rather than a render later, which is the
  // whole of why it is not React state: a drag's change events all land in the
  // same tick, before React has re-rendered, so every one of them would still
  // read a rendered flag as false and issue its own command.
  let inFlight = false;
  let pending: Value | null = null;
  // A chain is aimed at whatever media was loaded when it started, so
  // invalidation is a generation and not a flag: the running loop compares the
  // generation it started under, and a value queued for media that has gone is
  // dropped rather than sent to whatever is loaded now.
  let generation = 0;

  return {
    send: (value) => {
      if (inFlight) {
        pending = value;
        return;
      }
      inFlight = true;
      const chain = generation;
      void (async () => {
        let next: Value | null = value;
        let ok = true;
        while (next !== null) {
          // A command that never settles at all is counted as failed rather
          // than left holding the chain open.
          ok = await answeredInTime(command(next));
          next = generation === chain ? pending : null;
          pending = null;
        }
        inFlight = false;
        onDrained(ok);
      })();
    },
    invalidate: () => {
      generation += 1;
    }
  };
};

// Whether the published value answers the value that was asked for.
//
// The chain is held first: a value published while more commands are still
// outstanding answers an earlier request, not the latest, and reading it as an
// answer would hand the control back to player state mid-drag.
//
// The tolerance is the caller's, because it is domain-specific — a seek can
// land on the nearest keyframe, and a volume can be quantised by the platform
// — and because a control that gets it wrong gets it wrong in a way only its
// own domain explains.
export const requestAnswered = ({
  published,
  requested,
  settling,
  tolerance
}: {
  readonly published: number;
  readonly requested: number;
  readonly settling: boolean;
  readonly tolerance: number;
}): boolean => !settling && Math.abs(published - requested) <= tolerance;
