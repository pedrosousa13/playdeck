import type {
  PlayerController,
  PlayerState,
  TextCue,
  detectSource
} from '@reely/core';
import {
  createContext,
  useCallback,
  useContext,
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
  // VolumeSlider renders it and the Controls shortcut layer compounds its next
  // value on it, neither can read the other's state, and the shortcuts run
  // while no volume control is mounted at all (#271).
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

export const usePlayerActions = (): PlayerActions => {
  const { activateFromInteraction, controller } = usePlayer();
  return useMemo(
    () => ({
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
    }),
    [activateFromInteraction, controller]
  );
};
