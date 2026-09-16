import type { PlayerEventOrigin } from '@playdeck/core';
import * as Player from '@playdeck/react';
import { useEffect, useRef } from 'react';

// A behaviour plugin: a component mounted inside `Player.Root` that observes
// player state and issues commands, entirely through `usePlayerState` and
// `usePlayerActions` -- this one only observes, since mapping a transition to
// an event issues no command -- and renders nothing. It holds no player state
// of its own: every value below comes straight off `usePlayerState`, so the
// player stays the one owner of what it is doing and this component only
// reacts to it.
//
// Five transitions:
//  - `playback` (`PlayerState.playback`) moving to `'playing'`, `'paused'`
//    or `'ended'`.
//  - `seeking` moving to `true`, carrying the `seekOrigin` it started with.
//    `PlayerState.seekOrigin`'s own comment is what this reads: set only
//    while a seek is in flight, `null` the rest of the time, so reading it
//    here is exactly the origin that seek began with.
//  - `lifecycle` moving to `'error'`, carrying the `PlayerError` it moved
//    with. A Notice -- a rejected prop, a fallback taken -- also fills
//    `PlayerState.error`, but CONTEXT.md's "Notice" entry is explicit that
//    one never moves `lifecycle`, so only a fatal failure produces an event
//    here.
export type BehaviourPluginEvent =
  | { readonly type: 'play' }
  | { readonly type: 'pause' }
  | { readonly type: 'ended' }
  | { readonly type: 'seek'; readonly origin: PlayerEventOrigin }
  | { readonly type: 'error'; readonly message: string };

export type AnalyticsEventsProps = {
  readonly onEvent: (event: BehaviourPluginEvent) => void;
};

const PLAYBACK_EVENTS = {
  playing: 'play',
  paused: 'pause',
  ended: 'ended'
} as const;

export const AnalyticsEvents = ({ onEvent }: AnalyticsEventsProps) => {
  const playback = Player.usePlayerState((state) => state.playback);
  const seeking = Player.usePlayerState((state) => state.seeking);
  const seekOrigin = Player.usePlayerState((state) => state.seekOrigin);
  const lifecycle = Player.usePlayerState((state) => state.lifecycle);
  const error = Player.usePlayerState((state) => state.error);

  // The latest `onEvent`, read by the effects below without being one of
  // their dependencies. A consumer who displays the events -- the workbench
  // story among them -- hands this component a new `onEvent` function on
  // every one of ITS OWN renders; putting that prop in an effect's
  // dependency array would fire the effect on every one of those too, since
  // React cannot tell "onEvent changed" apart from "playback changed" once
  // both are in the same array. This effect has no dependency array, so it
  // re-syncs the ref after every render and, declared first, runs before the
  // effects below it in the same commit -- but it never itself calls
  // `onEvent`, so it is not a transition the mapping below has to skip.
  const latestOnEvent = useRef(onEvent);
  useEffect(() => {
    latestOnEvent.current = onEvent;
  });

  // A player starts paused, so the very first render already reads
  // `playback: 'paused'` with nothing to have transitioned from. This flag is
  // the only other thing this component keeps between renders, and it is not
  // player state either: it answers one question the player itself does not
  // publish -- "has a real transition been observed yet".
  const observedFirstPlayback = useRef(false);
  useEffect(() => {
    if (!observedFirstPlayback.current) {
      observedFirstPlayback.current = true;
      return;
    }
    latestOnEvent.current({ type: PLAYBACK_EVENTS[playback] });
  }, [playback]);

  useEffect(() => {
    if (seeking && seekOrigin)
      latestOnEvent.current({ type: 'seek', origin: seekOrigin });
  }, [seeking, seekOrigin]);

  useEffect(() => {
    if (lifecycle === 'error' && error)
      latestOnEvent.current({ type: 'error', message: error.message });
  }, [lifecycle, error]);

  return null;
};
