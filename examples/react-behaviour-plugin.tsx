import type { PlaybackState, PlayerEventOrigin } from '@playdeck/core';
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

  // Compared against the last value actually observed, not skipped by count:
  // `createInitialPlayerState` (`@playdeck/core`) starts every player at
  // `'paused'`, so that is the baseline held here rather than whatever
  // `playback` happens to read on this component's own first render.
  // Skipping the first effect run unconditionally would instead treat a
  // plugin mounted after playback already moved -- autoplay resolving before
  // it mounts, or the plugin itself toggled on later into an
  // already-playing tree -- as nothing having transitioned, losing that
  // transition rather than reading it.
  const lastPlayback = useRef<PlaybackState>('paused');
  useEffect(() => {
    if (playback !== lastPlayback.current)
      latestOnEvent.current({ type: PLAYBACK_EVENTS[playback] });
    lastPlayback.current = playback;
  }, [playback]);

  // A second seek beginning while one is already in flight emits nothing
  // here: `PlayerController` keeps the origin the first seek started with
  // rather than relabelling it for a patch that re-reports `seeking`
  // (`packages/core/src/player-controller.ts`, the comment above
  // `seekOrigin`'s assignment in `#applyPatch`), so neither `seeking` nor
  // `seekOrigin` changes for the second seek and this effect never reruns
  // for it. A scrub drag reading as one seek is the accepted shape of that
  // limitation; nothing here works around it.
  useEffect(() => {
    if (seeking && seekOrigin)
      latestOnEvent.current({ type: 'seek', origin: seekOrigin });
  }, [seeking, seekOrigin]);

  // Gated on `lifecycle` actually transitioning into `'error'`, not on
  // `error` changing: `freezeError` (`packages/core/src/safety.ts`) freezes
  // a new object per patch, so a provider re-reporting the same fatal error
  // while `lifecycle` stays `'error'` -- a retry hitting the same failure,
  // carrying its own fresh `cause` -- would otherwise read as a second
  // transition and emit again.
  const lastLifecycle = useRef<typeof lifecycle>('idle');
  useEffect(() => {
    if (lifecycle === 'error' && lastLifecycle.current !== 'error' && error)
      latestOnEvent.current({ type: 'error', message: error.message });
    lastLifecycle.current = lifecycle;
  }, [lifecycle, error]);

  return null;
};
