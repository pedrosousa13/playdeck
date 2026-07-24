import {
  PlayerController,
  bindMediaSession,
  detectSource,
  getMediaSessionCoordinator,
  type AutoplayMode,
  type MediaMetadataInput,
  type MediaSessionBinding,
  type MediaSessionLike,
  type PlayerError,
  type PlayerSource,
  type PlayerState,
  type TextCue,
  type TextTrack,
  type TimeRange
} from '@reely/core';
import type { NativePlaybackOptions } from '@reely/provider-native';
import { CaptionsIcon, CheckIcon, SettingsIcon } from './icons.js';
import {
  useActivation,
  type ActivationBindings,
  type PlayerMediaMount
} from './use-activation.js';
import {
  createContext,
  isValidElement,
  useCallback,
  useContext,
  useEffect,
  useId,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ComponentPropsWithRef,
  type CSSProperties,
  type ImgHTMLAttributes,
  type ReactNode,
  type ReactElement,
  type Ref,
  type RefObject
} from 'react';

type PlayerContextValue = ActivationBindings & {
  controller: PlayerController;
  source: ReturnType<typeof detectSource>;
};

type SourceTransition = {
  readonly key: string;
};

export type ViewportProps = ComponentPropsWithRef<'div'>;

export type PosterProps = ComponentPropsWithRef<'div'>;

export type ResponsivePoster = {
  readonly src: string;
  readonly srcSet?: string;
  readonly sizes?: string;
  readonly width?: number | string;
  readonly height?: number | string;
  readonly loading?: ImgHTMLAttributes<HTMLImageElement>['loading'];
  readonly fetchPriority?: ImgHTMLAttributes<HTMLImageElement>['fetchPriority'];
  readonly decoding?: ImgHTMLAttributes<HTMLImageElement>['decoding'];
  readonly objectFit?: CSSProperties['objectFit'];
  readonly objectPosition?: CSSProperties['objectPosition'];
};

export type PosterInput = string | ResponsivePoster | ReactElement;

export type NormalizedPoster =
  | { readonly type: 'image'; readonly props: ResponsivePoster }
  | { readonly type: 'custom'; readonly element: ReactElement };

export type PosterImageProps = Omit<
  ImgHTMLAttributes<HTMLImageElement>,
  keyof ResponsivePoster
> &
  Partial<ResponsivePoster>;

// Standard <video> passthrough, minus the attributes the controller owns:
// `src` (driven by the resolved source / <source> children), `muted` and
// `autoPlay` (activation + autoplay policy live in the controller), `preload`
// (derived from the loading strategy), `poster` (use `nativePoster`), and
// `children` (Media renders its own <source> set). Passing those would
// silently desync or bypass the player's state machine, so they're excluded.
export type MediaProps = Omit<
  ComponentPropsWithRef<'video'>,
  'children' | 'src' | 'muted' | 'autoPlay' | 'preload' | 'poster'
> & {
  readonly nativePoster?: string;
  readonly textTracks?: ReadonlyArray<{
    readonly src: string;
    readonly srcLang: string;
    readonly label: string;
    readonly kind?: 'captions' | 'subtitles';
    readonly default?: boolean;
  }>;
};

export const normalizePoster = (input: PosterInput): NormalizedPoster => {
  if (typeof input === 'string') {
    return { type: 'image', props: { src: input } };
  }
  if (isValidElement(input)) {
    return { type: 'custom', element: input };
  }
  return { type: 'image', props: { ...input } };
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
  | 'requestFullscreen'
  | 'exitFullscreen'
  | 'requestPictureInPicture'
  | 'exitPictureInPicture'
  | 'showAirPlayPicker'
  | 'retry'
>;

export type PlayerActions = Omit<PlayerHandle, 'getState' | 'subscribe' | 'on'>;

export type {
  PlayerLoadingStrategy,
  PlayerMediaMount,
  PlayerPreload
} from './use-activation.js';

export type PlayerActivationProps = {
  readonly loading?: import('./use-activation.js').PlayerLoadingStrategy;
  readonly loadMargin?: string;
  readonly preload?: import('./use-activation.js').PlayerPreload;
};

export type RootProps = NativePlaybackOptions &
  PlayerActivationProps & {
    readonly autoplay?: AutoplayMode;
    readonly captionRenderer?: 'custom' | 'native';
    readonly children: ReactNode;
    readonly defaultMuted?: boolean;
    readonly mediaMetadata?: MediaMetadataInput | null;
    readonly defaultPlaybackRate?: number;
    readonly defaultVolume?: number;
    readonly muted?: boolean;
    readonly onMutedChange?: (muted: boolean) => void;
    readonly onPlaybackRateChange?: (playbackRate: number) => void;
    readonly onVolumeChange?: (volume: number) => void;
    readonly playbackRate?: number;
    readonly ref?: Ref<PlayerHandle>;
    readonly source: PlayerSource;
    readonly volume?: number;
  };

const PlayerContext = createContext<PlayerContextValue | null>(null);
const PosterContext = createContext<'visible' | 'hidden'>('visible');

const usePlayer = (): PlayerContextValue => {
  const player = useContext(PlayerContext);
  if (!player)
    throw new Error(
      'Player hooks and primitives must be used inside Player.Root.'
    );
  return player;
};

const usePosterState = (): 'visible' | 'hidden' => useContext(PosterContext);

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

type Reconciliation<Value> = { value: Value };

const takeSuperseded = <Value,>(
  reconciliations: Reconciliation<Value>[],
  confirmed: Value
): boolean => {
  let matched = false;
  for (let index = reconciliations.length - 1; index >= 0; index -= 1) {
    if (!Object.is(reconciliations[index]?.value, confirmed)) continue;
    reconciliations.splice(index, 1);
    matched = true;
  }
  return matched;
};

export const usePlayerState = <Selected,>(
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
  return useSyncExternalStore(
    useCallback((cb) => controller.subscribeCues(cb), [controller]),
    () => controller.getActiveCues()
  );
};

export const usePlayerActions = (): PlayerActions => {
  const { controller } = usePlayer();
  return useMemo(
    () => ({
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
      requestFullscreen: controller.requestFullscreen,
      exitFullscreen: controller.exitFullscreen,
      requestPictureInPicture: controller.requestPictureInPicture,
      exitPictureInPicture: controller.exitPictureInPicture,
      showAirPlayPicker: controller.showAirPlayPicker,
      retry: controller.retry
    }),
    [controller]
  );
};

export const Root = ({
  autoplay = false,
  captionRenderer,
  children,
  defaultMuted = false,
  defaultPlaybackRate = 1,
  defaultVolume = 1,
  endTime,
  loadMargin = '200px 0px',
  loading = 'viewport',
  loop,
  mediaMetadata,
  muted,
  onMutedChange,
  onPlaybackRateChange,
  onVolumeChange,
  playbackRate,
  ref,
  source,
  startTime,
  preload = 'metadata',
  volume
}: RootProps) => {
  const [controller] = useState(() => new PlayerController());
  const [hiddenTransition, setHiddenTransition] = useState<SourceTransition>();
  const currentMedia = useRef<PlayerMediaMount | null>(null);
  const providerSourceTransition = useRef<SourceTransition | undefined>(
    undefined
  );
  const loadedDataListener = useRef<
    { media: HTMLVideoElement; listener: () => void } | undefined
  >(undefined);
  const embedPreferenceSeed = useRef<(() => void) | undefined>(undefined);
  const desiredMuted = useRef(muted ?? defaultMuted);
  const desiredVolume = useRef(volume ?? defaultVolume);
  const desiredPlaybackRate = useRef(playbackRate ?? defaultPlaybackRate);
  const lastConfirmedMuted = useRef(muted ?? defaultMuted);
  const lastConfirmedVolume = useRef(volume ?? defaultVolume);
  const lastConfirmedPlaybackRate = useRef(playbackRate ?? defaultPlaybackRate);
  const controlledMuted = useRef(muted);
  const controlledVolume = useRef(volume);
  const controlledPlaybackRate = useRef(playbackRate);
  const wasMutedControlled = useRef(muted !== undefined);
  const wasVolumeControlled = useRef(volume !== undefined);
  const wasPlaybackRateControlled = useRef(playbackRate !== undefined);
  const mutedChangeCallback = useRef(onMutedChange);
  const volumeChangeCallback = useRef(onVolumeChange);
  const playbackRateChangeCallback = useRef(onPlaybackRateChange);
  const autoplayConfiguration = useRef({ autoplay, muted });
  const pendingMuted = useRef<Reconciliation<boolean> | undefined>(undefined);
  const pendingVolume = useRef<Reconciliation<number> | undefined>(undefined);
  const pendingPlaybackRate = useRef<Reconciliation<number> | undefined>(
    undefined
  );
  const supersededMuted = useRef<Reconciliation<boolean>[]>([]);
  const supersededVolume = useRef<Reconciliation<number>[]>([]);
  const supersededPlaybackRate = useRef<Reconciliation<number>[]>([]);
  const preferenceUnsubscribe = useRef<(() => void) | undefined>(undefined);
  const mediaSessionBinding = useRef<MediaSessionBinding | undefined>(
    undefined
  );
  const mediaMetadataSeed = useRef(mediaMetadata);
  const detectedSource = useMemo(() => detectSource(source), [source]);
  const sourceKeyForRender = sourceKey(detectedSource);
  const [sourceTransition, setSourceTransition] = useState<SourceTransition>(
    () => ({ key: sourceKeyForRender })
  );
  if (sourceTransition.key !== sourceKeyForRender) {
    setSourceTransition({ key: sourceKeyForRender });
  }

  /* eslint-disable react-hooks/refs -- Provider callbacks need the current props before passive effects run. */
  controlledMuted.current = muted;
  controlledVolume.current = volume;
  controlledPlaybackRate.current = playbackRate;
  mutedChangeCallback.current = onMutedChange;
  volumeChangeCallback.current = onVolumeChange;
  playbackRateChangeCallback.current = onPlaybackRateChange;
  autoplayConfiguration.current = { autoplay, muted };
  mediaMetadataSeed.current = mediaMetadata;
  /* eslint-enable react-hooks/refs */

  useImperativeHandle(ref, () => controller, [controller]);

  const reconcileMuted = useCallback(
    (value: boolean) => {
      if (pendingMuted.current?.value === value) return;
      const pending = { value };
      pendingMuted.current = pending;
      void (value ? controller.mute() : controller.unmute()).then((result) => {
        if (!result.ok && pendingMuted.current === pending) {
          pendingMuted.current = undefined;
        } else if (!result.ok) {
          const index = supersededMuted.current.indexOf(pending);
          if (index !== -1) supersededMuted.current.splice(index, 1);
        }
      });
    },
    [controller]
  );

  const reconcileVolume = useCallback(
    (value: number) => {
      if (Object.is(pendingVolume.current?.value, value)) return;
      const pending = { value };
      pendingVolume.current = pending;
      void controller.setVolume(value).then((result) => {
        if (!result.ok && pendingVolume.current === pending) {
          pendingVolume.current = undefined;
        } else if (!result.ok) {
          const index = supersededVolume.current.indexOf(pending);
          if (index !== -1) supersededVolume.current.splice(index, 1);
        }
      });
    },
    [controller]
  );

  const reconcilePlaybackRate = useCallback(
    (value: number) => {
      if (Object.is(pendingPlaybackRate.current?.value, value)) return;
      const pending = { value };
      pendingPlaybackRate.current = pending;
      void controller.setPlaybackRate(value).then((result) => {
        if (!result.ok && pendingPlaybackRate.current === pending) {
          pendingPlaybackRate.current = undefined;
        } else if (!result.ok) {
          const index = supersededPlaybackRate.current.indexOf(pending);
          if (index !== -1) supersededPlaybackRate.current.splice(index, 1);
        }
      });
    },
    [controller]
  );

  const ensurePreferenceSubscription = useCallback(() => {
    if (preferenceUnsubscribe.current) return;
    const unsubscribeVolume = controller.on('volumechange', (event) => {
      const confirmedMuted = event.detail.muted;
      const confirmedVolume = event.detail.volume;
      const mutedRestoration = pendingMuted.current;
      const volumeRestoration = pendingVolume.current;
      const mutedRestorationMatches =
        mutedRestoration?.value === confirmedMuted;
      const mutedRetiredMatches = takeSuperseded(
        supersededMuted.current,
        confirmedMuted
      );
      const volumeRestorationMatches = Object.is(
        volumeRestoration?.value,
        confirmedVolume
      );
      const volumeRetiredMatches = takeSuperseded(
        supersededVolume.current,
        confirmedVolume
      );
      const mutedPropDriven = mutedRestorationMatches || mutedRetiredMatches;
      const volumePropDriven = volumeRestorationMatches || volumeRetiredMatches;

      pendingMuted.current = undefined;
      pendingVolume.current = undefined;
      if (controlledMuted.current === confirmedMuted) {
        supersededMuted.current.length = 0;
      }
      if (Object.is(controlledVolume.current, confirmedVolume)) {
        supersededVolume.current.length = 0;
      }
      if (lastConfirmedMuted.current !== confirmedMuted) {
        lastConfirmedMuted.current = confirmedMuted;
        if (!mutedPropDriven) {
          mutedChangeCallback.current?.(confirmedMuted);
        }
      }
      if (controlledMuted.current === undefined) {
        desiredMuted.current = confirmedMuted;
      } else if (controlledMuted.current !== confirmedMuted) {
        reconcileMuted(controlledMuted.current);
      }
      if (!Object.is(lastConfirmedVolume.current, confirmedVolume)) {
        lastConfirmedVolume.current = confirmedVolume;
        if (!volumePropDriven) {
          volumeChangeCallback.current?.(confirmedVolume);
        }
      }
      if (controlledVolume.current === undefined) {
        desiredVolume.current = confirmedVolume;
      } else if (!Object.is(controlledVolume.current, confirmedVolume)) {
        reconcileVolume(controlledVolume.current);
      }
    });
    const unsubscribeRate = controller.on('ratechange', (event) => {
      const confirmed = event.detail.playbackRate;
      const restoration = pendingPlaybackRate.current;
      const restorationMatches = Object.is(restoration?.value, confirmed);
      const retiredMatches = takeSuperseded(
        supersededPlaybackRate.current,
        confirmed
      );
      const propDriven = restorationMatches || retiredMatches;

      pendingPlaybackRate.current = undefined;
      if (Object.is(controlledPlaybackRate.current, confirmed)) {
        supersededPlaybackRate.current.length = 0;
      }
      if (!Object.is(lastConfirmedPlaybackRate.current, confirmed)) {
        lastConfirmedPlaybackRate.current = confirmed;
        if (!propDriven) playbackRateChangeCallback.current?.(confirmed);
      }
      if (controlledPlaybackRate.current === undefined) {
        desiredPlaybackRate.current = confirmed;
      } else if (!Object.is(controlledPlaybackRate.current, confirmed)) {
        reconcilePlaybackRate(controlledPlaybackRate.current);
      }
    });
    preferenceUnsubscribe.current = () => {
      unsubscribeVolume();
      unsubscribeRate();
    };
  }, [controller, reconcileMuted, reconcilePlaybackRate, reconcileVolume]);

  const detachPreparedMedia = useCallback(() => {
    const listener = loadedDataListener.current;
    if (listener) {
      listener.media.removeEventListener('loadeddata', listener.listener);
      loadedDataListener.current = undefined;
    }
    embedPreferenceSeed.current?.();
    embedPreferenceSeed.current = undefined;
    currentMedia.current = null;
    providerSourceTransition.current = undefined;
  }, []);

  const prepareMedia = useCallback(
    (media: PlayerMediaMount) => {
      detachPreparedMedia();
      currentMedia.current = media;
      providerSourceTransition.current = sourceTransition;
      pendingMuted.current = undefined;
      pendingVolume.current = undefined;
      pendingPlaybackRate.current = undefined;
      supersededMuted.current.length = 0;
      supersededVolume.current.length = 0;
      supersededPlaybackRate.current.length = 0;
      if (media instanceof HTMLVideoElement) {
        media.muted = controlledMuted.current ?? desiredMuted.current;
        const nextVolume = controlledVolume.current ?? desiredVolume.current;
        const nextPlaybackRate =
          controlledPlaybackRate.current ?? desiredPlaybackRate.current;
        if (Number.isFinite(nextVolume)) {
          try {
            media.volume = Math.min(1, Math.max(0, nextVolume));
          } catch {
            // Initial preference seeding must not escape the provider boundary.
          }
        }
        if (Number.isFinite(nextPlaybackRate) && nextPlaybackRate > 0) {
          try {
            media.playbackRate = nextPlaybackRate;
          } catch {
            // Initial preference seeding must not escape the provider boundary.
          }
        }
      }
      ensurePreferenceSubscription();
      controller.configureAutoplay(autoplayConfiguration.current.autoplay, {
        controlledMuted: autoplayConfiguration.current.muted
      });
      if (!(media instanceof HTMLVideoElement)) {
        // Embed mounts have no seedable element properties, so replay the
        // desired preferences through provider commands once the provider
        // confirms ready state. No confirmed user change can land earlier:
        // commands against a non-ready provider fail as not-ready.
        const seedTransition = sourceTransition;
        const subscription: { unsubscribe?: () => void } = {};
        let disposed = false;
        const dispose = (): void => {
          if (disposed) return;
          disposed = true;
          subscription.unsubscribe?.();
          if (embedPreferenceSeed.current === dispose) {
            embedPreferenceSeed.current = undefined;
          }
        };
        embedPreferenceSeed.current = dispose;
        subscription.unsubscribe = controller.subscribe((state) => {
          if (disposed) return;
          if (
            currentMedia.current !== media ||
            providerSourceTransition.current !== seedTransition
          ) {
            dispose();
            return;
          }
          if (state.lifecycle !== 'ready' || state.activation !== 'ready') {
            return;
          }
          dispose();
          const nextMuted = controlledMuted.current ?? desiredMuted.current;
          const nextVolume = controlledVolume.current ?? desiredVolume.current;
          const nextPlaybackRate =
            controlledPlaybackRate.current ?? desiredPlaybackRate.current;
          if (state.muted !== nextMuted) reconcileMuted(nextMuted);
          if (Number.isFinite(nextVolume)) {
            const boundedVolume = Math.min(1, Math.max(0, nextVolume));
            if (!Object.is(state.volume, boundedVolume)) {
              reconcileVolume(boundedVolume);
            }
          }
          if (
            Number.isFinite(nextPlaybackRate) &&
            nextPlaybackRate > 0 &&
            !Object.is(state.playbackRate, nextPlaybackRate)
          ) {
            reconcilePlaybackRate(nextPlaybackRate);
          }
        });
        if (disposed) subscription.unsubscribe();
        return;
      }
      const attachedSourceTransition = sourceTransition;
      const onLoadedData = () => {
        if (
          currentMedia.current === media &&
          providerSourceTransition.current === attachedSourceTransition
        ) {
          setHiddenTransition(attachedSourceTransition);
        }
      };
      media.addEventListener('loadeddata', onLoadedData);
      loadedDataListener.current = { media, listener: onLoadedData };
      if (media.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
        onLoadedData();
      }
    },
    [
      controller,
      detachPreparedMedia,
      ensurePreferenceSubscription,
      reconcileMuted,
      reconcilePlaybackRate,
      reconcileVolume,
      sourceTransition
    ]
  );

  const activation = useActivation({
    autoplay,
    controller,
    loadMargin,
    loading,
    nativeOptions: { endTime, loop, startTime },
    prepareMedia,
    preload,
    source: detectedSource
  });
  const registerActivationMedia = activation.registerMedia;
  const registerMedia = useCallback(
    (media: PlayerMediaMount | null) => {
      if (!media) detachPreparedMedia();
      registerActivationMedia(media);
    },
    [detachPreparedMedia, registerActivationMedia]
  );

  useEffect(() => {
    const unsubscribePoster = controller.subscribe((state) => {
      if (state.playback === 'playing' && providerSourceTransition.current) {
        setHiddenTransition(providerSourceTransition.current);
      }
    });
    return () => {
      unsubscribePoster();
      preferenceUnsubscribe.current?.();
      preferenceUnsubscribe.current = undefined;
      detachPreparedMedia();
    };
  }, [controller, detachPreparedMedia]);

  useEffect(() => {
    controller.configureAutoplay(autoplay, { controlledMuted: muted });
  }, [autoplay, controller, muted]);

  useEffect(() => {
    controller.setCaptionRenderer(captionRenderer ?? 'custom');
  }, [captionRenderer, controller]);

  useEffect(() => {
    if (muted === undefined) {
      pendingMuted.current = undefined;
      supersededMuted.current.length = 0;
      if (wasMutedControlled.current) {
        desiredMuted.current = controller.getState().muted;
      }
      wasMutedControlled.current = false;
      return;
    }
    wasMutedControlled.current = true;
    if (pendingMuted.current && pendingMuted.current.value !== muted) {
      supersededMuted.current.push(pendingMuted.current);
      pendingMuted.current = undefined;
    }
    if (controller.getState().muted !== muted) {
      reconcileMuted(muted);
    }
  }, [controller, muted, reconcileMuted]);

  useEffect(() => {
    if (volume === undefined) {
      pendingVolume.current = undefined;
      supersededVolume.current.length = 0;
      if (wasVolumeControlled.current) {
        desiredVolume.current = controller.getState().volume;
      }
      wasVolumeControlled.current = false;
      return;
    }
    wasVolumeControlled.current = true;
    if (
      pendingVolume.current &&
      !Object.is(pendingVolume.current.value, volume)
    ) {
      supersededVolume.current.push(pendingVolume.current);
      pendingVolume.current = undefined;
    }
    if (!Object.is(controller.getState().volume, volume)) {
      reconcileVolume(volume);
    }
  }, [controller, reconcileVolume, volume]);

  useEffect(() => {
    if (playbackRate === undefined) {
      pendingPlaybackRate.current = undefined;
      supersededPlaybackRate.current.length = 0;
      if (wasPlaybackRateControlled.current) {
        desiredPlaybackRate.current = controller.getState().playbackRate;
      }
      wasPlaybackRateControlled.current = false;
      return;
    }
    wasPlaybackRateControlled.current = true;
    if (
      pendingPlaybackRate.current &&
      !Object.is(pendingPlaybackRate.current.value, playbackRate)
    ) {
      supersededPlaybackRate.current.push(pendingPlaybackRate.current);
      pendingPlaybackRate.current = undefined;
    }
    if (!Object.is(controller.getState().playbackRate, playbackRate)) {
      reconcilePlaybackRate(playbackRate);
    }
  }, [controller, playbackRate, reconcilePlaybackRate]);

  // Media Session: bind confirmed playback to the single, document-scoped
  // coordinator. Re-runs on source change so the effect cleanup releases the
  // previous binding (and clears the shared surface only if this root still
  // owns it). Ownership follows the most-recently-playing root across roots.
  useEffect(() => {
    const mediaSession =
      typeof navigator !== 'undefined'
        ? // navigator.mediaSession is a DOM type; the coordinator is
          // DOM-agnostic and keys on this object's identity.
          (navigator.mediaSession as unknown as MediaSessionLike | undefined)
        : undefined;
    if (!mediaSession) return;
    const binding = bindMediaSession(
      controller,
      getMediaSessionCoordinator(mediaSession),
      { metadata: mediaMetadataSeed.current ?? null }
    );
    mediaSessionBinding.current = binding;
    return () => {
      binding.release();
      mediaSessionBinding.current = undefined;
    };
  }, [controller, sourceKeyForRender]);

  useEffect(() => {
    mediaSessionBinding.current?.setMetadata(mediaMetadata ?? null);
  }, [mediaMetadata]);

  const value = useMemo(
    () => ({
      controller,
      source: detectedSource,
      ...activation,
      registerMedia
    }),
    [activation, controller, detectedSource, registerMedia]
  );
  const posterState =
    hiddenTransition === sourceTransition ? 'hidden' : 'visible';

  return (
    <PlayerContext.Provider value={value}>
      <PosterContext.Provider value={posterState}>
        {children}
      </PosterContext.Provider>
    </PlayerContext.Provider>
  );
};

const assignRef = <Value,>(
  ref: Ref<Value> | undefined,
  value: Value | null
): (() => void) | undefined => {
  if (typeof ref === 'function') {
    const cleanup = ref(value);
    return typeof cleanup === 'function' ? cleanup : undefined;
  } else if (ref) {
    ref.current = value;
  }
};

export const Viewport = ({ children, ref, style, ...rest }: ViewportProps) => {
  const { registerViewport } = usePlayer();
  const viewportNode = useRef<HTMLDivElement | null>(null);
  const mergedRef = useCallback(
    (node: HTMLDivElement | null) => {
      viewportNode.current = node;
      registerViewport(node);
      if (!node) return;
      return () => {
        viewportNode.current = null;
        registerViewport(null);
      };
    },
    [registerViewport]
  );
  useEffect(() => {
    const node = viewportNode.current;
    if (!node) return;
    const consumerCleanup = assignRef(ref, node);
    return () => {
      if (consumerCleanup) {
        consumerCleanup();
      } else {
        assignRef(ref, null);
      }
    };
  }, [ref]);
  return (
    <div
      {...rest}
      data-reely-part="viewport"
      ref={mergedRef}
      style={{ ...style, position: 'relative', overflow: 'hidden' }}
    >
      {children}
    </div>
  );
};

const sourceKey = (source: ReturnType<typeof detectSource>): string =>
  source.status === 'success'
    ? JSON.stringify(source.source)
    : 'unsupported-source';

export const Media = ({
  nativePoster,
  ref,
  style,
  textTracks,
  'aria-label': ariaLabel,
  ...rest
}: MediaProps) => {
  const { mediaEligible, preload, registerMedia, source } = usePlayer();
  // Merge the consumer ref onto the internal registration inside one callback
  // ref (rather than Viewport's stable-callback + separate `[ref]` effect):
  // Media is eligibility-gated and mounts its <video> late, so a `[ref]`
  // effect would run before the element exists and never forward the ref when
  // it finally mounts. Consumer refs on Media are expected to be stable; the
  // trade-off is that a volatile (inline) ref re-runs this callback each
  // render — behavior-preserving, verified to not reload the provider. Only
  // the native <video> branch attaches this; the iframe mounts aren't a video
  // element. Declared before the eligibility returns to keep hook order stable.
  const mediaRef = useCallback(
    (node: HTMLVideoElement | null) => {
      registerMedia(node);
      const consumerCleanup = assignRef(ref, node);
      if (!node) return;
      return () => {
        registerMedia(null);
        if (consumerCleanup) consumerCleanup();
        else assignRef(ref, null);
      };
    },
    [registerMedia, ref]
  );
  if (!mediaEligible || source.status === 'failure') {
    return null;
  }

  if (source.source.type === 'youtube') {
    // A plain mount for the YouTube iframe. The provider chrome inside the
    // iframe is the single control layer; Reely renders nothing over it.
    return (
      <div
        data-reely-part="media"
        key={sourceKey(source)}
        ref={registerMedia}
        style={{
          position: 'relative',
          zIndex: 0,
          width: '100%',
          height: '100%'
        }}
      />
    );
  }

  if (source.source.type === 'vimeo') {
    // A mount for the Vimeo iframe embed. When chromeless controls are
    // plan-gated, Vimeo's own controls stay the single layer; Reely renders
    // nothing over the embed.
    return (
      <div
        data-reely-part="media"
        key={sourceKey(source)}
        ref={registerMedia}
        style={{
          position: 'relative',
          zIndex: 0,
          width: '100%',
          height: '100%'
        }}
      />
    );
  }

  if (source.source.type !== 'video' && source.source.type !== 'hls') {
    return null;
  }

  return (
    <video
      playsInline
      {...rest}
      aria-label={ariaLabel ?? 'Reely media'}
      data-reely-part="media"
      key={sourceKey(source)}
      poster={nativePoster}
      preload={preload}
      ref={mediaRef}
      style={{ position: 'relative', zIndex: 0, ...style }}
    >
      {source.source.type === 'video'
        ? source.source.sources.map(({ mimeType, src }, index) => (
            <source
              key={`${src}:${mimeType}:${index}`}
              src={src}
              type={mimeType}
            />
          ))
        : // The HLS provider owns the media source: the native engine assigns
          // the manifest URL and hls.js attaches Media Source Extensions.
          null}
      {textTracks?.map(({ src, srcLang, label, kind, default: isDefault }) => (
        <track
          key={`${src}:${srcLang}`}
          default={isDefault}
          kind={kind ?? 'captions'}
          label={label}
          src={src}
          srcLang={srcLang}
        />
      ))}
    </video>
  );
};

export const Poster = ({ children, style, ...safeRest }: PosterProps) => {
  const posterState = usePosterState();

  return (
    <div
      {...safeRest}
      aria-hidden="true"
      data-reely-part="poster"
      data-state={posterState}
      style={{
        ...style,
        position: 'absolute',
        inset: 0,
        width: '100%',
        height: '100%',
        zIndex: 10,
        pointerEvents: 'none',
        transform: 'none',
        visibility: posterState === 'hidden' ? 'hidden' : 'visible'
      }}
    >
      {children}
    </div>
  );
};

export type ActivationButtonProps = ComponentPropsWithRef<'button'>;

export const ActivationButton = ({
  'aria-label': ariaLabel,
  children,
  onClick,
  style,
  ...props
}: ActivationButtonProps) => {
  const { activateFromInteraction, loading } = usePlayer();
  const { activation, error } = usePlayerState((state) => ({
    activation: state.activation,
    error: state.error
  }));
  if (loading !== 'interaction' || activation === 'ready') return null;
  const isError = activation === 'error';
  const isLoading = activation === 'loading-provider';
  const isConfigurationError = isError && error?.category === 'configuration';
  const isDisabled = isLoading || isConfigurationError;
  const label = ariaLabel ?? (isError ? 'Retry loading video' : 'Play video');
  return (
    <button
      {...props}
      aria-disabled={isDisabled || undefined}
      aria-label={label}
      data-reely-part="activation"
      data-state={activation}
      onClick={(event) => {
        onClick?.(event);
        if (!event.defaultPrevented && !isDisabled) {
          activateFromInteraction();
        }
      }}
      style={{
        ...style,
        position: 'absolute',
        inset: 0,
        zIndex: 30
      }}
      type="button"
    >
      {children ?? (isError ? 'Retry' : 'Play')}
    </button>
  );
};

export type LoadingIndicatorProps = ComponentPropsWithRef<'div'>;

export const LoadingIndicator = ({
  children,
  style,
  ...props
}: LoadingIndicatorProps) => {
  const { activation, buffering } = usePlayerState((state) => ({
    activation: state.activation,
    buffering: state.buffering
  }));
  const active =
    activation === 'loading-provider'
      ? 'loading-provider'
      : activation !== 'error' && buffering
        ? 'buffering'
        : null;
  // The live region stays mounted (empty when idle) so a screen reader
  // announces the buffering/loading transition. A region that mounts already
  // populated is typically not announced.
  return (
    <div
      {...props}
      aria-live="polite"
      data-reely-part="loading-indicator"
      data-state={active ?? 'idle'}
      role="status"
      style={{
        ...style,
        position: 'absolute',
        inset: 0,
        zIndex: 30,
        pointerEvents: 'none'
      }}
    >
      {active
        ? (children ??
          (active === 'loading-provider' ? 'Loading video' : 'Buffering'))
        : null}
    </div>
  );
};

/**
 * Render-prop context handed to `ErrorDisplay` children. `retry` is `null`
 * when the current error is not recoverable, so custom renderers stay
 * capability-aware — a retry action is never offered where the provider has
 * nothing to retry.
 */
export type ErrorDisplayRenderProps = {
  readonly error: PlayerError;
  readonly retry: (() => void) | null;
};

export type ErrorDisplayProps = Omit<
  ComponentPropsWithRef<'div'>,
  'children'
> & {
  readonly children?: (context: ErrorDisplayRenderProps) => ReactNode;
};

export const ErrorDisplay = ({
  children,
  style,
  ...props
}: ErrorDisplayProps) => {
  const { error, provider } = usePlayerState((state) => ({
    error: state.error,
    provider: state.provider
  }));
  const { controller } = usePlayer();
  if (!error) return null;
  // `recoverable` is the state-level signal that the provider offers a retry.
  // Absent — not disabled — when it does not (issue #34 capability rule).
  const retry = error.recoverable
    ? () => {
        void controller.retry();
      }
    : null;

  return (
    <div
      {...props}
      data-provider={provider ?? undefined}
      data-reely-part="error"
      data-state={error.category}
      role="alert"
      style={{
        ...style,
        position: 'absolute',
        inset: 0,
        zIndex: 40
      }}
    >
      {children ? (
        children({ error, retry })
      ) : (
        <>
          <p data-reely-part="error-message">{error.message}</p>
          {retry && (
            <button
              data-reely-part="error-retry"
              onClick={retry}
              style={controlTargetStyle}
              type="button"
            >
              Retry
            </button>
          )}
        </>
      )}
    </div>
  );
};

export type CaptionsProps = Omit<ComponentPropsWithRef<'div'>, 'children'> & {
  readonly renderCue?: (cue: TextCue) => ReactNode;
};

// User-themeable CSS custom properties consumed by the default cue text box
// below. Set these on `Player.Captions` (or an ancestor) to theme the
// overlay without overriding its structure:
//   --reely-caption-font-size  - cue text font size (default: 1.05rem)
//   --reely-caption-color      - cue text color (default: #fff)
//   --reely-caption-background - cue text box background (default: rgba(0, 0, 0, 0.75))
//   --reely-caption-edge       - cue text edge, a text-shadow value (default: none)
const captionsOverlayStyle: CSSProperties = {
  position: 'absolute',
  left: 0,
  right: 0,
  bottom: 0,
  zIndex: 20,
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  gap: '0.3em',
  paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 1.2em)',
  paddingLeft: 'env(safe-area-inset-left, 0px)',
  paddingRight: 'env(safe-area-inset-right, 0px)',
  pointerEvents: 'none'
};

const captionCueBoxStyle: CSSProperties = {
  fontSize: 'var(--reely-caption-font-size, 1.05rem)',
  color: 'var(--reely-caption-color, #fff)',
  backgroundColor: 'var(--reely-caption-background, rgba(0, 0, 0, 0.75))',
  textShadow: 'var(--reely-caption-edge, none)',
  padding: '0.15em 0.4em',
  borderRadius: '0.2em'
};

// Strips a cue down to its public shape before handing it to consumer code
// (renderCue), so engine-only fields on a provider's cue objects never leak.
const normalizeCue = (cue: TextCue): TextCue => ({
  id: cue.id,
  startTime: cue.startTime,
  endTime: cue.endTime,
  text: cue.text
});

const isRenderableCue = (cue: TextCue): boolean =>
  typeof cue?.text === 'string' && cue.text.trim().length > 0;

const defaultCueRenderer = (cue: TextCue): ReactNode =>
  cue.text.split('\n').map((line, index) => (
    <div data-reely-part="caption-line" key={index}>
      {line}
    </div>
  ));

export const Captions = ({ renderCue, style, ...props }: CaptionsProps) => {
  const captionRendering = usePlayerState((state) => state.captionRendering);
  const cues = useActiveCues();
  if (captionRendering !== 'custom') return null;

  return (
    <div
      {...props}
      data-reely-part="captions"
      data-state="custom"
      style={{ ...captionsOverlayStyle, ...style }}
    >
      {cues.filter(isRenderableCue).map((cue, index) => {
        const normalized = normalizeCue(cue);
        return (
          <div
            data-reely-part="caption-cue"
            key={`${normalized.id ?? ''}:${normalized.startTime}:${normalized.endTime}:${index}`}
            style={renderCue ? undefined : captionCueBoxStyle}
          >
            {renderCue ? renderCue(normalized) : defaultCueRenderer(normalized)}
          </div>
        );
      })}
    </div>
  );
};

type PosterImageState = 'idle' | 'loading' | 'loaded' | 'error';

const posterRequestKey = ({ src, srcSet, sizes }: PosterImageProps): string =>
  `${src ?? ''}\u0000${srcSet ?? ''}\u0000${sizes ?? ''}`;

const initialPosterImageState = (
  src?: string,
  srcSet?: string
): PosterImageState => (src || srcSet ? 'loading' : 'idle');

export const PosterImage = ({
  src,
  srcSet,
  sizes,
  width,
  height,
  loading,
  fetchPriority,
  decoding,
  objectFit,
  objectPosition,
  onLoad,
  onError,
  style,
  ...safeRest
}: PosterImageProps) => {
  const requestKey = posterRequestKey({ src, srcSet, sizes });
  const state = useRef<{
    key: string;
    state: PosterImageState;
  }>({
    key: requestKey,
    state: initialPosterImageState(src, srcSet)
  });
  const [, rerender] = useState(0);
  /* eslint-disable react-hooks/refs -- The request signature must reset visible state during this render. */
  if (state.current.key !== requestKey) {
    state.current = {
      key: requestKey,
      state: initialPosterImageState(src, srcSet)
    };
  }
  const posterImageState = state.current.state;
  /* eslint-enable react-hooks/refs */

  const updateState = (nextState: PosterImageState) => {
    if (state.current.key !== requestKey) return;
    state.current = { key: requestKey, state: nextState };
    rerender((value) => value + 1);
  };

  // Cached images can finish loading before React attaches onLoad/onError, so
  // those events never fire and `data-state` would stay 'loading' forever.
  // On mount and whenever the request changes, resolve an already-complete
  // image from its `complete`/`naturalWidth` (broken images are complete with
  // zero natural width).
  const imageRef = useRef<HTMLImageElement>(null);
  useEffect(() => {
    if (state.current.state !== 'loading') return;
    const image = imageRef.current;
    if (!image || !image.complete) return;
    updateState(image.naturalWidth > 0 ? 'loaded' : 'error');
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on requestKey; updateState reads the current ref snapshot.
  }, [requestKey]);

  /* eslint-disable react-hooks/refs -- posterImageState is the synchronous keyed-state snapshot above. */
  return (
    <img
      {...safeRest}
      alt=""
      data-reely-part="poster-image"
      ref={imageRef}
      data-state={posterImageState}
      decoding={decoding}
      fetchPriority={fetchPriority}
      height={height}
      loading={loading}
      onError={(event) => {
        updateState('error');
        onError?.(event);
      }}
      onLoad={(event) => {
        updateState('loaded');
        onLoad?.(event);
      }}
      sizes={sizes}
      src={src}
      srcSet={srcSet}
      style={{
        ...style,
        display: 'block',
        width: '100%',
        height: '100%',
        objectFit: (objectFit ??
          'var(--reely-poster-fit, cover)') as CSSProperties['objectFit'],
        objectPosition: objectPosition ?? 'var(--reely-poster-position, center)'
      }}
      width={width}
    />
  );
  /* eslint-enable react-hooks/refs */
};

const controlTargetStyle: CSSProperties = { minWidth: 44, minHeight: 44 };

const formatTime = (totalSeconds: number): string => {
  const clamped = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(clamped / 3600);
  const minutes = Math.floor((clamped % 3600) / 60);
  const seconds = clamped % 60;
  const pad = (value: number): string => String(value).padStart(2, '0');
  return hours > 0
    ? `${hours}:${pad(minutes)}:${pad(seconds)}`
    : `${minutes}:${pad(seconds)}`;
};

export type PlayButtonProps = ComponentPropsWithRef<'button'>;

export const PlayButton = ({
  children,
  onClick,
  style,
  ...props
}: PlayButtonProps) => {
  const { autoplay, playback, provider } = usePlayerState((state) => ({
    autoplay: state.autoplay,
    playback: state.playback,
    provider: state.provider
  }));
  const { controller } = usePlayer();
  const isPlaying = playback === 'playing';

  return (
    <button
      {...props}
      aria-label={isPlaying ? 'Pause' : 'Play'}
      aria-pressed={isPlaying}
      data-autoplay-state={autoplay}
      data-provider={provider ?? undefined}
      data-reely-part="play-button"
      data-state={playback}
      onClick={(event) => {
        onClick?.(event);
        if (!event.defaultPrevented) {
          void controller.togglePlaybackWithOrigin('user');
        }
      }}
      style={{ ...controlTargetStyle, ...style }}
      type="button"
    >
      {children ?? (isPlaying ? 'Pause' : 'Play')}
    </button>
  );
};

export type MuteButtonProps = ComponentPropsWithRef<'button'>;

export const MuteButton = ({
  children,
  onClick,
  style,
  ...props
}: MuteButtonProps) => {
  const { muted, provider, status } = usePlayerState((state) => ({
    muted: state.muted,
    provider: state.provider,
    status: state.capabilities.setVolume.status
  }));
  const { controller } = usePlayer();
  if (status !== 'available') return null;

  return (
    <button
      {...props}
      aria-label={muted ? 'Unmute' : 'Mute'}
      aria-pressed={muted}
      data-provider={provider ?? undefined}
      data-reely-part="mute-button"
      data-state={muted ? 'muted' : 'unmuted'}
      onClick={(event) => {
        onClick?.(event);
        if (!event.defaultPrevented) void controller.toggleMuted();
      }}
      style={{ ...controlTargetStyle, ...style }}
      type="button"
    >
      {children ?? (muted ? 'Unmute' : 'Mute')}
    </button>
  );
};

export type VolumeSliderProps = ComponentPropsWithRef<'input'>;

export const VolumeSlider = ({
  'aria-label': ariaLabel,
  onChange,
  step,
  style,
  ...props
}: VolumeSliderProps) => {
  const { muted, provider, status, volume } = usePlayerState((state) => ({
    muted: state.muted,
    provider: state.provider,
    status: state.capabilities.setVolume.status,
    volume: state.volume
  }));
  const { controller } = usePlayer();
  if (status !== 'available') return null;
  const value = muted ? 0 : volume;
  const percent = Math.round(value * 100);

  return (
    <input
      {...props}
      aria-label={ariaLabel ?? 'Volume'}
      aria-valuetext={`${percent}%`}
      data-provider={provider ?? undefined}
      data-reely-part="volume-slider"
      data-state={muted ? 'muted' : 'unmuted'}
      max={1}
      min={0}
      onChange={(event) => {
        onChange?.(event);
        if (event.defaultPrevented) return;
        const next = Number(event.currentTarget.value);
        if (!Number.isFinite(next)) return;
        if (muted && next > 0) void controller.unmute();
        void controller.setVolume(next);
      }}
      step={step ?? 0.05}
      style={{ ...controlTargetStyle, ...style }}
      type="range"
      value={value}
    />
  );
};

export type SeekSliderProps = ComponentPropsWithRef<'div'> & {
  // Escape hatch onto the inner range control (aria-label, step, disabled,
  // id/name, data-*, onChange, style). The library keeps ownership of the
  // controlled attributes (value/min/max/type/aria-valuetext); consumer
  // onChange is chained after the seek.
  readonly inputProps?: ComponentPropsWithRef<'input'>;
};

// The scrubbable range: [0, duration] for VOD, or the seekable window extent
// for live DVR where duration is null but a moving window is present.
const seekWindow = (
  duration: number | null,
  seekable: ReadonlyArray<TimeRange>
): { readonly start: number; readonly end: number } | null => {
  if (typeof duration === 'number' && duration > 0) {
    return { start: 0, end: duration };
  }
  if (seekable.length === 0) return null;
  const start = Math.min(...seekable.map((range) => range.start));
  const end = Math.max(...seekable.map((range) => range.end));
  return end > start ? { start, end } : null;
};

export const SeekSlider = ({
  children,
  inputProps,
  style,
  ...props
}: SeekSliderProps) => {
  const { buffered, currentTime, duration, provider, seekable, status } =
    usePlayerState((state) => ({
      buffered: state.buffered,
      currentTime: state.currentTime,
      duration: state.duration,
      provider: state.provider,
      seekable: state.seekable,
      status: state.capabilities.seek.status
    }));
  const { controller } = usePlayer();
  if (status !== 'available') return null;
  const hasDuration = typeof duration === 'number' && duration > 0;
  const window = seekWindow(duration, seekable);
  const min = window ? window.start : 0;
  const max = window ? window.end : 0;
  const span = max - min;
  const value = window ? Math.min(Math.max(currentTime, min), max) : 0;

  return (
    <div
      {...props}
      data-provider={provider ?? undefined}
      data-reely-part="seek-slider"
      data-state={window ? 'ready' : 'idle'}
      style={{ position: 'relative', minHeight: 44, ...style }}
    >
      <div aria-hidden="true" data-reely-part="seek-buffered">
        {window
          ? buffered.map((range, index) => (
              <div
                data-reely-part="seek-buffered-range"
                key={`${range.start}:${range.end}:${index}`}
                style={{
                  position: 'absolute',
                  left: `${(Math.max(range.start - min, 0) / span) * 100}%`,
                  width: `${((range.end - range.start) / span) * 100}%`
                }}
              />
            ))
          : null}
      </div>
      <input
        aria-label="Seek"
        step={1}
        {...inputProps}
        aria-valuetext={
          hasDuration
            ? `${formatTime(value)} of ${formatTime(duration)}`
            : formatTime(value)
        }
        data-reely-part="seek-slider-input"
        max={max}
        min={min}
        onChange={(event) => {
          const next = Number(event.currentTarget.value);
          if (Number.isFinite(next)) void controller.seekTo(next);
          inputProps?.onChange?.(event);
        }}
        style={{ width: '100%', minHeight: 44, ...inputProps?.style }}
        type="range"
        value={value}
      />
      {children}
    </div>
  );
};

export type TimeProps = ComponentPropsWithRef<'time'> & {
  readonly type?: 'current' | 'duration' | 'remaining';
};

export const Time = ({ children, type = 'current', ...props }: TimeProps) => {
  const { currentTime, duration, provider } = usePlayerState((state) => ({
    currentTime: state.currentTime,
    duration: state.duration,
    provider: state.provider
  }));
  const hasDuration = typeof duration === 'number' && Number.isFinite(duration);
  const seconds =
    type === 'duration'
      ? hasDuration
        ? duration
        : 0
      : type === 'remaining'
        ? hasDuration
          ? Math.max(0, duration - currentTime)
          : 0
        : currentTime;
  const formatted = formatTime(seconds);
  const display =
    type === 'remaining' && seconds > 0 ? `-${formatted}` : formatted;

  return (
    <time
      {...props}
      dateTime={`PT${Math.max(0, Math.floor(seconds))}S`}
      data-provider={provider ?? undefined}
      data-reely-part="time"
      data-state={hasDuration ? 'timed' : 'untimed'}
      data-time-type={type}
    >
      {children ?? display}
    </time>
  );
};

export type FullscreenButtonProps = ComponentPropsWithRef<'button'>;

export const FullscreenButton = ({
  children,
  onClick,
  style,
  ...props
}: FullscreenButtonProps) => {
  const { fullscreen, provider, status } = usePlayerState((state) => ({
    fullscreen: state.fullscreen,
    provider: state.provider,
    status: state.capabilities.fullscreen.status
  }));
  const { controller } = usePlayer();
  if (status !== 'available') return null;

  return (
    <button
      {...props}
      aria-label={fullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}
      aria-pressed={fullscreen}
      data-provider={provider ?? undefined}
      data-reely-part="fullscreen-button"
      data-state={fullscreen ? 'active' : 'inline'}
      onClick={(event) => {
        onClick?.(event);
        if (event.defaultPrevented) return;
        void (fullscreen
          ? controller.exitFullscreen()
          : controller.requestFullscreen());
      }}
      style={{ ...controlTargetStyle, ...style }}
      type="button"
    >
      {children ?? (fullscreen ? 'Exit fullscreen' : 'Enter fullscreen')}
    </button>
  );
};

export type PipButtonProps = ComponentPropsWithRef<'button'>;

export const PipButton = ({
  children,
  onClick,
  style,
  ...props
}: PipButtonProps) => {
  const { pictureInPicture, provider, status } = usePlayerState((state) => ({
    pictureInPicture: state.pictureInPicture,
    provider: state.provider,
    status: state.capabilities.pictureInPicture.status
  }));
  const { controller } = usePlayer();
  if (status !== 'available') return null;

  return (
    <button
      {...props}
      aria-label={
        pictureInPicture
          ? 'Exit picture-in-picture'
          : 'Enter picture-in-picture'
      }
      aria-pressed={pictureInPicture}
      data-provider={provider ?? undefined}
      data-reely-part="pip-button"
      data-state={pictureInPicture ? 'active' : 'inline'}
      onClick={(event) => {
        onClick?.(event);
        if (event.defaultPrevented) return;
        void (pictureInPicture
          ? controller.exitPictureInPicture()
          : controller.requestPictureInPicture());
      }}
      style={{ ...controlTargetStyle, ...style }}
      type="button"
    >
      {children ??
        (pictureInPicture
          ? 'Exit picture-in-picture'
          : 'Enter picture-in-picture')}
    </button>
  );
};

/**
 * Resolves what a captions toggle (button click or `C` shortcut) should do
 * next, given the current tracks/selection and the last non-null selection
 * remembered across toggles. Returns `null` to turn captions off, a track id
 * to turn them on, or `undefined` when there is nothing to select (no
 * remembered or first track) — the caller should no-op in that case.
 */
const resolveCaptionToggle = (
  textTracks: readonly TextTrack[],
  selectedId: string | null,
  rememberedId: string | null
): string | null | undefined => {
  if (selectedId !== null) return null;
  return textTracks.find((t) => t.id === rememberedId)?.id ?? textTracks[0]?.id;
};

const visuallyHiddenStyle: CSSProperties = {
  position: 'absolute',
  width: 1,
  height: 1,
  padding: 0,
  margin: -1,
  overflow: 'hidden',
  clip: 'rect(0, 0, 0, 0)',
  whiteSpace: 'nowrap',
  border: 0
};

export type CaptionsButtonProps = ComponentPropsWithRef<'button'>;

export const CaptionsButton = ({
  children,
  onClick,
  style,
  ...props
}: CaptionsButtonProps) => {
  const { provider, selectedId, status, textTracks } = usePlayerState(
    (state) => ({
      provider: state.provider,
      selectedId: state.selectedTextTrackId,
      status: state.capabilities.selectTextTrack.status,
      textTracks: state.textTracks
    })
  );
  const { controller } = usePlayer();
  const lastSelectedId = useRef<string | null>(null);
  /* eslint-disable react-hooks/refs -- remember the last non-null selection synchronously so toggling captions back on restores it. */
  if (selectedId !== null) lastSelectedId.current = selectedId;
  /* eslint-enable react-hooks/refs */
  // One-time announcement: track the previously seen selection so the live
  // region text only changes (and is only announced) on an actual
  // transition, not on every unrelated re-render.
  const previousSelectedId = useRef<string | null>(selectedId);
  const announcement = useRef<string>('');
  /* eslint-disable react-hooks/refs -- computed synchronously per render, mirroring lastSelectedId above, so the announcement updates on the same render as the transition. */
  if (previousSelectedId.current !== selectedId) {
    const label = textTracks.find((t) => t.id === selectedId)?.label;
    announcement.current =
      selectedId !== null ? `${label ?? ''} captions on` : 'Captions off';
    previousSelectedId.current = selectedId;
  }
  const announcementText = announcement.current;
  /* eslint-enable react-hooks/refs */
  if (status !== 'available') return null;
  const on = selectedId !== null;

  return (
    <>
      <button
        {...props}
        aria-label={on ? 'Captions on' : 'Captions off'}
        aria-pressed={on}
        data-provider={provider ?? undefined}
        data-reely-part="captions-button"
        data-state={on ? 'on' : 'off'}
        onClick={(event) => {
          onClick?.(event);
          if (event.defaultPrevented) return;
          const next = resolveCaptionToggle(
            textTracks,
            selectedId,
            lastSelectedId.current
          );
          if (next !== undefined) void controller.selectTextTrack(next);
        }}
        style={{ ...controlTargetStyle, ...style }}
        type="button"
      >
        {children ?? <CaptionsIcon />}
      </button>
      {/* Announces only the control-change message ("<label> captions on" /
          "Captions off"); cue text must never enter a live region. */}
      <div
        aria-live="polite"
        data-reely-part="captions-announcer"
        style={visuallyHiddenStyle}
      >
        {announcementText}
      </div>
    </>
  );
};

type ShortcutEvent = {
  readonly key: string;
  readonly altKey: boolean;
  readonly ctrlKey: boolean;
  readonly metaKey: boolean;
  readonly target: EventTarget | null;
  readonly defaultPrevented: boolean;
  readonly preventDefault: () => void;
};

const isEditableTarget = (node: EventTarget | null): boolean => {
  if (!(node instanceof HTMLElement)) return false;
  const tag = node.tagName;
  return (
    tag === 'INPUT' ||
    tag === 'TEXTAREA' ||
    tag === 'SELECT' ||
    node.isContentEditable
  );
};

const isInOpenMenu = (node: EventTarget | null): boolean =>
  node instanceof HTMLElement &&
  node.closest(
    '[role="menu"], [role="menubar"], [role="listbox"], [data-reely-menu="open"]'
  ) !== null;

const isNativeActivationTarget = (node: EventTarget | null): boolean =>
  node instanceof HTMLElement &&
  node.closest('button, [role="button"], a[href], summary') !== null;

export type ControlsProps = ComponentPropsWithRef<'div'> & {
  /**
   * Attach the shortcut listener to the document instead of scoping it to
   * this region. Global shortcuts are opt-in; by default keys only fire while
   * focus is inside the controls region.
   */
  readonly global?: boolean;
};

export const Controls = ({
  'aria-label': ariaLabel,
  children,
  global = false,
  onBlur,
  onFocus,
  onKeyDown,
  ref,
  style,
  tabIndex,
  ...props
}: ControlsProps) => {
  const {
    fullscreen,
    fullscreenStatus,
    muted,
    pipStatus,
    provider,
    seekStatus,
    selectedTextTrackId,
    selectTextTrackStatus,
    textTracks,
    volume,
    volumeStatus
  } = usePlayerState((state) => ({
    fullscreen: state.fullscreen,
    fullscreenStatus: state.capabilities.fullscreen.status,
    muted: state.muted,
    pipStatus: state.capabilities.pictureInPicture.status,
    provider: state.provider,
    seekStatus: state.capabilities.seek.status,
    selectedTextTrackId: state.selectedTextTrackId,
    selectTextTrackStatus: state.capabilities.selectTextTrack.status,
    textTracks: state.textTracks,
    volume: state.volume,
    volumeStatus: state.capabilities.setVolume.status
  }));
  const { controller } = usePlayer();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const hadFocusWithin = useRef(false);
  // Remember the last non-null caption selection, same as CaptionsButton, so
  // the `C` shortcut restores the same track the button would when toggling
  // captions back on — sharing resolveCaptionToggle keeps the two in sync.
  const lastSelectedTextTrackId = useRef<string | null>(null);
  /* eslint-disable react-hooks/refs -- mirrors CaptionsButton's lastSelectedId ref. */
  if (selectedTextTrackId !== null)
    lastSelectedTextTrackId.current = selectedTextTrackId;
  /* eslint-enable react-hooks/refs */
  // Signature of the capabilities that gate whether a child control is
  // rendered. Focus restoration keys off changes here so it fires only on a
  // capability transition (a gated control appearing or disappearing) and
  // never on unrelated state ticks like currentTime.
  const gatedSignature = `${seekStatus}|${volumeStatus}|${fullscreenStatus}|${pipStatus}`;

  const handleShortcut = useCallback(
    (event: ShortcutEvent) => {
      if (event.defaultPrevented) return;
      if (event.altKey || event.ctrlKey || event.metaKey) return;
      const target = event.target;
      if (isEditableTarget(target) || isInOpenMenu(target)) return;

      switch (event.key) {
        case ' ':
        case 'k':
        case 'K':
          // Space natively activates a focused button; don't double-toggle.
          if (event.key === ' ' && isNativeActivationTarget(target)) return;
          event.preventDefault();
          void controller.togglePlaybackWithOrigin('user');
          return;
        case 'ArrowLeft':
          if (seekStatus !== 'available') return;
          event.preventDefault();
          void controller.seekBy(-5);
          return;
        case 'ArrowRight':
          if (seekStatus !== 'available') return;
          event.preventDefault();
          void controller.seekBy(5);
          return;
        case 'j':
        case 'J':
          if (seekStatus !== 'available') return;
          event.preventDefault();
          void controller.seekBy(-10);
          return;
        case 'l':
        case 'L':
          if (seekStatus !== 'available') return;
          event.preventDefault();
          void controller.seekBy(10);
          return;
        case 'ArrowUp':
        case 'ArrowDown': {
          if (volumeStatus !== 'available') return;
          event.preventDefault();
          const delta = event.key === 'ArrowUp' ? 0.05 : -0.05;
          const next = Math.min(
            1,
            Math.max(0, Math.round((volume + delta) * 100) / 100)
          );
          if (muted && next > 0) void controller.unmute();
          void controller.setVolume(next);
          return;
        }
        case 'm':
        case 'M':
          if (volumeStatus !== 'available') return;
          event.preventDefault();
          void controller.toggleMuted();
          return;
        case 'f':
        case 'F':
          if (fullscreenStatus !== 'available') return;
          event.preventDefault();
          void (fullscreen
            ? controller.exitFullscreen()
            : controller.requestFullscreen());
          return;
        case 'c':
        case 'C': {
          if (selectTextTrackStatus !== 'available') return;
          event.preventDefault();
          const next = resolveCaptionToggle(
            textTracks,
            selectedTextTrackId,
            lastSelectedTextTrackId.current
          );
          if (next !== undefined) void controller.selectTextTrack(next);
          return;
        }
        default:
          return;
      }
    },
    [
      controller,
      fullscreen,
      fullscreenStatus,
      muted,
      seekStatus,
      selectedTextTrackId,
      selectTextTrackStatus,
      textTracks,
      volume,
      volumeStatus
    ]
  );

  useEffect(() => {
    if (!global) return;
    const listener = (event: KeyboardEvent): void => handleShortcut(event);
    document.addEventListener('keydown', listener);
    return () => document.removeEventListener('keydown', listener);
  }, [global, handleShortcut]);

  // Keep focus inside the player region: when a capability-gated control
  // unmounts while focused, the browser drops focus to <body>. Restore it to
  // the region so keyboard users never lose their place. Scoping to
  // `gatedSignature` ensures this reacts only to a control appearing or
  // disappearing, so an outside click that drops focus to <body> is never
  // re-stolen on the next unrelated render.
  useEffect(() => {
    const node = containerRef.current;
    if (!node) return;
    if (hadFocusWithin.current && document.activeElement === document.body) {
      node.focus();
    }
  }, [gatedSignature]);

  const setRef = useCallback(
    (node: HTMLDivElement | null) => {
      containerRef.current = node;
      assignRef(ref, node);
    },
    [ref]
  );

  return (
    <div
      {...props}
      aria-label={ariaLabel ?? 'Video player controls'}
      data-provider={provider ?? undefined}
      data-reely-part="controls"
      data-state={global ? 'global' : 'scoped'}
      onBlur={(event) => {
        onBlur?.(event);
        const next = event.relatedTarget as Node | null;
        if (
          next &&
          containerRef.current &&
          !containerRef.current.contains(next)
        ) {
          hadFocusWithin.current = false;
        }
      }}
      onFocus={(event) => {
        onFocus?.(event);
        hadFocusWithin.current = true;
      }}
      onKeyDown={(event) => {
        onKeyDown?.(event);
        if (!global) handleShortcut(event);
      }}
      ref={setRef}
      // Deliberately role="group", not "toolbar": the region owns media
      // shortcuts (Arrow keys seek/adjust volume, J/L/K/M/F, Space) rather
      // than roving-tabindex toolbar navigation. Native controls inside
      // (buttons, links, range inputs) keep their own key handling; the
      // shortcut handler skips those targets.
      role="group"
      style={style}
      tabIndex={tabIndex ?? 0}
    >
      {children}
    </div>
  );
};

type SettingsMenuContextValue = {
  readonly open: boolean;
  readonly setOpen: (open: boolean) => void;
  readonly close: () => void;
  readonly triggerRef: RefObject<HTMLButtonElement | null>;
  readonly rootRef: RefObject<HTMLDivElement | null>;
  readonly triggerId: string;
  readonly contentId: string;
};

const SettingsMenuContext = createContext<SettingsMenuContextValue | null>(
  null
);

const useSettingsMenu = (): SettingsMenuContextValue => {
  const ctx = useContext(SettingsMenuContext);
  if (!ctx) {
    throw new Error(
      'SettingsMenu components must be used within <SettingsMenu>'
    );
  }
  return ctx;
};

const menuItems = (root: HTMLElement | null): HTMLElement[] =>
  root
    ? Array.from(
        root.querySelectorAll<HTMLElement>(
          '[role="menuitem"], [role="menuitemradio"]'
        )
      )
    : [];

export const SettingsMenu = ({
  children,
  style,
  ...props
}: ComponentPropsWithRef<'div'>) => {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const baseId = useId();
  const close = useCallback(() => {
    setOpen(false);
    triggerRef.current?.focus();
  }, []);
  const value: SettingsMenuContextValue = {
    open,
    setOpen,
    close,
    triggerRef,
    rootRef,
    triggerId: `${baseId}-trigger`,
    contentId: `${baseId}-content`
  };
  return (
    <SettingsMenuContext.Provider value={value}>
      <div
        {...props}
        data-reely-part="settings-menu-root"
        data-state={open ? 'open' : 'closed'}
        ref={rootRef}
        style={{ position: 'relative', ...style }}
      >
        {children}
      </div>
    </SettingsMenuContext.Provider>
  );
};

export const SettingsMenuTrigger = ({
  children,
  onClick,
  onKeyDown,
  style,
  ...props
}: ComponentPropsWithRef<'button'>) => {
  const { open, setOpen, triggerRef, triggerId, contentId } = useSettingsMenu();
  return (
    <button
      {...props}
      aria-controls={open ? contentId : undefined}
      aria-expanded={open}
      aria-haspopup="menu"
      aria-label={props['aria-label'] ?? 'Settings'}
      data-reely-part="settings-menu-trigger"
      data-state={open ? 'open' : 'closed'}
      id={triggerId}
      onClick={(event) => {
        onClick?.(event);
        if (event.defaultPrevented) return;
        setOpen(!open);
      }}
      onKeyDown={(event) => {
        onKeyDown?.(event);
        if (event.defaultPrevented) return;
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
          event.preventDefault();
          setOpen(true); // Content autofocuses its first item on open
        }
      }}
      ref={triggerRef}
      style={{ ...controlTargetStyle, ...style }}
      type="button"
    >
      {children ?? <SettingsIcon />}
    </button>
  );
};

export const SettingsMenuContent = ({
  children,
  onKeyDown,
  style,
  ...props
}: ComponentPropsWithRef<'div'>) => {
  const { open, close, setOpen, rootRef, triggerId, contentId } =
    useSettingsMenu();
  const contentRef = useRef<HTMLDivElement | null>(null);

  // Autofocus the first item when the menu opens.
  useEffect(() => {
    if (!open) return;
    menuItems(contentRef.current)[0]?.focus();
  }, [open]);

  // Close on outside pointerdown without stealing focus.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent): void => {
      const target = event.target as Node | null;
      if (target && rootRef.current && !rootRef.current.contains(target)) {
        // Deliberately setOpen(false), not close(): unlike Escape/select,
        // an outside pointerdown must not steal focus back to the trigger.
        // Mouse users clicking empty space may land focus on <body> —
        // this matches native menu behavior.
        setOpen(false);
      }
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [open, rootRef, setOpen]);

  if (!open) return null;

  const move = (delta: number): void => {
    const items = menuItems(contentRef.current);
    if (items.length === 0) return;
    const current = items.findIndex((el) => el === document.activeElement);
    const next = (current + delta + items.length) % items.length;
    items[next]?.focus();
  };

  return (
    <div
      {...props}
      aria-labelledby={triggerId}
      data-reely-menu="open"
      data-reely-part="settings-menu"
      id={contentId}
      onKeyDown={(event) => {
        onKeyDown?.(event);
        if (event.defaultPrevented) return;
        switch (event.key) {
          case 'Escape':
            event.preventDefault();
            close();
            return;
          case 'ArrowDown':
            event.preventDefault();
            move(1);
            return;
          case 'ArrowUp':
            event.preventDefault();
            move(-1);
            return;
          case 'Home': {
            event.preventDefault();
            menuItems(contentRef.current)[0]?.focus();
            return;
          }
          case 'End': {
            event.preventDefault();
            const items = menuItems(contentRef.current);
            items[items.length - 1]?.focus();
            return;
          }
          case 'Tab':
            setOpen(false); // let focus leave naturally
            return;
          default:
            return;
        }
      }}
      ref={contentRef}
      role="menu"
      style={style}
    >
      {children}
    </div>
  );
};

export const MenuItem = ({
  children,
  onClick,
  onSelect,
  style,
  ...props
}: ComponentPropsWithRef<'button'> & { readonly onSelect?: () => void }) => {
  const { close } = useSettingsMenu();
  return (
    <button
      {...props}
      data-reely-part="menu-item"
      onClick={(event) => {
        onClick?.(event);
        if (event.defaultPrevented) return;
        onSelect?.();
        close();
      }}
      role="menuitem"
      style={{ ...controlTargetStyle, ...style }}
      tabIndex={-1}
      type="button"
    >
      {children}
    </button>
  );
};

type MenuRadioContextValue = {
  readonly value: string;
  readonly onValueChange: (value: string) => void;
};

const MenuRadioContext = createContext<MenuRadioContextValue | null>(null);

const useMenuRadio = (): MenuRadioContextValue => {
  const ctx = useContext(MenuRadioContext);
  if (!ctx) {
    throw new Error('MenuRadioItem must be used within <MenuRadioGroup>');
  }
  return ctx;
};

export const MenuRadioGroup = ({
  value,
  onValueChange,
  children,
  ...props
}: ComponentPropsWithRef<'div'> & {
  readonly value: string;
  readonly onValueChange: (value: string) => void;
}) => (
  <MenuRadioContext.Provider value={{ value, onValueChange }}>
    <div {...props} data-reely-part="menu-radio-group" role="group">
      {children}
    </div>
  </MenuRadioContext.Provider>
);

export const MenuRadioItem = ({
  value,
  children,
  onClick,
  style,
  ...props
}: ComponentPropsWithRef<'button'> & { readonly value: string }) => {
  const { value: selected, onValueChange } = useMenuRadio();
  const { close } = useSettingsMenu();
  const checked = selected === value;
  return (
    <button
      {...props}
      aria-checked={checked}
      data-reely-part="menu-radio-item"
      data-state={checked ? 'checked' : 'unchecked'}
      onClick={(event) => {
        onClick?.(event);
        if (event.defaultPrevented) return;
        onValueChange(value);
        close();
      }}
      role="menuitemradio"
      style={{ ...controlTargetStyle, ...style }}
      tabIndex={-1}
      type="button"
    >
      <span aria-hidden data-reely-part="menu-radio-indicator">
        {checked ? <CheckIcon /> : null}
      </span>
      {children}
    </button>
  );
};

// Disambiguates tracks that share a label (e.g. two "English" tracks with
// different kinds) by appending the language, rather than always showing it.
const disambiguateTrackLabel = (
  track: TextTrack,
  tracks: readonly TextTrack[]
): string => {
  const sharesLabel =
    tracks.filter((candidate) => candidate.label === track.label).length > 1;
  if (!sharesLabel || !track.language) return track.label;
  return `${track.label} (${track.language})`;
};

export type CaptionsMenuProps = ComponentPropsWithRef<'div'>;

/**
 * Preset assembly over `SettingsMenu`/`MenuRadioGroup`: lists the current
 * text tracks plus an "Off" option. Pass children to fully customize the
 * trigger/content; omit them to get the default track list.
 */
export const CaptionsMenu = ({ children, ...props }: CaptionsMenuProps) => {
  const { selectedId, status, textTracks } = usePlayerState((state) => ({
    selectedId: state.selectedTextTrackId,
    status: state.capabilities.selectTextTrack.status,
    textTracks: state.textTracks
  }));
  const { controller } = usePlayer();
  if (status !== 'available' || textTracks.length === 0) return null;

  return (
    <SettingsMenu {...props}>
      {children ?? (
        <>
          <SettingsMenuTrigger aria-label="Captions">
            <CaptionsIcon />
          </SettingsMenuTrigger>
          <SettingsMenuContent>
            <MenuRadioGroup
              onValueChange={(value) => {
                void controller.selectTextTrack(value === '' ? null : value);
              }}
              value={selectedId ?? ''}
            >
              <MenuRadioItem value="">Off</MenuRadioItem>
              {textTracks.map((track) => (
                <MenuRadioItem key={track.id} value={track.id}>
                  {disambiguateTrackLabel(track, textTracks)}
                </MenuRadioItem>
              ))}
            </MenuRadioGroup>
          </SettingsMenuContent>
        </>
      )}
    </SettingsMenu>
  );
};

const DOUBLE_TAP_WINDOW_MS = 300;

/**
 * Full-bleed gesture layer (`position: absolute; inset: 0`) with no
 * z-index. It must be placed BEFORE (as an earlier sibling of)
 * interactive layers like `Controls`/`ActivationButton` so those paint
 * on top and stay clickable — placed after them, it will cover and
 * block them.
 */
export type GesturesProps = ComponentPropsWithRef<'div'> & {
  readonly doubleTapSeek?: boolean;
  readonly seekOffset?: number;
  readonly onToggleControls?: () => void;
  readonly onSeek?: (direction: 'forward' | 'backward', offset: number) => void;
};

export const Gestures = ({
  doubleTapSeek = true,
  seekOffset = 10,
  onToggleControls,
  onSeek,
  children,
  onPointerUp,
  style,
  ...props
}: GesturesProps) => {
  const { controller } = usePlayer();
  const layerRef = useRef<HTMLDivElement | null>(null);
  const pendingTap = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (pendingTap.current !== null) {
        clearTimeout(pendingTap.current);
        pendingTap.current = null;
      }
    };
  }, []);

  return (
    <div
      {...props}
      data-reely-part="gestures"
      onPointerUp={(event) => {
        onPointerUp?.(event);
        if (event.defaultPrevented) return;
        // Ignore taps that land on a real control inside the layer.
        if (isNativeActivationTarget(event.target)) return;

        if (pendingTap.current !== null) {
          // Second tap within the window.
          clearTimeout(pendingTap.current);
          pendingTap.current = null;
          if (!doubleTapSeek) {
            // No double-tap action to disambiguate against — a single toggle, not two.
            onToggleControls?.();
            return;
          }
          const node = layerRef.current;
          if (!node) return;
          const rect = node.getBoundingClientRect();
          const forward = event.clientX - rect.left >= rect.width / 2;
          void controller.seekBy(forward ? seekOffset : -seekOffset);
          onSeek?.(forward ? 'forward' : 'backward', seekOffset);
          return;
        }
        // First tap → wait to see if a second arrives.
        pendingTap.current = setTimeout(() => {
          pendingTap.current = null;
          onToggleControls?.();
        }, DOUBLE_TAP_WINDOW_MS);
      }}
      ref={layerRef}
      style={{ position: 'absolute', inset: 0, ...style }}
    >
      {children}
    </div>
  );
};

export * from './icons.js';
