import type {
  AutoplayMode,
  PlayerController,
  ProviderAdapter,
  ResolvedPlayerSource,
  SourceDetectionFailure,
  SourceDetectionResult
} from '@playdeck/core';
import type { NativePlaybackOptions } from '@playdeck/provider-native';
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
  type ResolvedProviderOptions
} from './provider-loaders.js';

export type {
  PlayerMediaMount,
  PlayerProviderOptions,
  ResolvedProviderOptions
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
  readonly loadThreshold: number;
  readonly loading: PlayerLoadingStrategy;
  readonly nativeOptions: NativePlaybackOptions;
  readonly prepareMedia: (media: PlayerMediaMount) => void;
  readonly preload: PlayerPreload;
  readonly providerOptions?: ResolvedProviderOptions;
  readonly source: SourceDetectionResult;
};

type Session = {
  generation: number;
  configuration: ActivationConfiguration;
  loading: PlayerLoadingStrategy;
  nativeOptions: NativePlaybackOptions;
  providerOptions: ResolvedProviderOptions | undefined;
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
  readonly threshold: number;
};

type ActivationInputs = {
  readonly configuration: ActivationConfiguration;
  readonly loading: PlayerLoadingStrategy;
  readonly nativeOptions: NativePlaybackOptions;
  readonly providerOptions: ResolvedProviderOptions | undefined;
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
// an option that is not `undefined` -- and, where it format-checks the value,
// only for one that passes (`provider-wistia/src/attachment.ts:250`,
// `if (options.playerColor !== undefined && isHexColor(options.playerColor))`).
// That check makes equality here stricter than the element it stands in for: a
// rejected `playerColor` sets no attribute, so `{ playerColor: 'red' }` builds
// the identical element to `{}` yet compares unequal, and a caller that keeps
// supplying it rebuilds the embed every render. Equal bags still mean an
// identical element, which is the direction this guards. Counting keys instead
// would rebuild a live embed for two bags that build the identical element --
// which is what a caller assembling its bag per render, one key at a time from
// its own props, hands this function.
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
  left: ResolvedProviderOptions | undefined,
  right: ResolvedProviderOptions | undefined
): boolean =>
  providerBagEqual(left?.wistia, right?.wistia) &&
  providerBagEqual(left?.youtube, right?.youtube) &&
  providerBagEqual(left?.vimeo, right?.vimeo);

// A browser can report an intersection ratio a hair under the geometrically
// exact value it is crossing -- documented for `threshold: 1`, where subpixel
// layout rounding can leave the ratio at e.g. `0.9998` and the callback never
// fires again to say the target reached it. The tolerance absorbs that noise
// without treating a materially lower ratio as a match.
const THRESHOLD_EPSILON = 0.0001;

// Same idea for the size comparison `targetExceedsObserverRoot` makes below: a
// target sized to match its root can differ from it by a subpixel and still
// mean "the same size" rather than "bigger".
const SIZE_EPSILON_PX = 0.5;

// The observer is always given `0` alongside `loadThreshold`, so its callback
// fires the moment the target starts intersecting at all -- not only when it
// crosses `loadThreshold` itself. That first crossing is what
// `targetExceedsObserverRoot` needs to see the target's and the root's rects
// before `loadThreshold` is anywhere close, and it is the *only* further
// callback a target that can never reach `loadThreshold` will ever get: with a
// single configured threshold above the ratio a target can reach, nothing after
// the initial callback would ever cross it, and the observer would fall silent
// for good. Deduplicated rather than always `[0, loadThreshold]`, so the default
// `loadThreshold: 0` -- every consumer's activation today -- keeps asking the
// browser for exactly what it asked for before this prop existed.
const observerThresholds = (loadThreshold: number): number[] =>
  loadThreshold === 0 ? [0] : [0, loadThreshold];

// Whether `entry`'s target is larger than the observer root it is measured
// against -- the scroll container, never `Player.Root` -- in either dimension:
// the shape behind the brief's own example, a `9/16` Shorts player on a window
// shorter than it is tall. A target that size can never cover 100% of that
// container no matter how it scrolls, so a `loadThreshold` near `1` would
// otherwise stay unsatisfied forever: not a misconfiguration worth an error,
// since every other threshold works fine on every other target, just a box
// that happened to overflow the one it loaded into. `null`
// `rootBounds` -- the root not sharing this target's document, or not yet
// having a size to report -- is treated as "not provably larger", the
// conservative reading: the cost of a false negative here is the first-pixel
// activation every consumer already gets under the default `loadThreshold: 0`,
// where the cost of a false positive would be a threshold silently never
// doing what it was set to do.
const targetExceedsObserverRoot = (
  entry: IntersectionObserverEntry
): boolean => {
  const { rootBounds, boundingClientRect: target } = entry;
  return (
    rootBounds !== null &&
    (target.width > rootBounds.width + SIZE_EPSILON_PX ||
      target.height > rootBounds.height + SIZE_EPSILON_PX)
  );
};

// The activation criterion for one delivered entry. A target that fits within
// its root is held to `loadThreshold` itself; one that cannot -- see
// `targetExceedsObserverRoot` -- gets the same first-pixel activation the default
// `loadThreshold: 0` already gives every other player, rather than an
// unreachable threshold leaving it dormant with no playback and no error, the
// worse failure the brief warns against.
const meetsLoadThreshold = (
  entry: IntersectionObserverEntry,
  loadThreshold: number
): boolean =>
  entry.isIntersecting &&
  (entry.intersectionRatio >= loadThreshold - THRESHOLD_EPSILON ||
    targetExceedsObserverRoot(entry));

const configurationError = (message: string) => ({
  category: 'configuration' as const,
  fatal: false,
  recoverable: false,
  message
});

const unsupportedError = (message: string) => ({
  category: 'unsupported' as const,
  fatal: false,
  recoverable: true,
  message
});

// How much of the rejected source the message quotes. A YouTube watch url is
// 43 characters and a `player.vimeo.com` url carrying a privacy hash is 55, so
// every form `docs/provider-setup.md` lists survives whole. Past that the quote
// is into a query string, while what identifies the mistake -- the scheme, the
// host, the path shape -- is all at the front. It is a bound and not a
// summary: `ErrorDisplay` renders the message as one paragraph over the player
// (`loading-error.tsx:345`), and an unbounded source url would push the retry
// button below a small viewport.
const MAX_SOURCE_ECHO = 120;

// The rejected value as a message can carry it. Echoed verbatim rather than
// filtered: `ErrorDisplay` renders the message as a React text child
// (`loading-error.tsx:318`, `:345`), which escapes it, so the value a consumer
// reads back is the value they passed (#305).
const echoSource = (input: unknown): string => {
  let rendered: string;
  if (typeof input === 'string') {
    // Even the empty string, which is a refusal a consumer can hit with
    // `source=""` and wants to see quoted as such.
    rendered = input;
  } else {
    try {
      // `undefined`, a function and a symbol all render as `undefined` here, so
      // there is a fall-back for them as well as for a value that throws.
      rendered = JSON.stringify(input) ?? `of type ${typeof input}`;
    } catch {
      // A `source` that cannot be rendered at all -- circular, or a hostile
      // `toJSON` -- still has to produce a message rather than throw out of the
      // effect publishing it.
      rendered = `of type ${typeof input}`;
    }
  }
  return rendered.length > MAX_SOURCE_ECHO
    ? `${rendered.slice(0, MAX_SOURCE_ECHO)}…`
    : rendered;
};

const SOURCE_GUIDANCE =
  "See Playdeck's docs/provider-setup.md for the source forms each provider accepts.";

// One sentence per `detectSource` failure reason, because the three do not mean
// the same thing and one sentence for all three is the dead end #305 reports:
// `malformed-string` is a string no video could be read out of -- ill-formed,
// or a recognised provider host in a path shape the detector does not read
// (`source-detection.ts:328`, `:334`, `:346`); `unsupported-string` is a
// well-formed url whose scheme the shared allowlist refuses or whose host no
// provider claims (`:290`, `:353`); `invalid-source` is a non-string that is
// not a source object (`:369`). Each quotes what was rejected, so the message
// says which value to go and fix rather than only that one exists.
const refusedSourceMessage = (source: SourceDetectionFailure): string => {
  const echoed = echoSource(source.input);
  if (source.reason === 'malformed-string') {
    return `Playdeck could not read a video from the player source "${echoed}" — it is either not a well-formed URL, or a provider URL in a form Playdeck does not read. ${SOURCE_GUIDANCE}`;
  }
  if (source.reason === 'unsupported-string') {
    return `Playdeck has no provider for the player source "${echoed}" — its scheme or its host is not one Playdeck plays. ${SOURCE_GUIDANCE}`;
  }
  return `The player source ${echoed} is not a source object Playdeck accepts. ${SOURCE_GUIDANCE}`;
};

// What every strategy publishes when `detectSource` turns the URL down. Not
// `recoverable`: retrying re-reads the same `source` prop and the allowlist
// refuses it again, so there is no press that could change the outcome. Both
// `ActivationButton` and `ErrorDisplay` read that one flag to decide whether to
// offer a retry at all (#34, #198), so `recoverable: true` here bought an
// enabled control that did nothing -- the same dead affordance #331 opens by
// describing (#331).
//
// Narrower than `unsupportedError` on purpose. That factory also carries the
// missing-`IntersectionObserver` refusal below, which is about the environment
// the player mounted into rather than about the URL, and is left retryable.
const refusedSourceError = (message: string) => ({
  category: 'unsupported' as const,
  fatal: false,
  recoverable: false,
  message
});

const PROVIDER_LABELS: Record<ResolvedPlayerSource['type'], string> = {
  hls: 'HLS',
  video: 'native',
  vimeo: 'Vimeo',
  wistia: 'Wistia',
  youtube: 'YouTube'
};

// Names the provider, which is knowable from the resolved source, and stops
// there, which the reason is not: `loadProvider` rejects for a chunk the
// network never delivered, a CSP that refused it, a missing media mount and an
// adapter factory that threw, and nothing here can tell those apart. Saying so
// beats inventing a reason; the rejection itself already rides on `cause`.
const providerError = (cause: unknown, type: ResolvedPlayerSource['type']) => ({
  category: 'provider' as const,
  cause,
  fatal: false,
  recoverable: true,
  message: `Unable to load the ${PROVIDER_LABELS[type]} provider. Playdeck cannot say why — the failure it caught is on this error's cause.`
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
  // The refusal to publish, or `undefined` for a source that resolved. Derived
  // per render rather than held, because it is a string: the three strategy
  // effects below depend on it by value, so they re-run when one refused source
  // replaces another. Nothing else here reports that -- `sourceKey` collapses
  // every refusal to the one `'unsupported-source'` constant and `status` is
  // `'failure'` for both -- so a message naming the previous value would stand
  // after the consumer had already changed it. Depending on the
  // `SourceDetectionResult` itself would need every caller to memoise it, which
  // `Root` does (`root.tsx:199`) and a direct caller of this hook need not.
  const refusedMessage =
    options.source.status === 'success'
      ? undefined
      : refusedSourceMessage(options.source);
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
    // A refused source refuses to arm. Publishing the refusal above is not
    // sufficient on its own: without this the error branch below would accept
    // the call, commit to `'eligible'` and clear the error -- and the effect
    // that published it does not re-run, since none of its inputs changed. That
    // lands the player right back at the `error: null` dead end #331 is about,
    // one call later. The session guards cannot catch it: they compare
    // `sourceKey`, which is the same `'unsupported-source'` constant for every
    // failure, so they all pass.
    //
    // `refusedSourceError` is `recoverable: false`, so the error branch's own
    // `recoverable` check would now refuse the same call. This is checked
    // anyway, and first: `recoverable` is what a *presented* control reads, and
    // a caller reaching this method directly presents nothing. The two must
    // refuse the same source whichever way it is reached (#198), and only the
    // source status says so on its own terms.
    if (
      current.loading !== 'interaction' ||
      current.autoplay !== false ||
      current.source.status !== 'success' ||
      activationConfiguration(current) !== 'valid'
    ) {
      return;
    }
    const activation = state.activation;
    if (activation === 'error') {
      // The same state-level signal `ActivationButton` reads, so a direct call
      // and a click refuse the same errors (#198).
      if (state.error?.recoverable === false) return;
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
    if (refusedMessage !== undefined) {
      options.controller.setActivation({
        activation: 'error',
        error: refusedSourceError(refusedMessage)
      });
      return;
    }
    activate(false);
  }, [
    activate,
    currentKey,
    options.controller,
    options.loading,
    refusedMessage
  ]);

  useEffect(() => {
    if (options.loading !== 'interaction') return;
    // Checked ahead of the autoplay conflict below, and for the same reason it
    // is checked first in `eager` and `viewport`: a refused source is
    // `detectSource` turning down a `javascript:` or `data:` URL, which is the
    // one security control this library applies to a source, and `setActivation`
    // carries one error. A configuration complaint about an unrelated prop
    // masking that refusal is what #332 reported in the Wistia notice slot,
    // where a cosmetic `playerColor` rejection suppressed a rejected poster
    // until the same order-first rule settled it there; the refusal wins here
    // so it is never the second thing a consumer is told. Neither error is
    // lost: this effect re-runs on both `currentKey` and
    // `options.autoplay`, so a consumer who fixes the source is told about the
    // autoplay conflict next (#331).
    if (refusedMessage !== undefined) {
      options.controller.setActivation({
        activation: 'error',
        error: refusedSourceError(refusedMessage)
      });
      return;
    }
    if (options.autoplay === false) return;
    options.controller.setActivation({
      activation: 'error',
      error: configurationError(
        'Interaction loading cannot be used with autoplay.'
      )
    });
  }, [
    currentKey,
    options.autoplay,
    options.controller,
    options.loading,
    refusedMessage
  ]);

  useEffect(() => {
    if (options.loading !== 'viewport' || session.current.started) return;
    if (refusedMessage !== undefined) {
      options.controller.setActivation({
        activation: 'error',
        error: refusedSourceError(refusedMessage)
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
      currentObserver.margin === options.loadMargin &&
      currentObserver.threshold === options.loadThreshold
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
            !entries.some((entry) =>
              meetsLoadThreshold(entry, options.loadThreshold)
            ) ||
            !isCurrentObservation()
          ) {
            return;
          }
          disconnectObserver(registration);
          observerRef.current = undefined;
          activate(false);
        },
        {
          rootMargin: options.loadMargin,
          threshold: observerThresholds(options.loadThreshold)
        }
      );
      registration = {
        configuration,
        generation,
        loading,
        margin: options.loadMargin,
        observer,
        sourceKey: key,
        target: viewport,
        threshold: options.loadThreshold
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
            'The viewport loadMargin or loadThreshold configuration is invalid.'
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
    options.loadThreshold,
    options.loading,
    refusedMessage,
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
          error: providerError(cause, source.source.type)
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
