import type {
  AutoplayMode,
  PlayerController,
  ProviderAdapter,
  ResolvedPlayerSource,
  SourceDetectionFailure,
  SourceDetectionResult
} from '@playdeck/core';
import { unsupportedSourceFormat } from '@playdeck/core';
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
  // Whether playback this hook does not itself issue -- the autoplay `Root`
  // arms on the controller -- is allowed to run yet. False only while a
  // `playThreshold` set above `loadThreshold` is still unmet, so a caller that
  // never separates the two is handed `true` from the first render and behaves
  // exactly as it did before this existed.
  readonly playGateOpen: boolean;
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
  readonly playThreshold: number;
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
  playGateOpen: boolean;
  queuedPlay: boolean;
};

type ActivationConfiguration =
  'valid' | 'invalid-interaction-autoplay' | 'invalid-play-threshold';

type ObserverRegistration = {
  readonly configuration: ActivationConfiguration;
  readonly generation: number;
  readonly loadThreshold: number;
  readonly loading: PlayerLoadingStrategy;
  readonly margin: string;
  readonly observer: IntersectionObserver;
  readonly playThreshold: number;
  readonly sourceKey: string;
  readonly target: HTMLDivElement;
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

// The combinations of activation props that cannot be honoured, each named so
// the consumer is told which one they wrote rather than left with a player that
// quietly never does what they asked.
//
// `playThreshold` below `loadThreshold` asks the player to start playing at a
// point it passes *before* it is allowed to load, which is not an ordering that
// exists. Clamping it to `loadThreshold` would run, but it would run a
// configuration the consumer did not write and cannot see, and the whole reason
// to separate the two thresholds is that the consumer has an opinion about the
// gap between them. Only under `viewport`: neither threshold is read by the
// other two strategies, so no observer is ever built and there is nothing there
// for the combination to break.
const activationConfiguration = ({
  autoplay,
  loadThreshold,
  loading,
  playThreshold
}: Pick<
  UseActivationOptions,
  'autoplay' | 'loadThreshold' | 'loading' | 'playThreshold'
>): ActivationConfiguration => {
  if (loading === 'interaction' && autoplay !== false)
    return 'invalid-interaction-autoplay';
  if (loading === 'viewport' && playThreshold < loadThreshold)
    return 'invalid-play-threshold';
  return 'valid';
};

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
// option a provider bag declares is meant to be a primitive -- `youtube`'s
// pre-existing `loadIframeApi` is the one bag that is not, a gap
// `PrimitiveOptionBag` (`provider-loaders.ts`) found rather than closed. Every
// other bag is guarded by it: a field that stopped being a primitive fails to
// compile there (#579), which is what let `hls` add a `build` option without
// this comparison needing to change.
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
  providerBagEqual(left?.vimeo, right?.vimeo) &&
  providerBagEqual(left?.hls, right?.hls);

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

// The observer is always given `0` alongside the configured thresholds, so its
// callback fires the moment the target starts intersecting at all -- not only
// when it crosses one of them. That first crossing is what
// `targetExceedsObserverRoot` needs to see the target's and the root's rects
// before either threshold is anywhere close, and it is the *only* further
// callback a target that can never reach them will ever get: with every
// configured threshold above the ratio a target can reach, nothing after the
// initial callback would ever cross one, and the observer would fall silent for
// good. Deduplicated rather than always `[0, loadThreshold, playThreshold]`, so
// the default `loadThreshold: 0` with a `playThreshold` following it -- every
// consumer's activation today -- keeps asking the browser for exactly what it
// asked for before either prop existed.
//
// One observer carries both. `IntersectionObserver` takes an array of
// thresholds and reports the same entries against all of them, so a second
// observer on the same target would buy nothing but a second set of callbacks
// to reconcile.
const observerThresholds = (
  loadThreshold: number,
  playThreshold: number
): number[] =>
  [...new Set([0, loadThreshold, playThreshold])].sort(
    (left, right) => left - right
  );

// Whether `entry`'s target is larger than the observer root it is measured
// against -- the scroll container, never `Player.Root` -- in either dimension:
// the shape behind the brief's own example, a `9/16` Shorts player on a window
// shorter than it is tall. A target that size can never cover 100% of that
// container no matter how it scrolls, so a threshold near `1` would
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

// Whether one delivered entry satisfies one of the two thresholds. A target
// that fits within its root is held to the threshold itself; one that cannot --
// see `targetExceedsObserverRoot` -- gets the same first-pixel pass the default
// `loadThreshold: 0` already gives every other player, rather than an
// unreachable threshold leaving it dormant with no playback and no error, the
// worse failure the brief warns against. Both thresholds go through here, so
// that protection covers `playThreshold` too: a play threshold that can never
// be met would strand the same oversized player at the same dead end, one
// decision further along.
const meetsThreshold = (
  entry: IntersectionObserverEntry,
  threshold: number
): boolean =>
  entry.isIntersecting &&
  (entry.intersectionRatio >= threshold - THRESHOLD_EPSILON ||
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

// How much of the rejected source the message quotes, in code points. A YouTube
// watch url is 43 of them and a `player.vimeo.com` url with a privacy hash 55, so
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
  // By code point, not by code unit: slicing a string at a UTF-16 boundary can
  // cut a surrogate pair in half, and the lone surrogate left behind renders as
  // U+FFFD. A source url can carry an astral character in a path or a query.
  const points = Array.from(rendered);
  return points.length > MAX_SOURCE_ECHO
    ? `${points.slice(0, MAX_SOURCE_ECHO).join('')}…`
    : rendered;
};

// Deliberately not `SourceDetectionFailure.guidance`, which every failure also
// carries. Core's string is one sentence for all three reasons -- "Pass an
// explicit source object with a supported type and the required fields" -- and
// it is addressed to a caller of `detectSource`, for whom building the object
// by hand is the answer. It is the wrong advice for a `Player.Root` consumer
// who mistyped a YouTube url: the fix there is the url, not a hand-built
// object. So the two are for different audiences and both are correct for
// theirs; this one is the React layer's, and core's stays what a direct caller
// reads off the result.
//
// The document is named by url and not by repository path. A message is read
// from wherever the built code ran -- a browser console, a paragraph over the
// player -- and a reader there has no repository to resolve a path against
// (#459).
const SOURCE_GUIDANCE =
  'See https://github.com/pedrosousa13/playdeck/blob/main/docs/provider-setup.md for the source forms each provider accepts.';

// One sentence per `detectSource` failure reason, because the four do not mean
// the same thing and one sentence for all of them is the dead end #305 reports.
// Each quotes what was rejected, so the message says which value to go and fix
// rather than only that one exists.
//
// Each sentence is held to what its reason actually proves. `malformed-string`
// is a string no video could be read out of -- ill-formed, or a recognised
// provider host in a path shape the detector does not read -- and says so.
// `unsupported-string` is the one that cannot name a cause: it covers a scheme
// the shared allowlist refuses, a space or C0 control the URL parser would
// strip from either end, and a well-formed url that simply matched nothing.
// "Its scheme or its host is not one Playdeck plays" was wrong for two of those
// three -- `clip.avi` has neither a scheme nor a host, and an invisible control
// character on an otherwise playable `.mp4` url is nothing to do with the host
// -- so it states the requirement instead of guessing which half of it failed.
const refusedSourceMessage = (source: SourceDetectionFailure): string => {
  const echoed = echoSource(source.input);
  // The format is read back out of core's one list rather than spelled here,
  // so this sentence cannot name DASH for a source refused as something else
  // once a second format joins that list. `input` is a string wherever this
  // reason is raised -- it comes from the extension of a url -- and the guard
  // is what proves it to the type rather than a claim that it could be absent.
  if (source.reason === 'unsupported-format') {
    const format =
      typeof source.input === 'string'
        ? unsupportedSourceFormat(source.input)
        : undefined;
    if (format) {
      return `Playdeck does not play ${format}. The player source "${echoed}" is a ${format} manifest, and Playdeck plays HLS (.m3u8), MP4 and WebM. ${SOURCE_GUIDANCE}`;
    }
  }
  if (source.reason === 'malformed-string') {
    return `Playdeck could not read a video from the player source "${echoed}" — it is either not a well-formed URL, or a provider URL in a form Playdeck does not read. ${SOURCE_GUIDANCE}`;
  }
  if (source.reason === 'unsupported-string') {
    return `Playdeck will not play the player source "${echoed}". An accepted source URL is http(s) or scheme-less, carries no control character at either end, and is either a YouTube, Vimeo or Wistia URL or a path ending .mp4, .webm or .m3u8. ${SOURCE_GUIDANCE}`;
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
// beats inventing a reason.
//
// It names a fix rather than only a field. `cause` still carries the rejection,
// but `ErrorDisplay` renders `error.message` and nothing else
// (`loading-error.tsx:341`, `:345`), so a message whose only next step is
// `error.cause` dead-ends for the person actually looking at the player. The
// document is the step both audiences can take, and its provider-load section
// is what forwards to the CSP origins list -- one place to keep true, rather
// than a second link maintained here.
const providerError = (cause: unknown, type: ResolvedPlayerSource['type']) => ({
  category: 'provider' as const,
  cause,
  fatal: false,
  recoverable: true,
  message: `Unable to load the ${PROVIDER_LABELS[type]} provider. Playdeck cannot say why: the rejection it caught is on this error's cause. See https://github.com/pedrosousa13/playdeck/blob/main/docs/provider-setup.md for what to check.`
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
    playGateOpen: false,
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
  const [playGateIdentity, setPlayGateIdentity] = useState<string | undefined>(
    undefined
  );
  const sourceCommitted = committedIdentity === currentActivationIdentity;
  // Whether there is a gate at all. `playThreshold` defaults to `loadThreshold`,
  // and two equal thresholds are met by the same entry -- `meetsThreshold` is a
  // pure function of the entry and the number -- so the crossing that loads is
  // also the crossing that plays, and holding playback behind a second piece of
  // state would only mean announcing autoplay to the controller one render
  // later than it is announced today. That would be observable: `Root` reports
  // the muted-autoplay-against-`muted={false}` conflict through the same
  // `configureAutoplay` call, and it must still be reported at mount for the
  // consumer who separated nothing. So the gate exists only where the consumer
  // asked for the two decisions to come apart.
  const playGateDeferred =
    options.loading === 'viewport' &&
    options.playThreshold > options.loadThreshold;
  const playGateOpen =
    !playGateDeferred || playGateIdentity === currentActivationIdentity;

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
      active.playGateOpen = false;
      active.queuedPlay = false;
      loadingGeneration.current = undefined;
      disconnectObserver(observerRef.current);
      observerRef.current = undefined;
      options.controller.setProvider(undefined);
      options.controller.setActivation({ activation: 'dormant' });
      setCommittedIdentity(undefined);
      setPlayGateIdentity(undefined);
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

  // The play threshold's counterpart to `activate`, guarded on the same session
  // fields for the same reason: the crossing is reported from an observer
  // callback, which can arrive after the source, the strategy or the
  // configuration it was built for has been replaced, and opening the gate for a
  // session that no longer exists would let the next one play at whatever ratio
  // the last one happened to reach.
  const openPlayGate = useCallback(() => {
    const active = session.current;
    const current = optionsRef.current;
    const key = sourceKey(current.source);
    const configuration = activationConfiguration(current);
    if (
      active.playGateOpen ||
      active.sourceKey !== key ||
      active.loading !== current.loading ||
      active.configuration !== configuration ||
      configuration !== 'valid'
    ) {
      return;
    }
    // Recorded on the session either way, because the observer's own
    // self-disconnect reads it: skip it and nothing ever stops observing.
    active.playGateOpen = true;
    // The state is only what defers the gate needs. Where the two thresholds
    // are equal, `playGateOpen` is derived `true` without ever reading this
    // identity, so setting it would buy a re-render per activation that the
    // single-threshold player never paid before. Deferred-ness is recomputed
    // from `optionsRef.current` rather than closed over, since this callback is
    // built once and the render that computes `playGateDeferred` is not this
    // one.
    const deferred =
      current.loading === 'viewport' &&
      current.playThreshold > current.loadThreshold;
    if (!deferred) return;
    setPlayGateIdentity(
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
    // where a cosmetic `playerColor` rejection suppressed a rejected poster.
    // That slot is now ranked by the severity each notice declares (#368);
    // `setActivation` ranks nothing, so here the check order is still what
    // decides, and the refusal is checked first so it is never the second thing
    // a consumer is told. Neither error is
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
    if (options.loading !== 'viewport') return;
    // The observer is kept until *both* gates have been crossed, not until the
    // provider has been activated: under a deferred `playThreshold` the same
    // observer still owes a play crossing after it has reported the load one.
    // So the settled test is both, and while only one has landed this effect
    // stays willing to rebuild -- otherwise a re-run for any other reason would
    // run its cleanup, disconnect the observer and leave the play threshold
    // with nothing watching for it.
    if (session.current.started && session.current.playGateOpen) return;
    if (refusedMessage !== undefined) {
      options.controller.setActivation({
        activation: 'error',
        error: refusedSourceError(refusedMessage)
      });
      return;
    }
    // Reported here rather than from an effect of its own, on the same terms as
    // the interaction/autoplay conflict: after the source refusal, so a
    // configuration complaint is never what a consumer is told instead of a URL
    // this library will not carry, and before the observer is built, because a
    // configuration `activate` refuses is one no crossing could act on.
    if (currentConfiguration === 'invalid-play-threshold') {
      options.controller.setActivation({
        activation: 'error',
        error: configurationError(
          'playThreshold cannot be below loadThreshold.'
        )
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
      currentObserver.loadThreshold === options.loadThreshold &&
      currentObserver.playThreshold === options.playThreshold
    )
      return;
    disconnectObserver(currentObserver);
    const active = session.current;
    const generation = active.generation;
    const key = active.sourceKey;
    const loading = active.loading;
    const configuration = active.configuration;
    let registration: ObserverRegistration | undefined;
    // Deliberately not compared against the generation this registration was
    // built at, unlike every other staleness check here. `generation` counts
    // every provider reload as well as every session -- registering the media
    // element bumps it, and so does a changed `nativeOptions` bag -- and an
    // observer now outlives the activation it reported, waiting on the play
    // threshold. Holding it to its build-time generation would silence it at
    // the first of those bumps, which is the media mount the activation it just
    // reported causes: the load crossing would land, the play crossing never
    // would. What the generation stood in for is covered exactly by the two
    // identity checks that open this, and the invariant behind them: an
    // observer is only ever installed under `loading: 'viewport'`, and no path
    // that ends a viewport session leaves one behind -- disconnecting it and
    // clearing `observerRef` is what ending such a session means. So a
    // registration still held in `observerRef` under the same viewport is by
    // construction the current one, whatever the generation has counted since.
    const isCurrentObservation = (): boolean => {
      const inputs = latestInputsRef.current;
      return (
        registration !== undefined &&
        observerRef.current === registration &&
        viewportRef.current === viewport &&
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
          if (!isCurrentObservation()) return;
          const active = session.current;
          if (
            !active.started &&
            entries.some((entry) =>
              meetsThreshold(entry, options.loadThreshold)
            )
          ) {
            activate(false);
          }
          if (
            entries.some((entry) =>
              meetsThreshold(entry, options.playThreshold)
            )
          ) {
            openPlayGate();
          }
          // Both gates, so a deferred `playThreshold` keeps the observer that
          // reported the load crossing. Where the two thresholds are equal --
          // every consumer who set at most one of them -- the same entry meets
          // both, so this disconnects in the callback that activated, exactly
          // as it did before there were two gates to cross.
          if (!active.started || !active.playGateOpen) return;
          disconnectObserver(registration);
          observerRef.current = undefined;
        },
        {
          rootMargin: options.loadMargin,
          threshold: observerThresholds(
            options.loadThreshold,
            options.playThreshold
          )
        }
      );
      registration = {
        configuration,
        generation,
        loadThreshold: options.loadThreshold,
        loading,
        margin: options.loadMargin,
        observer,
        playThreshold: options.playThreshold,
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
            'The viewport loadMargin, loadThreshold or playThreshold configuration is invalid.'
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
    currentConfiguration,
    currentKey,
    openPlayGate,
    options.controller,
    options.loadMargin,
    options.loadThreshold,
    options.loading,
    options.playThreshold,
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
      playGateOpen,
      preload: options.preload,
      registerMedia,
      registerViewport,
      sourceCommitted
    }),
    [
      activateFromInteraction,
      options.loading,
      playGateOpen,
      options.preload,
      registerMedia,
      registerViewport,
      sourceCommitted
    ]
  );
};
