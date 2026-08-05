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
import {
  loadProvider,
  type PlayerMediaMount,
  type PlayerProviderOptions
} from './provider-loaders.js';

export type {
  PlayerMediaMount,
  PlayerProviderOptions
} from './provider-loaders.js';

export type PlayerLoadingStrategy = 'eager' | 'viewport' | 'interaction';
export type PlayerPreload = 'none' | 'metadata' | 'auto';

export type ActivationBindings = {
  readonly activateFromInteraction: () => void;
  readonly loading: PlayerLoadingStrategy;
  readonly preload: PlayerPreload;
  readonly registerMedia: (media: PlayerMediaMount | null) => void;
  readonly registerViewport: (viewport: HTMLDivElement | null) => void;
  readonly sourceCommitted: boolean;
};

export type UseActivationOptions = {
  readonly autoplay: AutoplayMode;
  readonly controller: PlayerController;
  readonly loadMargin: string;
  readonly loading: PlayerLoadingStrategy;
  readonly nativeOptions: NativePlaybackOptions;
  readonly prepareMedia: (media: PlayerMediaMount) => void;
  readonly preload: PlayerPreload;
  readonly providerOptions?: PlayerProviderOptions;
  readonly source: SourceDetectionResult;
};

type Session = {
  generation: number;
  configuration: ActivationConfiguration;
  loading: PlayerLoadingStrategy;
  nativeOptions: NativePlaybackOptions;
  providerOptions: PlayerProviderOptions | undefined;
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

type ActivationInputs = {
  readonly configuration: ActivationConfiguration;
  readonly loading: PlayerLoadingStrategy;
  readonly nativeOptions: NativePlaybackOptions;
  readonly providerOptions: PlayerProviderOptions | undefined;
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

// One provider's own option bag, compared by value for the same reason
// `nativeOptionsEqual` exists: `providerOptions={{ wistia: { swatch: false } }}`
// is a new object on every render, and a reference compare would tear the embed
// down and rebuild it each time. Own keys rather than each declared field, so
// this stays correct as a provider's options grow, and shallow because every
// option a provider bag declares is a primitive.
//
// Every key either side declares, compared as a value: a key set to `undefined`
// therefore equals that key being absent, and an absent bag equals an empty one.
// All three mean the same thing to a provider, which sets an attribute only for
// an option that is not `undefined` (`provider-wistia/src/attachment.ts:215`,
// `if (options.playerColor !== undefined)`). Counting keys instead would rebuild
// a live embed for two bags that build the identical element -- which is what a
// caller assembling its bag per render, one key at a time from its own props,
// hands this function.
const providerBagEqual = (
  left: Readonly<Record<string, unknown>> | undefined,
  right: Readonly<Record<string, unknown>> | undefined
): boolean => {
  const keys = new Set([
    ...Object.keys(left ?? {}),
    ...Object.keys(right ?? {})
  ]);
  return [...keys].every((key) => Object.is(left?.[key], right?.[key]));
};

// One line per provider key, as `nativeOptionsEqual` names its own three.
const providerOptionsEqual = (
  left: PlayerProviderOptions | undefined,
  right: PlayerProviderOptions | undefined
): boolean =>
  providerBagEqual(left?.wistia, right?.wistia) &&
  providerBagEqual(left?.youtube, right?.youtube);

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
  const currentProviderOptions = options.providerOptions;
  const optionsRef = useRef(options);
  const session = useRef<Session>({
    generation: 0,
    configuration: currentConfiguration,
    loading: options.loading,
    nativeOptions: currentNativeOptions,
    providerOptions: currentProviderOptions,
    sourceKey: currentKey,
    started: false,
    queuedPlay: false
  });
  const latestInputsRef = useRef<ActivationInputs>({
    configuration: currentConfiguration,
    loading: options.loading,
    nativeOptions: currentNativeOptions,
    providerOptions: currentProviderOptions,
    sourceKey: currentKey
  });
  const mediaRef = useRef<PlayerMediaMount | null>(null);
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const observerRef = useRef<ObserverRegistration | undefined>(undefined);
  const loadingGeneration = useRef<number | undefined>(undefined);
  const [mediaVersion, setMediaVersion] = useState(0);
  const [viewportVersion, setViewportVersion] = useState(0);
  const [committedIdentity, setCommittedIdentity] = useState<
    string | undefined
  >(undefined);
  const sourceCommitted = committedIdentity === currentActivationIdentity;

  useLayoutEffect(() => {
    optionsRef.current = options;
    latestInputsRef.current = {
      configuration: currentConfiguration,
      loading: options.loading,
      nativeOptions: currentNativeOptions,
      providerOptions: currentProviderOptions,
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
      active.providerOptions = currentProviderOptions;
      active.started = false;
      active.queuedPlay = false;
      loadingGeneration.current = undefined;
      disconnectObserver(observerRef.current);
      observerRef.current = undefined;
      options.controller.setProvider(undefined);
      options.controller.setActivation({ activation: 'dormant' });
      setCommittedIdentity(undefined);
      return;
    }

    if (
      nativeOptionsEqual(active.nativeOptions, currentNativeOptions) &&
      providerOptionsEqual(active.providerOptions, currentProviderOptions)
    ) {
      return;
    }
    active.nativeOptions = currentNativeOptions;
    active.providerOptions = currentProviderOptions;
    if (!active.started) return;
    active.generation += 1;
    loadingGeneration.current = undefined;
    setMediaVersion((version) => version + 1);
  }, [
    currentConfiguration,
    currentKey,
    currentNativeOptions,
    currentProviderOptions,
    options
  ]);

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
    setCommittedIdentity(
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
      setCommittedIdentity(
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
      const inputs = latestInputsRef.current;
      return (
        registration !== undefined &&
        observerRef.current === registration &&
        viewportRef.current === viewport &&
        session.current.generation === generation &&
        session.current.sourceKey === key &&
        session.current.loading === loading &&
        session.current.configuration === configuration &&
        inputs.sourceKey === key &&
        inputs.loading === loading &&
        inputs.configuration === configuration
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
      const inputs = latestInputsRef.current;
      if (
        session.current.generation === generation &&
        inputs.sourceKey === key &&
        inputs.loading === loading &&
        inputs.configuration === configuration
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
    const providerOptions = active.providerOptions;
    const loadOptions = optionsRef.current;
    const controller = loadOptions.controller;
    const replacingProvider = controller.getState().provider !== null;
    const isCurrentLoad = (): boolean => {
      const current = session.current;
      const inputs = latestInputsRef.current;
      return (
        current.generation === generation &&
        current.sourceKey === key &&
        current.loading === loading &&
        current.configuration === configuration &&
        nativeOptionsEqual(current.nativeOptions, nativeOptions) &&
        providerOptionsEqual(current.providerOptions, providerOptions) &&
        inputs.sourceKey === key &&
        inputs.loading === loading &&
        inputs.configuration === configuration &&
        nativeOptionsEqual(inputs.nativeOptions, nativeOptions) &&
        providerOptionsEqual(inputs.providerOptions, providerOptions) &&
        mediaRef.current === media
      );
    };
    loadOptions.prepareMedia(media);
    controller.setActivation({ activation: 'loading-provider' });
    void loadProvider({
      media,
      nativeOptions,
      providerOptions,
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
  }, [currentKey, mediaVersion, sourceCommitted]);

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
      preload: options.preload,
      registerMedia,
      registerViewport,
      sourceCommitted
    }),
    [
      activateFromInteraction,
      options.loading,
      options.preload,
      registerMedia,
      registerViewport,
      sourceCommitted
    ]
  );
};
