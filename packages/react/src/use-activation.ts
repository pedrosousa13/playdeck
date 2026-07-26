import type {
  AutoplayMode,
  PlayerController,
  ProviderAdapter,
  ResolvedPlayerSource,
  SourceDetectionResult
} from '@reely/core';
import type { NativePlaybackOptions } from '@reely/provider-native';
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState
} from 'react';
import { loadProvider, type PlayerMediaMount } from './provider-loaders.js';

export type { PlayerMediaMount } from './provider-loaders.js';

export type PlayerLoadingStrategy = 'eager' | 'viewport' | 'interaction';
export type PlayerPreload = 'none' | 'metadata' | 'auto';

export type ActivationBindings = {
  readonly activateFromInteraction: () => void;
  readonly loading: PlayerLoadingStrategy;
  readonly mediaEligible: boolean;
  readonly preload: PlayerPreload;
  readonly registerMedia: (media: PlayerMediaMount | null) => void;
  readonly registerViewport: (viewport: HTMLDivElement | null) => void;
};

export type UseActivationOptions = {
  readonly autoplay: AutoplayMode;
  readonly controller: PlayerController;
  readonly loadMargin: string;
  readonly loading: PlayerLoadingStrategy;
  readonly nativeOptions: NativePlaybackOptions;
  readonly prepareMedia: (media: PlayerMediaMount) => void;
  readonly preload: PlayerPreload;
  readonly source: SourceDetectionResult;
};

type Session = {
  generation: number;
  configuration: ActivationConfiguration;
  loading: PlayerLoadingStrategy;
  nativeOptions: NativePlaybackOptions;
  sourceKey: string;
  started: boolean;
  queuedPlay: boolean;
};

type ActivationConfiguration = 'valid' | 'invalid-interaction-autoplay';

type ObserverRegistration = {
  readonly configuration: ActivationConfiguration;
  readonly generation: number;
  readonly loading: PlayerLoadingStrategy;
  readonly margin: string;
  readonly observer: IntersectionObserver;
  readonly sourceKey: string;
  readonly target: HTMLDivElement;
};

type CommittedIdentity = {
  readonly configuration: ActivationConfiguration;
  readonly loading: PlayerLoadingStrategy;
  readonly nativeOptions: NativePlaybackOptions;
  readonly sourceKey: string;
};

const sourceKey = (source: SourceDetectionResult): string =>
  source.status === 'success'
    ? JSON.stringify(source.source)
    : 'unsupported-source';

const activationConfiguration = ({
  autoplay,
  loading
}: Pick<
  UseActivationOptions,
  'autoplay' | 'loading'
>): ActivationConfiguration =>
  loading === 'interaction' && autoplay !== false
    ? 'invalid-interaction-autoplay'
    : 'valid';

const activationIdentityKey = (
  source: string,
  loading: PlayerLoadingStrategy,
  configuration: ActivationConfiguration
): string => `${source}\u0000${loading}\u0000${configuration}`;

const nativeOptionsEqual = (
  left: NativePlaybackOptions,
  right: NativePlaybackOptions
): boolean =>
  Object.is(left.endTime, right.endTime) &&
  Object.is(left.loop, right.loop) &&
  Object.is(left.startTime, right.startTime);

const configurationError = (message: string) => ({
  category: 'configuration' as const,
  fatal: false,
  recoverable: true,
  message
});

const unsupportedError = (message: string) => ({
  category: 'unsupported' as const,
  fatal: false,
  recoverable: true,
  message
});

const providerError = (cause: unknown) => ({
  category: 'provider' as const,
  cause,
  fatal: false,
  recoverable: true,
  message: 'Unable to load the player provider.'
});

const destroyStale = (adapter: ProviderAdapter): void => {
  try {
    void Promise.resolve(adapter.destroy()).catch(() => undefined);
  } catch {
    // The current session is already authoritative.
  }
};

const disconnectObserver = (
  registration: ObserverRegistration | undefined
): void => {
  try {
    registration?.observer.disconnect();
  } catch {
    // A stale observer cannot remain authoritative.
  }
};

export const useActivation = (
  options: UseActivationOptions
): ActivationBindings => {
  const currentKey = sourceKey(options.source);
  const currentConfiguration = activationConfiguration(options);
  const currentActivationIdentity = activationIdentityKey(
    currentKey,
    options.loading,
    currentConfiguration
  );
  const currentNativeOptions = options.nativeOptions;
  const optionsRef = useRef(options);
  const session = useRef<Session>({
    generation: 0,
    configuration: currentConfiguration,
    loading: options.loading,
    nativeOptions: currentNativeOptions,
    sourceKey: currentKey,
    started: false,
    queuedPlay: false
  });
  const committedIdentity = useRef<CommittedIdentity>({
    configuration: currentConfiguration,
    loading: options.loading,
    nativeOptions: currentNativeOptions,
    sourceKey: currentKey
  });
  const mediaRef = useRef<PlayerMediaMount | null>(null);
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const observerRef = useRef<ObserverRegistration | undefined>(undefined);
  const loadingGeneration = useRef<number | undefined>(undefined);
  const [mediaVersion, setMediaVersion] = useState(0);
  const [viewportVersion, setViewportVersion] = useState(0);
  const [eligibleIdentity, setEligibleIdentity] = useState<string | undefined>(
    undefined
  );
  const mediaEligible = eligibleIdentity === currentActivationIdentity;

  useLayoutEffect(() => {
    optionsRef.current = options;
    committedIdentity.current = {
      configuration: currentConfiguration,
      loading: options.loading,
      nativeOptions: currentNativeOptions,
      sourceKey: currentKey
    };

    const active = session.current;
    if (
      active.sourceKey !== currentKey ||
      active.loading !== options.loading ||
      active.configuration !== currentConfiguration
    ) {
      active.generation += 1;
      active.sourceKey = currentKey;
      active.loading = options.loading;
      active.configuration = currentConfiguration;
      active.nativeOptions = currentNativeOptions;
      active.started = false;
      active.queuedPlay = false;
      loadingGeneration.current = undefined;
      disconnectObserver(observerRef.current);
      observerRef.current = undefined;
      options.controller.setProvider(undefined);
      options.controller.setActivation({ activation: 'dormant' });
      setEligibleIdentity(undefined);
      return;
    }

    if (nativeOptionsEqual(active.nativeOptions, currentNativeOptions)) return;
    active.nativeOptions = currentNativeOptions;
    if (!active.started) return;
    active.generation += 1;
    loadingGeneration.current = undefined;
    setMediaVersion((version) => version + 1);
  }, [currentConfiguration, currentKey, currentNativeOptions, options]);

  const activate = useCallback((queuePlay: boolean) => {
    const active = session.current;
    const current = optionsRef.current;
    const key = sourceKey(current.source);
    const configuration = activationConfiguration(current);
    if (
      active.started ||
      active.sourceKey !== key ||
      active.loading !== current.loading ||
      active.configuration !== configuration ||
      configuration !== 'valid'
    ) {
      return;
    }
    active.started = true;
    active.queuedPlay = queuePlay;
    current.controller.setActivation({ activation: 'eligible' });
    setEligibleIdentity(
      activationIdentityKey(key, current.loading, configuration)
    );
  }, []);

  const registerMedia = useCallback((media: PlayerMediaMount | null) => {
    const previous = mediaRef.current;
    if (previous === media) return;
    mediaRef.current = media;
    session.current.generation += 1;
    loadingGeneration.current = undefined;
    if (previous) {
      optionsRef.current.controller.setProvider(undefined);
    }
    setMediaVersion((version) => version + 1);
  }, []);

  const registerViewport = useCallback((viewport: HTMLDivElement | null) => {
    if (viewportRef.current === viewport) return;
    const registration = observerRef.current;
    if (registration) {
      disconnectObserver(registration);
      observerRef.current = undefined;
    }
    viewportRef.current = viewport;
    setViewportVersion((version) => version + 1);
  }, []);

  const activateFromInteraction = useCallback(() => {
    const current = optionsRef.current;
    const state = current.controller.getState();
    if (
      current.loading !== 'interaction' ||
      current.autoplay !== false ||
      activationConfiguration(current) !== 'valid'
    ) {
      return;
    }
    const activation = state.activation;
    if (activation === 'error') {
      if (state.error?.category === 'configuration') return;
      const active = session.current;
      active.generation += 1;
      active.started = true;
      active.queuedPlay = true;
      loadingGeneration.current = undefined;
      current.controller.setProvider(undefined);
      current.controller.setActivation({ activation: 'eligible' });
      setEligibleIdentity(
        activationIdentityKey(
          active.sourceKey,
          active.loading,
          active.configuration
        )
      );
      setMediaVersion((version) => version + 1);
      return;
    }
    if (activation !== 'dormant') return;
    activate(true);
  }, [activate]);

  useEffect(() => {
    if (options.loading !== 'eager') return;
    if (options.source.status !== 'success') {
      options.controller.setActivation({
        activation: 'error',
        error: unsupportedError('The player source is not supported.')
      });
      return;
    }
    activate(false);
  }, [
    activate,
    currentKey,
    options.controller,
    options.loading,
    options.source.status
  ]);

  useEffect(() => {
    if (options.loading !== 'interaction') return;
    if (options.autoplay === false) return;
    options.controller.setActivation({
      activation: 'error',
      error: configurationError(
        'Interaction loading cannot be used with autoplay.'
      )
    });
  }, [currentKey, options.autoplay, options.controller, options.loading]);

  useEffect(() => {
    if (options.loading !== 'viewport' || session.current.started) return;
    if (options.source.status !== 'success') {
      options.controller.setActivation({
        activation: 'error',
        error: unsupportedError('The player source is not supported.')
      });
      return;
    }
    const viewport = viewportRef.current;
    if (!viewport) {
      options.controller.setActivation({
        activation: 'error',
        error: configurationError(
          'Viewport activation requires Player.Viewport.'
        )
      });
      return;
    }
    if (viewportVersion === 0) return;
    const Observer = globalThis.IntersectionObserver;
    if (!Observer) {
      options.controller.setActivation({
        activation: 'error',
        error: unsupportedError(
          'Viewport loading requires IntersectionObserver.'
        )
      });
      return;
    }
    const currentObserver = observerRef.current;
    if (
      currentObserver?.target === viewport &&
      currentObserver.margin === options.loadMargin
    )
      return;
    disconnectObserver(currentObserver);
    const active = session.current;
    const generation = active.generation;
    const key = active.sourceKey;
    const loading = active.loading;
    const configuration = active.configuration;
    let registration: ObserverRegistration | undefined;
    const isCurrentObservation = (): boolean => {
      const committed = committedIdentity.current;
      return (
        registration !== undefined &&
        observerRef.current === registration &&
        viewportRef.current === viewport &&
        session.current.generation === generation &&
        session.current.sourceKey === key &&
        session.current.loading === loading &&
        session.current.configuration === configuration &&
        committed.sourceKey === key &&
        committed.loading === loading &&
        committed.configuration === configuration
      );
    };
    try {
      const observer = new Observer(
        (entries) => {
          if (
            !entries.some((entry) => entry.isIntersecting) ||
            !isCurrentObservation()
          ) {
            return;
          }
          disconnectObserver(registration);
          observerRef.current = undefined;
          activate(false);
        },
        { rootMargin: options.loadMargin }
      );
      registration = {
        configuration,
        generation,
        loading,
        margin: options.loadMargin,
        observer,
        sourceKey: key,
        target: viewport
      };
      observerRef.current = registration;
      observer.observe(viewport);
    } catch {
      disconnectObserver(registration);
      if (observerRef.current === registration) {
        observerRef.current = undefined;
      }
      const committed = committedIdentity.current;
      if (
        session.current.generation === generation &&
        committed.sourceKey === key &&
        committed.loading === loading &&
        committed.configuration === configuration
      ) {
        options.controller.setActivation({
          activation: 'error',
          error: configurationError(
            'The viewport loadMargin configuration is invalid.'
          )
        });
      }
      return;
    }
    return () => {
      disconnectObserver(registration);
      if (observerRef.current === registration) {
        observerRef.current = undefined;
      }
    };
  }, [
    activate,
    currentKey,
    options.controller,
    options.loadMargin,
    options.loading,
    options.source.status,
    viewportVersion
  ]);

  useEffect(() => {
    const active = session.current;
    const media = mediaRef.current;
    const source = optionsRef.current.source;
    if (!active.started || !media || source.status !== 'success') return;
    const generation = active.generation;
    if (loadingGeneration.current === generation) return;
    loadingGeneration.current = generation;
    const key = active.sourceKey;
    const loading = active.loading;
    const configuration = active.configuration;
    const nativeOptions = active.nativeOptions;
    const loadOptions = optionsRef.current;
    const controller = loadOptions.controller;
    const replacingProvider = controller.getState().provider !== null;
    const isCurrentLoad = (): boolean => {
      const current = session.current;
      const committed = committedIdentity.current;
      return (
        current.generation === generation &&
        current.sourceKey === key &&
        current.loading === loading &&
        current.configuration === configuration &&
        nativeOptionsEqual(current.nativeOptions, nativeOptions) &&
        committed.sourceKey === key &&
        committed.loading === loading &&
        committed.configuration === configuration &&
        nativeOptionsEqual(committed.nativeOptions, nativeOptions) &&
        mediaRef.current === media
      );
    };
    loadOptions.prepareMedia(media);
    controller.setActivation({ activation: 'loading-provider' });
    void loadProvider({
      media,
      nativeOptions,
      source: source.source as ResolvedPlayerSource
    })
      .then((adapter) => {
        if (
          !isCurrentLoad() ||
          (!replacingProvider &&
            controller.getState().activation !== 'loading-provider')
        ) {
          destroyStale(adapter);
          return;
        }
        optionsRef.current.prepareMedia(media);
        if (!isCurrentLoad()) {
          destroyStale(adapter);
          return;
        }
        const queuePlay = session.current.queuedPlay;
        session.current.queuedPlay = false;
        if (!queuePlay) {
          controller.setProvider(adapter);
          return;
        }
        // A queued user play has to be issued after this provider has loaded.
        // `setProvider` calls `attach()` synchronously and only queues
        // `load()` behind it, and a provider that attaches to media which
        // already has metadata reports readiness during that `attach()` — so
        // playing on the first replayed state lands before `load()`, which
        // then aborts it. Gating on the provider's own `load()` orders
        // correctly whether `attach()` is synchronous or returns a promise.
        // Readiness is still required, because an iframe provider rejects a
        // play issued before its embed is ready. Native media asked to
        // preload nothing is the exception: it reports readiness only once
        // something has played it, so it plays as soon as `load()` has run.
        const awaitReadiness = !(
          adapter.provider === 'native' && optionsRef.current.preload === 'none'
        );
        let loaded = false;
        let ready = false;
        let played = false;
        const subscription: { unsubscribe?: () => void } = {};
        let armed = false;
        let disposed = false;
        const dispose = (): void => {
          if (disposed) return;
          disposed = true;
          if (armed) subscription.unsubscribe?.();
        };
        const playWhenLoaded = (): void => {
          if (played || !loaded || (awaitReadiness && !ready)) return;
          played = true;
          dispose();
          void controller.playWithOrigin('user');
        };
        controller.setProvider({
          ...adapter,
          load: () => {
            const result = adapter.load();
            if (
              !isCurrentLoad() ||
              controller.getState().activation === 'error'
            ) {
              dispose();
              return result;
            }
            loaded = true;
            playWhenLoaded();
            return result;
          }
        });
        subscription.unsubscribe = controller.subscribe((state) => {
          if (disposed) return;
          if (!isCurrentLoad() || state.activation === 'error') {
            dispose();
            return;
          }
          if (state.activation !== 'ready') return;
          ready = true;
          playWhenLoaded();
        });
        armed = true;
        if (disposed) {
          subscription.unsubscribe();
        }
      })
      .catch((cause: unknown) => {
        if (!isCurrentLoad()) return;
        controller.setActivation({
          activation: 'error',
          error: providerError(cause)
        });
      });
  }, [currentKey, mediaEligible, mediaVersion]);

  useEffect(
    () => () => {
      session.current.generation += 1;
      disconnectObserver(observerRef.current);
      observerRef.current = undefined;
      optionsRef.current.controller.setProvider(undefined);
    },
    []
  );

  return useMemo(
    () => ({
      activateFromInteraction,
      loading: options.loading,
      mediaEligible,
      preload: options.preload,
      registerMedia,
      registerViewport
    }),
    [
      activateFromInteraction,
      mediaEligible,
      options.loading,
      options.preload,
      registerMedia,
      registerViewport
    ]
  );
};
