import type {
  PlayerController,
  PlayerState,
  RefusedUrlSurface,
  TextCue,
  detectSource
} from '@playdeck/core';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useSyncExternalStore,
  type RefObject
} from 'react';
import type { ActivationBindings } from './use-activation.js';
import type { VolumeRequest } from './volume-request.js';

export type PlayerContextValue = ActivationBindings & {
  controller: PlayerController;
  // `Root`'s own `controls` prop, threaded through so `Media`
  // (`viewport-media.tsx`) can set it as a DOM attribute on the native
  // `<video>` element -- the same channel `preload` already uses to reach
  // that component, rather than a second configuration path.
  controls: boolean | undefined;
  source: ReturnType<typeof detectSource>;
  // The last non-null caption selection, remembered so toggling captions back
  // on restores it. Player-scoped rather than per-control: CaptionsButton and
  // the Controls `C` shortcut each used to keep their own ref, so the two
  // disagreed whenever one mounted after a selection the other had seen (#58).
  lastSelectedTextTrackId: RefObject<string | null>;
  // The volume the user last asked for, held over the round trip to the media
  // element. Player-scoped for the same reason as the selection above:
  // `VolumeSlider` renders it and the `Controls` shortcut layer compounds its
  // next value on it, neither can read the other's state, and the shortcuts
  // run while no volume control is mounted at all (#271).
  volumeRequest: VolumeRequest;
};

export type PlayerHandle = Pick<
  PlayerController,
  | 'getState'
  | 'subscribe'
  | 'on'
  | 'play'
  | 'pause'
  | 'togglePlayback'
  | 'seekTo'
  | 'seekBy'
  | 'selectQuality'
  | 'mute'
  | 'unmute'
  | 'toggleMuted'
  | 'setVolume'
  | 'setPlaybackRate'
  | 'selectTextTrack'
  // The imperative twin of the `captionRenderer` prop: flipping the renderer
  // without re-rendering `Root` is the only way to change it mid-playback,
  // which is what the Vimeo caption e2e does.
  | 'setCaptionRenderer'
  | 'requestFullscreen'
  | 'exitFullscreen'
  | 'requestPictureInPicture'
  | 'exitPictureInPicture'
  | 'showAirPlayPicker'
  | 'retry'
  | 'whenReady'
> &
  // Not a controller method: `activateFromInteraction` starts a dormant
  // interaction-loading player, which `PlayerController` itself has no
  // concept of -- only `useActivation` does. It joins the handle here so an
  // external controller can drive activation through the same ref it already
  // holds, without `PlayerController`'s own surface growing an activation
  // concern.
  Pick<ActivationBindings, 'activateFromInteraction'>;

export type PlayerActions = Omit<PlayerHandle, 'getState' | 'subscribe' | 'on'>;

export const PlayerContext = createContext<PlayerContextValue | null>(null);
export const PosterContext = createContext<'visible' | 'hidden'>('visible');

export const usePlayer = (): PlayerContextValue => {
  const player = useContext(PlayerContext);
  if (!player)
    throw new Error(
      'Player hooks and primitives must be used inside Player.Root.'
    );
  return player;
};

export const usePosterState = (): 'visible' | 'hidden' =>
  useContext(PosterContext);

// Registers a standing refusal for as long as `refused` holds, and disposes it
// when it stops holding, when the surface changes, or when the calling
// component unmounts (#330). In an effect, not in render: `reportRefusedUrl`
// writes controller state and wakes its subscribers, which a render pass may
// not do.
//
// The registration is per calling INSTANCE, which is the whole point. Two
// `PosterImage`s under one `Player.Root` hold the same prop name and are two
// separate reporters, so the one holding a permitted `src` must not be able to
// withdraw the notice the poisoned one published -- which is what a per-prop
// setter would do, silently, in half the render orders.
//
// `controller` is optional because `PosterImage` renders outside `Player.Root`
// too. There the refusal stands with nothing to report it to, exactly as it did
// before #330.
//
// Withdrawn on unmount, deliberately, even though `Player.Poster` stays mounted
// and merely hides -- so the ordinary flow never reaches this cleanup at all.
// Leaving the registration standing would still be wrong: a consumer who does
// conditionally render a poster would otherwise leave a registration no live
// component owns, and a keyed list remounting poisoned posters would pile them
// up with no way back to a clear state. The cost is real and accepted: take the
// poisoned `PosterImage` out of the tree and its notice goes with it, so a
// monitor sampling `PlayerState.error` after that point sees nothing. That is
// the same rule the
// value-turned-permitted withdrawal already follows -- a notice reports a
// refusal that stands right now -- and it is pinned by `withdraws the notice
// when the only poster refusing a value unmounts`.
export const useRefusedUrlReport = (
  controller: PlayerController | undefined,
  surface: RefusedUrlSurface,
  refused: boolean
): void => {
  useEffect(() => {
    if (!controller || !refused) return;
    return controller.reportRefusedUrl(surface);
  }, [controller, refused, surface]);
};

const selectionsEqual = (left: unknown, right: unknown): boolean => {
  if (Object.is(left, right)) return true;
  if (
    typeof left !== 'object' ||
    left === null ||
    typeof right !== 'object' ||
    right === null
  ) {
    return false;
  }
  const leftPrototype = Object.getPrototypeOf(left);
  if (
    leftPrototype !== Object.getPrototypeOf(right) ||
    (leftPrototype !== Object.prototype && !Array.isArray(left))
  ) {
    return false;
  }
  const enumerableOwnKeys = (value: object): PropertyKey[] =>
    Reflect.ownKeys(value).filter((key) =>
      Object.prototype.propertyIsEnumerable.call(value, key)
    );
  const leftKeys = enumerableOwnKeys(left);
  const rightKeys = enumerableOwnKeys(right);
  return (
    leftKeys.length === rightKeys.length &&
    leftKeys.every(
      (key) =>
        Object.prototype.hasOwnProperty.call(right, key) &&
        Object.is(
          (left as Record<PropertyKey, unknown>)[key],
          (right as Record<PropertyKey, unknown>)[key]
        )
    )
  );
};

export const usePlayerState = <Selected>(
  selector: (state: PlayerState) => Selected
): Selected => {
  const { controller } = usePlayer();
  const selectionRef = useRef<{
    initialized: boolean;
    selector?: (state: PlayerState) => Selected;
    state?: PlayerState;
    value?: Selected;
  }>({ initialized: false });
  const getSnapshot = useCallback((): Selected => {
    const state = controller.getState();
    if (
      selectionRef.current.initialized &&
      selectionRef.current.state === state &&
      selectionRef.current.selector === selector
    ) {
      return selectionRef.current.value as Selected;
    }
    const nextSelection = selector(state);
    if (
      selectionRef.current.initialized &&
      selectionsEqual(selectionRef.current.value, nextSelection)
    ) {
      selectionRef.current.selector = selector;
      selectionRef.current.state = state;
      return selectionRef.current.value as Selected;
    }
    selectionRef.current = {
      initialized: true,
      selector,
      state,
      value: nextSelection
    };
    return nextSelection;
  }, [controller, selector]);
  return useSyncExternalStore(controller.subscribe, getSnapshot, getSnapshot);
};

export const useActiveCues = (): readonly TextCue[] => {
  const { controller } = usePlayer();
  const getSnapshot = useCallback(
    () => controller.getActiveCues(),
    [controller]
  );
  // The cue list is a stable frozen array, so the server snapshot is the same
  // getter -- without it, any server render of a cue consumer throws.
  return useSyncExternalStore(
    useCallback((cb) => controller.subscribeCues(cb), [controller]),
    getSnapshot,
    getSnapshot
  );
};

// The one place the action surface is spelled out. `usePlayerActions` reads it
// through the context; `Root` (`root.tsx`'s `useImperativeHandle`) cannot --
// it is the provider, so its own context is not yet readable when it builds
// the ref handle -- and calls this directly instead. Two hand-written lists
// would drift, and the ref's list drifting is how members leak back out.
// Every `PlayerController` member here is an arrow-function class field
// (`player-controller.ts`), so plucking one onto a fresh object keeps its
// binding and needs no `.bind`.
export const collectPlayerActions = (
  controller: PlayerController,
  activateFromInteraction: ActivationBindings['activateFromInteraction']
): PlayerActions => ({
  activateFromInteraction,
  play: controller.play,
  pause: controller.pause,
  togglePlayback: controller.togglePlayback,
  seekTo: controller.seekTo,
  seekBy: controller.seekBy,
  selectQuality: controller.selectQuality,
  mute: controller.mute,
  unmute: controller.unmute,
  toggleMuted: controller.toggleMuted,
  setVolume: controller.setVolume,
  setPlaybackRate: controller.setPlaybackRate,
  selectTextTrack: controller.selectTextTrack,
  setCaptionRenderer: controller.setCaptionRenderer,
  requestFullscreen: controller.requestFullscreen,
  exitFullscreen: controller.exitFullscreen,
  requestPictureInPicture: controller.requestPictureInPicture,
  exitPictureInPicture: controller.exitPictureInPicture,
  showAirPlayPicker: controller.showAirPlayPicker,
  retry: controller.retry,
  whenReady: controller.whenReady
});

export const usePlayerActions = (): PlayerActions => {
  const { activateFromInteraction, controller } = usePlayer();
  return useMemo(
    () => collectPlayerActions(controller, activateFromInteraction),
    [activateFromInteraction, controller]
  );
};
