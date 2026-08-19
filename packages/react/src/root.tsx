import {
  PlayerController,
  bindMediaSession,
  detectSource,
  getMediaSessionCoordinator,
  type AutoplayMode,
  type MediaMetadataInput,
  type MediaSessionBinding,
  type MediaSessionLike,
  type PlayerSource
} from '@playdeck/core';
import type { NativePlaybackOptions } from '@playdeck/provider-native';
import {
  collectPlayerActions,
  PlayerContext,
  PosterContext,
  type PlayerHandle
} from './player-context.js';
import {
  useActivation,
  type PlayerMediaMount,
  type PlayerProviderOptions,
  type ResolvedProviderOptions
} from './use-activation.js';
import { sourceKey } from './viewport-media.js';
import { createVolumeRequest } from './volume-request.js';
import {
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type Ref
} from 'react';

// HTMLMediaElement.HAVE_CURRENT_DATA, inlined for the same reason
// provider-native inlines HAVE_METADATA: some DOM test environments omit the
// static readyState constants, and `x >= undefined` is silently always false.
// Typed against the DOM lib, which declares it as the literal 2, so a wrong
// value is a compile error rather than a silently-never-taken branch — the
// annotation adds no runtime reference to the global.
const HAVE_CURRENT_DATA: HTMLMediaElement['HAVE_CURRENT_DATA'] = 2;

type SourceTransition = {
  readonly key: string;
};

export type PlayerActivationProps = {
  readonly loading?: import('./use-activation.js').PlayerLoadingStrategy;
  readonly loadMargin?: string;
  /**
   * Under `loading: 'viewport'`, the fraction of the player's box that must be
   * on screen before the provider attaches -- an `IntersectionObserver`
   * threshold, `0` to `1`. Defaults to `0`, matching activation before this
   * prop existed: any visible pixel attaches the provider, the same first-pixel
   * behaviour `loadMargin`'s own default already grants everything else.
   *
   * A box taller or wider than the scroll container it moves through can never
   * reach a threshold near `1` -- no amount of scrolling puts 100% of it on
   * screen at once. Rather than leave that configuration dormant forever with no
   * playback and no error, such a box activates at the first visible pixel
   * instead, the same fallback the default already is for every other box.
   */
  readonly loadThreshold?: number;
  readonly preload?: import('./use-activation.js').PlayerPreload;
};

export type RootProps = NativePlaybackOptions &
  PlayerActivationProps & {
    readonly autoplay?: AutoplayMode;
    readonly captionRenderer?: 'custom' | 'native';
    readonly children: ReactNode;
    /**
     * Let the provider draw its own controls. Unset and `false` both mean a
     * chromeless player, which is where Playdeck's own composed `Player.Controls`
     * belongs; `true` hands the surface to the provider and Playdeck draws nothing
     * over it. Reaches Vimeo and YouTube through their embeds and native/HLS
     * through the video element's own `controls` attribute.
     */
    readonly controls?: boolean;
    readonly defaultMuted?: boolean;
    readonly mediaMetadata?: MediaMetadataInput | null;
    readonly defaultPlaybackRate?: number;
    readonly defaultVolume?: number;
    /**
     * Attempt `autoplay` even where the viewer matches
     * `prefers-reduced-motion: reduce`. Playdeck otherwise starts no playback of
     * its own for such a viewer: an `eager` or `viewport` autoplay is declined
     * at the attempt, the player reaches `autoplay: 'suppressed'`, and the
     * poster stays over the frame exactly as it does for a refused attempt.
     *
     * Defaults to `false`, and named for what it does rather than for the case
     * it enables, so a call site setting it reads as the deliberate
     * accessibility trade-off it is. Where `matchMedia` is unavailable the query
     * cannot match and this prop changes nothing.
     */
    readonly ignoreReducedMotion?: boolean;
    readonly muted?: boolean;
    readonly onMutedChange?: (muted: boolean) => void;
    readonly onPlaybackRateChange?: (playbackRate: number) => void;
    readonly onVolumeChange?: (volume: number) => void;
    readonly playbackRate?: number;
    // Compared by value, not by reference, so an inline literal is safe to
    // pass: see `providerOptionsEqual` in `use-activation.ts`.
    readonly providerOptions?: PlayerProviderOptions;
    readonly ref?: Ref<PlayerHandle>;
    readonly source: PlayerSource;
    readonly volume?: number;
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

export const Root = ({
  autoplay = false,
  captionRenderer,
  children,
  controls,
  defaultMuted = false,
  defaultPlaybackRate = 1,
  defaultVolume = 1,
  endTime,
  ignoreReducedMotion = false,
  loadMargin = '200px 0px',
  loadThreshold = 0,
  loading = 'viewport',
  loop,
  mediaMetadata,
  muted,
  onMutedChange,
  onPlaybackRateChange,
  onVolumeChange,
  playbackRate,
  providerOptions,
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
  const autoplayConfiguration = useRef({
    autoplay,
    ignoreReducedMotion,
    muted
  });
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
  autoplayConfiguration.current = { autoplay, ignoreReducedMotion, muted };
  mediaMetadataSeed.current = mediaMetadata;
  /* eslint-enable react-hooks/refs */

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
        controlledMuted: autoplayConfiguration.current.muted,
        ignoreReducedMotion: autoplayConfiguration.current.ignoreReducedMotion
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
      // A decoded first frame hides the poster on its own, deliberately: the
      // frame is what the poster stood in for, and a preload that reaches it
      // without ever playing gives the `playing` subscription below nothing to
      // fire on. That only holds while autoplay is not trying to play. An
      // attempt the browser refused, or that broke, leaves the media paused on
      // exactly that frame, so uncovering it hands the viewport a still image
      // with no cover over it and no gesture that put it there (#242) --
      // Safari rejecting an audible attempt is the common way to see it.
      //
      // So the gate reads autoplay rather than playback, and reads it as an
      // allow-list: where autoplay is configured, `'started'` is the one state
      // saying the frame is uncovered because playback reached it, and every
      // other state defers. Deny-listing the refusals instead would let a state
      // added to the union later fall through and uncover the frame again -- and
      // an unsettled attempt has to defer regardless, a promise in flight being
      // a refusal not yet told: hide on the decode and the rejection that
      // follows has no way to put the cover back, the same defect arriving as a
      // race. Gating on `playback === 'playing'` errs the other way, leaving
      // this writer nothing to do that the subscription does not already do and
      // giving up the preload case it exists for. Nothing is lost when the
      // attempt succeeds -- `playing` lands and the subscription hides the
      // poster the moment it does.
      //
      // The mode, not the state, is what says an attempt is still to come:
      // `'idle'` is where every source with no autoplay sits too, and those must
      // keep hiding on the first frame. The attempt provably cannot have begun
      // this early -- `useActivation` prepares the media
      // (`use-activation.ts:627`) before `setProvider` (`:652`), and
      // `#synchronizeAutoplay` in `player-controller.ts` declines to apply
      // `'attempting'` until there is a provider and a ready activation.
      // So the immediate call below for media that attaches already decodable
      // reads `'idle'` whatever the mode is, as does a `loadeddata` arriving
      // before the provider's `load()`.
      const onLoadedData = () => {
        const autoplayState = controller.getState().autoplay;
        if (
          autoplayConfiguration.current.autoplay !== false &&
          autoplayState !== 'started'
        ) {
          return;
        }
        if (
          currentMedia.current === media &&
          providerSourceTransition.current === attachedSourceTransition
        ) {
          setHiddenTransition(attachedSourceTransition);
        }
      };
      media.addEventListener('loadeddata', onLoadedData);
      loadedDataListener.current = { media, listener: onLoadedData };
      if (media.readyState >= HAVE_CURRENT_DATA) {
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

  // `controls` and `loop` folded into the active provider's own bag -- their
  // one home on `Root` reaching that provider by looking, to `useActivation`,
  // like an ordinary provider-option change. Injected only into the bag
  // belonging to the detected source's own provider, deliberately not all of
  // them unconditionally: `providerOptionsEqual` compares every bag it knows
  // about, whatever source is actually playing, so folding into the youtube and
  // vimeo bags regardless of source would make a `controls` change look like a
  // bag change on a native or HLS source too -- re-attaching a video element
  // that only needed a DOM attribute set, losing its playback position. A value
  // of `undefined` lands as an explicit `controls: undefined` key on the active
  // bag rather than an absent one, which is already safe: `providerBagEqual`
  // compares own keys by value, so a key set to `undefined` equals that key
  // being absent, and both providers read `options.controls === true`.
  // Returning `providerOptions ?? {}` for every other source type is safe for
  // the same reason -- an absent bag and an empty one compare equal.
  //
  // Folding `loop` costs no re-attach it was not already paying. It rides in
  // `nativeOptions` for every source type, not only the two that read it, and
  // `nativeOptionsEqual` (`use-activation.ts:113`,
  // `Object.is(left.loop, right.loop)`) is compared whatever the source is --
  // so a `loop` change already retired an embed's activation identity and
  // rebuilt the provider before SIDEPRO-210. What it rebuilt was an identical
  // embed, the value having reached nothing. The fold is what makes the
  // rebuild produce a looping one.
  //
  // `startTime` and `endTime` join the fold on the same terms (#214), and for
  // the same reason `loop` did: they rode in `nativeOptions` and reached the
  // native and HLS providers alone, so both were silently inert on the three
  // embeds. The raw prop values are folded -- each provider sanitises its own
  // bag, as native does (`provider-native/src/playback.ts`'s boundary
  // resolution), so no rule is applied twice or spelled two ways here.
  //
  // Wistia takes `loop` and the two boundaries: its `controls` fan-out is still
  // unbuilt, so the `wistia` bag keeps `controls` un-omitted and there is
  // nothing to fold.
  const resolvedProviderOptions = useMemo<ResolvedProviderOptions>(() => {
    const type =
      detectedSource.status === 'success'
        ? detectedSource.source.type
        : undefined;
    if (type === 'youtube') {
      return {
        ...providerOptions,
        youtube: {
          ...providerOptions?.youtube,
          controls,
          endTime,
          loop,
          startTime
        }
      };
    }
    if (type === 'vimeo') {
      return {
        ...providerOptions,
        vimeo: { ...providerOptions?.vimeo, controls, endTime, loop, startTime }
      };
    }
    if (type === 'wistia') {
      return {
        ...providerOptions,
        wistia: { ...providerOptions?.wistia, endTime, loop, startTime }
      };
    }
    return providerOptions ?? {};
  }, [controls, detectedSource, endTime, loop, providerOptions, startTime]);

  const activation = useActivation({
    autoplay,
    controller,
    loadMargin,
    loadThreshold,
    loading,
    nativeOptions: { endTime, loop, startTime },
    prepareMedia,
    preload,
    providerOptions: resolvedProviderOptions,
    source: detectedSource
  });

  // The handle is a fresh object carrying exactly what `PlayerHandle`
  // declares, never the controller instance. `Object.assign(controller, ...)`
  // used to stand here, and it mutates and returns its target, so the ref
  // handed out the whole `PlayerController` -- `setProvider`, `setActivation`,
  // `configureAutoplay` and the `*WithOrigin` commands included. The narrowing
  // was a TypeScript fiction one cast wide open, which let anyone holding the
  // ref swap the provider out from under the player (#328).
  //
  // The three read members are named here; the rest come from
  // `player-context.ts`'s `collectPlayerActions`, the single list
  // `usePlayerActions` also builds from, so the two surfaces cannot drift.
  // `activateFromInteraction` rides along from `useActivation` rather than
  // widening `PlayerController` itself, as it is an activation concern the
  // controller has no concept of. Guarded by index.test.tsx's "hands back only
  // the declared PlayerHandle surface through the ref".
  useImperativeHandle(
    ref,
    () => ({
      getState: controller.getState,
      subscribe: controller.subscribe,
      on: controller.on,
      ...collectPlayerActions(controller, activation.activateFromInteraction)
    }),
    [activation.activateFromInteraction, controller]
  );
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
    controller.configureAutoplay(autoplay, {
      controlledMuted: muted,
      ignoreReducedMotion
    });
  }, [autoplay, controller, ignoreReducedMotion, muted]);

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
    const mediaSession: MediaSessionLike | undefined =
      typeof navigator !== 'undefined' ? navigator.mediaSession : undefined;
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

  // Fed by a subscription rather than by a control's render, so it also
  // records selections made by a custom control calling selectTextTrack
  // directly, and stays correct while no captions control is mounted at all.
  const lastSelectedTextTrackId = useRef<string | null>(null);
  useEffect(
    () =>
      controller.subscribe((state) => {
        if (state.selectedTextTrackId !== null) {
          lastSelectedTextTrackId.current = state.selectedTextTrackId;
        }
      }),
    [controller]
  );

  // Also fed by a subscription rather than by a control's render, and for a
  // second reason on top of the one above: it is a store, so a render React
  // discards would leave a release behind that never committed, and the control
  // and the store would disagree from then on.
  const [volumeRequest] = useState(() => createVolumeRequest(controller));
  useEffect(() => volumeRequest.observe(), [volumeRequest]);

  const value = useMemo(
    () => ({
      controller,
      controls,
      source: detectedSource,
      ...activation,
      lastSelectedTextTrackId,
      registerMedia,
      volumeRequest
    }),
    [
      activation,
      controller,
      controls,
      detectedSource,
      registerMedia,
      volumeRequest
    ]
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
