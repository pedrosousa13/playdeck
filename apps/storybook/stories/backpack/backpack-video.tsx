import * as Player from '@reely/react';
import {
  useMemo,
  useState,
  type CSSProperties,
  type ElementType,
  type Ref
} from 'react';
import {
  mergeWistiaPlayerConfig,
  translateWistiaPlayerConfig,
  type BackpackVideoPlayerConfig
} from './backpack-video-player-config';
import {
  backpackVideoStyles,
  resolveAspectRatios,
  resolveVariantClass,
  type BackpackAspectRatio,
  type BackpackBreakpointProp,
  type BackpackVideoPlayIconSize,
  type BackpackVideoThemeConfig,
  type BackpackVideoVariant
} from './backpack-video-styles';
import { useChanged, useOnChange } from './use-on-change';
import { VideoCoverImage } from './video-cover-image';
import { useVideoThumbnail } from './video-thumbnail';
import { useOffScreenPause } from './off-screen-pause';

/**
 * The slice of EF Backpack's `VideoPlayer` prop API this wrapper reimplements
 * on Reely primitives. Every name is Backpack's own — the point of the wrapper
 * is that a Backpack consumer's props keep working unchanged.
 *
 * Reference: `backpack/src/components/Video/VideoPlayer.tsx`.
 */
export type BackpackVideoProps = {
  /** Alternative text on the cover image. */
  readonly alt?: string;
  /**
   * Aspect ratio of the video player: one value for every width, or a map
   * keyed by Backpack's breakpoints. Defaults to `{ s: 'natural' }`
   * (`VideoPlayer.tsx:78,189`); `s` is the unprefixed base rather than a
   * 480px breakpoint, and what `'natural'` resolves to is the one place this
   * wrapper deliberately parts company with Backpack — see
   * `naturalAspectRatio` in `backpack-video-styles.ts`.
   */
  readonly aspectRatios?:
    BackpackAspectRatio | BackpackBreakpointProp<BackpackAspectRatio>;
  /** Additional CSS classes to apply to the component. */
  readonly className?: string;
  /** Set to `true` or `false` to show or hide the player controls. */
  readonly controls?: boolean;
  /** Zoom the cover image while hovered and not playing. */
  readonly hoverEffect?: boolean;
  /**
   * Root element for the `IntersectionObserver` behind
   * `pauseOnOutOfViewport`. `null`, the default, is the browser viewport; pass
   * a scroll container's element when the video lives inside one rather than
   * in the page itself — a modal or a custom scroll area.
   */
  readonly intersectionObserverRoot?: Element | null;
  /**
   * Show the provider's own thumbnail as a cover instead of mounting the
   * player until the viewer asks for playback. Backpack types this
   * `boolean | string | ReactElement` and defaults it to `true`; this wrapper
   * takes the boolean only — the string form is what `placeholderImageSrc`
   * already expresses here — and defaults it to `false`. Backpack's default
   * fetches a thumbnail from a third-party endpoint on every mount; this
   * wrapper already defers mounting the player until activation (its loading
   * strategy is `interaction`, not `light`'s doing), so `light: true` here
   * only adds the thumbnail image on top of that, and turning it on by
   * default would add a network request nothing asked for.
   */
  readonly light?: boolean;
  /** Set to `true` to loop the video once ended. */
  readonly loop?: boolean;
  /** Mutes the player on load. */
  readonly muted?: boolean;
  /** Callback function when the video is played or paused. */
  readonly onPlayChange?: (isPlaying: boolean) => void;
  /** Whether to pause the video when it scrolls off screen. */
  readonly pauseOnOutOfViewport?: boolean;
  /**
   * Per-provider presentation options, in Backpack's own option names
   * (`VideoPlayer.tsx:45-55`'s `playerConfig`). Only `wistia` is wired, and
   * only its four keys documented on {@link BackpackVideoPlayerConfig} — a
   * passthrough for every option a provider takes is out of scope. Merged
   * over this wrapper's own Wistia defaults — empty today, so an omitted key
   * keeps `@wistia/wistia-player`'s own behavior rather than this wrapper's;
   * a caller wins on any key it sets — and translated to Reely's own option
   * names by `translateWistiaPlayerConfig`, whose doc comment carries the
   * translation table.
   */
  readonly playerConfig?: BackpackVideoPlayerConfig;
  /**
   * Size of the play icon, defaulting to Backpack's own `'m'`
   * (`VideoPlayer.tsx:142,206`). Narrowed to the two sizes its stories use —
   * `BackpackVideoPlayIconSize` says why.
   */
  readonly playIconSize?: BackpackVideoPlayIconSize;
  /** Set to `true` to start playing on load. */
  readonly playing?: boolean;
  /**
   * URL of a custom cover image, shown before the player mounts. Wins over
   * any thumbnail `light` would otherwise fetch.
   */
  readonly placeholderImageSrc?: string;
  /**
   * Backpack's `VideoPlayer` forwards a ref to its underlying player; this
   * wrapper forwards Reely's `PlayerHandle` in the same position.
   */
  readonly ref?: Ref<Player.PlayerHandle>;
  /**
   * Element type used to render the cover image, receiving `src`, `alt` and
   * `className`.
   */
  readonly renderCustomImage?: ElementType;
  /** Whether to show the play icon when the video is not playing. */
  readonly showPlayIcon?: boolean;
  /**
   * Replaces the class a `variant` puts on the player box. One overridable
   * field rather than a theming system — `BackpackVideoThemeConfig` says why,
   * and `backpackVideoStyles` is what it overrides.
   */
  readonly themeConfig?: BackpackVideoThemeConfig;
  /** `IntersectionObserver` threshold behind `pauseOnOutOfViewport`. */
  readonly threshold?: number;
  /** The url of a video to play. */
  readonly url: string;
  /**
   * Visual treatment of the player box — a border or a drop shadow. Backpack
   * types this `BoxVariantValues` (`VideoPlayer.tsx:73`) and resolves it
   * through `videoStyles.variants.variant`; the wrapper takes the two its
   * stories use, approximated in story-local CSS.
   */
  readonly variant?: BackpackVideoVariant;
};

/**
 * {@link BackpackVideoProps} plus the one prop that is not Backpack's. Kept out
 * of the exported type deliberately: that type is a compatibility obligation to
 * Backpack's consumers (ADR-0003, `docs/adr/0003-backpack-is-a-scenario-source-not-a-spec.md:54-57`)
 * and this is no part of it — it exists so a composition in this repository can
 * reach a `Player.Root` setting Backpack's API has no word for.
 *
 * Exported for {@link BackpackVideoInternal}'s signature only. `BackpackVideo`,
 * the public name, takes {@link BackpackVideoProps} and forces the extra prop
 * off, so "internal" is enforced by the compiler and at runtime rather than
 * asserted in a comment — pinned in
 * `backpack-autoplay-video.contract.test.ts`.
 */
export type BackpackVideoInternalProps = BackpackVideoProps & {
  /**
   * Load the provider when the player's box first scrolls into view, and — with
   * `playing` left at its default — start playing there. Internal to this
   * wrapper, not part of Backpack's prop API, and with `BackpackAutoplayVideo`
   * as its only caller: Backpack has no equivalent prop because it has no
   * equivalent strategy, its `AutoplayVideo` mounting a player that plays at
   * once and leaving `pauseOnOutOfViewport` to stop it again if that happened
   * off screen (`Video/AutoplayVideo.tsx:30`,
   * `Video/useVideoPlayerState.ts:144-154`).
   *
   * Defaults to `false`, so every other caller keeps the strategy `playing`
   * chose for it. Read live rather than frozen at mount like `playing` below,
   * because the one caller passes a constant — a flip would tear down the
   * attached provider, as a change of strategy always does
   * (`packages/react/src/use-activation.ts:237-256`, its
   * `active.loading !== options.loading` branch).
   */
  readonly autoplayOnViewportEntry?: boolean;
};

type SurfaceProps = Pick<
  BackpackVideoProps,
  | 'alt'
  | 'aspectRatios'
  | 'className'
  | 'controls'
  | 'hoverEffect'
  | 'intersectionObserverRoot'
  | 'onPlayChange'
  | 'playIconSize'
  | 'playing'
  | 'renderCustomImage'
  | 'showPlayIcon'
  | 'themeConfig'
  | 'threshold'
  | 'variant'
> & {
  /** The resolved cover image source, or `undefined` when there is none. */
  readonly coverSrc?: string;
  /** Whether `Player.Root` was given the interaction loading strategy. */
  readonly loadsOnInteraction: boolean;
  /**
   * Required where the public prop is optional: `BackpackVideo` has already
   * applied the default, and `useOffScreenPause` asks for the answer rather
   * than re-defaulting it. `threshold` and `intersectionObserverRoot` above
   * stay optional because `IntersectionObserver` already defaults them to the
   * same values, so nothing here has to restate them.
   */
  readonly pauseOnOutOfViewport: boolean;
};

/**
 * Everything below `Player.Root`, so it can read player state and issue player
 * commands.
 *
 * `isPlaying` is component state rather than a read of `state.playback`, because
 * this component is what asks for playback and the player only confirms it
 * afterwards: a request has to be representable before there is anything to
 * confirm, and `state.playback` can only ever report the confirmation. What the
 * player confirms is folded back in. Backpack models it the same way, in
 * `useVideoPlayerState`.
 *
 * Which affordance is on screen, in every state. `awaitingActivation` below is
 * exactly the condition `Player.ActivationButton` renders itself under
 * (`packages/react/src/loading-error.tsx:40`), so the two are complements and
 * precisely one click target is on the surface at any moment:
 *
 * | `awaitingActivation` | `controls` | click target                     | play icon             |
 * | -------------------- | ---------- | -------------------------------- | --------------------- |
 * | yes                  | either     | `Player.ActivationButton`        | while paused          |
 * | no                   | `false`    | this component's toggle `button` | while paused          |
 * | no                   | `true`     | `Player.Controls`                | until playback starts |
 *
 * The activation button is what loads the provider, so it has to be the target
 * until one has attached — there is nothing to toggle before that. It renders
 * only under the interaction strategy, which is why `awaitingActivation` is
 * false for the whole of an eagerly-loaded (`playing`) player: there the toggle
 * is the target from the start, and a command issued before the provider
 * attaches simply reports not-ready. The play icon stays up under visible
 * controls until playback has started once, because until then it is the only
 * thing on the surface that says this box is a video worth clicking; afterwards
 * the controls' own button carries the state and a second icon would just
 * contradict it. Backpack's condition is the same
 * (`VideoPlayer.tsx:349-351`).
 *
 * A cover image, when there is one, sits above `Player.Media` for as long as
 * playback has never started — independent of every row in the table above,
 * which is why it can cover an activation button, a toggle or visible
 * controls alike. It changes nothing about which of those is the click
 * target: `Player.Poster` is `pointer-events: none`, so the cover is purely a
 * visual layer over whichever affordance the table already puts on top.
 */
const BackpackVideoSurface = ({
  alt,
  aspectRatios,
  className,
  controls,
  coverSrc,
  hoverEffect,
  intersectionObserverRoot,
  loadsOnInteraction,
  onPlayChange,
  pauseOnOutOfViewport,
  playIconSize,
  playing,
  renderCustomImage: CustomImage,
  showPlayIcon,
  themeConfig,
  threshold,
  variant
}: SurfaceProps) => {
  const actions = Player.usePlayerActions();
  const { playerPlaying, ready } = Player.usePlayerState((state) => ({
    playerPlaying: state.playback === 'playing',
    ready: state.activation === 'ready'
  }));
  // Both start false even when `playing` is set. `playing` is a request, and
  // only the player can say it was granted: it is served by autoplay on the
  // root, not by this state, so seeding from it bought nothing and could lie —
  // an audible autoplay the browser blocks leaves playback paused, and a
  // seeded `true` would label the button "Pause video" over a stopped video
  // with no way back, since a value that never changes never reconciles.
  const [isPlaying, setIsPlaying] = useState(false);
  const [startedPlaying, setStartedPlaying] = useState(false);
  const playerReported = useChanged(playerPlaying);
  const propChanged = useChanged(playing);
  // Destructured under other names because `react-hooks/refs` reads a member
  // named `ref` as a ref object being dereferenced during render, and would
  // then treat every other member of the same object as one too.
  const { intent: offScreenIntent, ref: observeViewport } = useOffScreenPause({
    // The wrapper's answer to "is an explicit pause in force": Backpack asks
    // `(playing ?? parentPlaying) === false` (`useVideoPlayerState.ts:118`)
    // and there is no `parentPlaying` here.
    controlledPaused: playing === false,
    isPlaying,
    pauseOnOutOfViewport,
    root: intersectionObserverRoot,
    startedPlaying,
    threshold
  });
  const offScreenRequested = useChanged(offScreenIntent);

  const requestPlayback = (next: boolean) => {
    setIsPlaying(next);
    if (next) setStartedPlaying(true);
  };

  // What the player reports, folded back in — Backpack's `onPlaying` and
  // `onPause` handlers. Only a change is applied, so a player that reports
  // nothing (no provider attached yet) leaves the requested state alone
  // instead of clobbering it.
  if (playerReported) requestPlayback(playerPlaying);
  // A scroll took the video off screen or brought it back. Applied *after* the
  // player's report: the report says what playback already was, where the
  // intent decides what it should be now, and the hook raises each intent once
  // (`off-screen-pause.ts:53-63`) — so a report that lands in the same commit
  // (a provider confirming the play the viewer just started) would swallow the
  // pause with nothing left to raise it again. Applied *before* the `playing`
  // prop for the reason below: the parent's explicit value stays the last
  // word, which is also why the hook takes `controlledPaused` and asks for a
  // pause rather than a resume while one is in force.
  if (offScreenRequested) requestPlayback(offScreenIntent.playing);
  // `playing` is the parent's explicit override, so it is applied after the
  // player's own report and wins a render where both changed.
  if (propChanged && playing !== undefined) requestPlayback(playing);

  // The one place the player is driven. Both commands are idempotent, so a
  // change the player reported itself costs a redundant no-op rather than a
  // branch to suppress it.
  useOnChange(isPlaying, (next) => {
    void (next ? actions.play() : actions.pause());
  });
  // Never fires for the initial value, so a consumer does not see a spurious
  // `onPlayChange(false)` on mount (Backpack's `prevIsPlayingRef`).
  useOnChange(isPlaying, onPlayChange);

  const ariaLabel = isPlaying ? 'Pause video' : 'Play video';
  const awaitingActivation = loadsOnInteraction && !ready;
  // Independent of `light`: a caller-supplied `placeholderImageSrc` shows a
  // cover even with `light: false` (Backpack's `hasCustomCoverImage`).
  const showsCover = Boolean(coverSrc) && !startedPlaying;

  return (
    <Player.Viewport
      className={[
        backpackVideoStyles.slots.root,
        resolveVariantClass(variant, themeConfig),
        className
      ]
        .filter(Boolean)
        .join(' ')}
      data-playing={isPlaying}
      // The element the off-screen observer watches: the outer player box, since
      // that is the thing whose visibility the behaviour is about. The media
      // element inside it is the wrong target — it is absent until a provider
      // attaches, and an embed may size itself independently. Backpack observes
      // the same box (`VideoPlayer.tsx:225,312`).
      // `Player.Viewport` merges this with the ref it keeps for itself
      // (`packages/react/src/viewport-media.tsx:63-89`).
      ref={observeViewport}
      // One custom property per breakpoint, which the min-width queries in
      // `backpack-video-styles.ts` read. Custom properties rather than an inline
      // `aspect-ratio`, because an inline declaration cannot be conditioned on
      // a media query — the value has to reach a stylesheet for a breakpoint
      // map to mean anything. `resolveAspectRatios` says why all five are
      // always written. Cast because React's `CSSProperties` admits no
      // custom-property keys.
      style={resolveAspectRatios(aspectRatios) as CSSProperties}
    >
      {/* `coverSrc` again beside `showsCover`, which already implies it: the
          shared cover image below takes a `string`, and this is what narrows the
          optional one for the compiler. */}
      {showsCover && coverSrc ? (
        // `Player.Poster` is the container, and it is what makes the `alt` inside
        // a DOM attribute rather than an accessible name: it sets
        // `aria-hidden="true"` (`packages/react/src/poster.tsx:66`), so nothing
        // rendered in it reaches the accessibility tree. Backpack does expose the
        // text — `VideoCoverImage` puts `role="button"` and `aria-label={alt}` on
        // its cover container (`VideoCoverImage.tsx:99-100`) — where here the
        // labelled affordance is the real button underneath, reading "Play video"
        // (SIDEPRO-214). {@link VideoCoverImage} carries the rest of the argument,
        // and `BackpackVideoHoverPreview` gives the same image a container that is
        // not hidden.
        <Player.Poster
          className="ef-video-cover"
          data-hover-effect={hoverEffect}
        >
          <VideoCoverImage
            alt={alt}
            renderCustomImage={CustomImage}
            src={coverSrc}
          />
        </Player.Poster>
      ) : null}
      <Player.Media />
      {!isPlaying && (!startedPlaying || !controls) && showPlayIcon ? (
        <span
          aria-hidden="true"
          className="ef-video-play-icon"
          // Always written, including for the default `m` whose size is the
          // base rule: a story reads the attribute rather than inferring the
          // size from a box measurement alone.
          data-play-icon-size={playIconSize}
        />
      ) : null}
      {!awaitingActivation && controls ? (
        <Player.Controls
          aria-label="Video player controls"
          className="ef-video-controls"
        >
          <Player.PlayButton />
        </Player.Controls>
      ) : null}
      {!awaitingActivation && !controls ? (
        <button
          aria-label={ariaLabel}
          aria-pressed={isPlaying}
          className="ef-video-controller"
          onClick={() => requestPlayback(!isPlaying)}
          type="button"
        />
      ) : null}
      {/*
        Renders itself away once the provider is ready (`loading-error.tsx:40`),
        handing the surface to the toggle above. An empty string rather than no
        children: the primitive falls back to its own "Play" text for a nullish
        child, and the play icon above is already the visual affordance.
      */}
      <Player.ActivationButton
        aria-label={ariaLabel}
        className="ef-video-controller"
        // Backpack's `onClickPreview={start}`, which is optimistic: it flips
        // Backpack's own playing state at click time rather than on the
        // player's confirmation. Reely already starts playback from this
        // click on its own — `activateFromInteraction` calls `activate(true)`
        // (`packages/react/src/use-activation.ts:355`), which queues the play
        // (`:294`, `active.queuedPlay = queuePlay`) for the loader to replay
        // once the provider's `load()` resolves (`:564-577`, from
        // `const queuePlay = session.current.queuedPlay`) — so what this
        // handler adds is only the optimistic half: the cover comes off and
        // `onPlayChange(true)` fires immediately instead of after the
        // provider reports playing. Scoped
        // to `showsCover` so the coverless stories keep reporting only what
        // the player confirms.
        onClick={showsCover ? () => requestPlayback(true) : undefined}
      >
        {''}
      </Player.ActivationButton>
    </Player.Viewport>
  );
};

/**
 * The whole wrapper, with the one setting Backpack's API has no word for
 * ({@link BackpackVideoInternalProps}) reachable. Not the name a Backpack
 * consumer imports — {@link BackpackVideo} below is — and
 * `BackpackAutoplayVideo` is its only other caller.
 */
export const BackpackVideoInternal = ({
  alt = '',
  aspectRatios,
  autoplayOnViewportEntry = false,
  className,
  controls = false,
  hoverEffect = true,
  intersectionObserverRoot = null,
  light = false,
  loop = false,
  muted = false,
  onPlayChange,
  pauseOnOutOfViewport = true,
  placeholderImageSrc,
  playerConfig,
  playIconSize = 'm',
  playing,
  ref,
  renderCustomImage,
  showPlayIcon = true,
  themeConfig,
  threshold = 0,
  url,
  variant
}: BackpackVideoInternalProps) => {
  // Backpack's `playing` means "start playing on load", which on Reely is
  // autoplay. Read once at mount because it is a load-time decision:
  // re-deciding it later tears down the attached provider and reloads the
  // source.
  const [startsPlaying] = useState(playing ?? false);
  // Where the load happens. Named rather than inlined because two things follow
  // from it — the strategy `Player.Root` gets, and whether the surface expects
  // `Player.ActivationButton` to be its click target — and a second copy of the
  // decision would be free to disagree with the first. For a Backpack caller the
  // prop above decides it: start-on-load loads eagerly and autoplays,
  // everything else loads on the first interaction, which
  // `Player.ActivationButton` performs, because Reely rejects `interaction`
  // loading together with autoplay (`packages/react/src/use-activation.ts:95`,
  // `loading === 'interaction' && autoplay !== false`)
  // — a strategy that waits for a click cannot also start by itself. `viewport`
  // is reachable only through the internal prop, and is legal with autoplay
  // where `interaction` is not.
  const loading = autoplayOnViewportEntry
    ? 'viewport'
    : startsPlaying
      ? 'eager'
      : 'interaction';
  // Mirrors Backpack's `light={videoLight && !playing && !startedPlaying}`: a
  // player asked to start on load has no pre-play surface to present, so it
  // must not pay for a thumbnail lookup either.
  const coverSrc = useVideoThumbnail(
    light && !startsPlaying ? url : undefined,
    placeholderImageSrc
  );
  // Recomputed only when `playerConfig` itself changes identity, so a caller
  // passing a stable `playerConfig` gets a stable `providerOptions` back.
  // Not required for correctness — `Player.Root`'s own comparison is by value,
  // per key, so an unmemoized bag that is merely value-equal would not
  // re-attach the provider either (`use-activation.ts`'s `providerBagEqual`)
  // — but it costs nothing to skip the rebuild on an unrelated re-render.
  const providerOptions = useMemo<Player.PlayerProviderOptions>(
    () => ({
      wistia: translateWistiaPlayerConfig(
        mergeWistiaPlayerConfig(playerConfig?.wistia)
      )
    }),
    [playerConfig]
  );

  return (
    <Player.Root
      autoplay={startsPlaying ? (muted ? 'muted' : 'audible') : false}
      // Under the `viewport` strategy, activation is what starts playback: it
      // does not queue a play of its own (`use-activation.ts:456`, its
      // `activate(false)`), so the autoplay attempt that follows the provider
      // becoming ready is the whole of the start. Loading early would therefore
      // also play early — off screen, which is the thing the strategy was
      // chosen to avoid — so the preload margin `Player.Root` defaults to
      // (`packages/react/src/root.tsx:98`, `loadMargin = '200px 0px'`)
      // is dropped to nothing. `undefined` everywhere else, where no observer
      // reads it at all (`use-activation.ts:388`,
      // `if (options.loading !== 'viewport'`), leaving Reely's own default
      // in place rather than restating a value nothing consults.
      loadMargin={autoplayOnViewportEntry ? '0px' : undefined}
      loading={loading}
      loop={loop}
      muted={muted}
      providerOptions={providerOptions}
      ref={ref}
      source={url}
    >
      <BackpackVideoSurface
        alt={alt}
        // Passed through undefaulted: the default is a breakpoint map rather
        // than one value, and `resolveAspectRatios` needs it per breakpoint —
        // an unnamed narrow breakpoint falls back to it too — so it lives
        // there rather than being restated here.
        aspectRatios={aspectRatios}
        className={className}
        controls={controls}
        coverSrc={coverSrc}
        hoverEffect={hoverEffect}
        intersectionObserverRoot={intersectionObserverRoot}
        loadsOnInteraction={loading === 'interaction'}
        onPlayChange={onPlayChange}
        pauseOnOutOfViewport={pauseOnOutOfViewport}
        playIconSize={playIconSize}
        playing={playing}
        renderCustomImage={renderCustomImage}
        showPlayIcon={showPlayIcon}
        themeConfig={themeConfig}
        threshold={threshold}
        variant={variant}
      />
    </Player.Root>
  );
};

/**
 * Backpack's `VideoPlayer` on Reely primitives, as a Backpack consumer imports
 * it: {@link BackpackVideoProps} exactly, and nothing besides.
 *
 * A pass straight through to {@link BackpackVideoInternal} with
 * `autoplayOnViewportEntry` forced off after the spread, which is what makes
 * "internal" a fact rather than a claim. Two things follow, and both are the
 * point: the prop is absent from this component's props type, so passing it is a
 * compile error, and forcing it *after* the spread means a caller who gets round
 * the compiler — an `any`, an untyped spread of unknown props — still gets the
 * loading strategy every Backpack caller expects instead of silently opting into
 * a strategy this name does not offer.
 *
 * The ordering is Backpack's own trick, the one its `AutoplayVideo` uses on
 * `light` and `muted` (`Video/AutoplayVideo.tsx:33-34`) — used here for a prop
 * that must not be reachable on this name, rather than for one that is offered
 * and then discarded, which is the half of it recorded as a divergence in
 * `docs/backpack-parity.md`.
 */
export const BackpackVideo = (props: BackpackVideoProps) => (
  <BackpackVideoInternal {...props} autoplayOnViewportEntry={false} />
);
