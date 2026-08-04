import * as Player from '@reely/react';
import { useEffect, useRef, useState, type ElementType, type Ref } from 'react';
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
  /** `IntersectionObserver` threshold behind `pauseOnOutOfViewport`. */
  readonly threshold?: number;
  /** The url of a video to play. */
  readonly url: string;
};

/**
 * True on the render that first sees a new `value`. The update is applied
 * during render rather than from an effect, so a caller's own state settles in
 * the same commit instead of a second one — the shape `Root` uses for its
 * source transition (`packages/react/src/root.tsx:150-152`).
 */
const useChanged = <Value,>(value: Value): boolean => {
  const [seen, setSeen] = useState(value);
  if (Object.is(seen, value)) return false;
  setSeen(value);
  return true;
};

/** Runs `onChange` when `value` changes, never for the value it started with. */
const useOnChange = <Value,>(
  value: Value,
  onChange?: (value: Value) => void
): void => {
  const seen = useRef(value);
  useEffect(() => {
    if (Object.is(seen.current, value)) return;
    seen.current = value;
    onChange?.(value);
  }, [onChange, value]);
};

type SurfaceProps = Pick<
  BackpackVideoProps,
  | 'alt'
  | 'className'
  | 'controls'
  | 'hoverEffect'
  | 'intersectionObserverRoot'
  | 'onPlayChange'
  | 'playing'
  | 'renderCustomImage'
  | 'showPlayIcon'
  | 'threshold'
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
  className,
  controls,
  coverSrc,
  hoverEffect,
  intersectionObserverRoot,
  loadsOnInteraction,
  onPlayChange,
  pauseOnOutOfViewport,
  playing,
  renderCustomImage: CustomImage,
  showPlayIcon,
  threshold
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
  // (`off-screen-pause.ts:51-60`) — so a report that lands in the same commit
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
      className={['ef-video-player', className].filter(Boolean).join(' ')}
      data-playing={isPlaying}
      // The element the off-screen observer watches: the outer player box, since
      // that is the thing whose visibility the behaviour is about. The media
      // element inside it is the wrong target — it is absent until a provider
      // attaches, and an embed may size itself independently. Backpack observes
      // the same box (`VideoPlayer.tsx:225,312`).
      // `Player.Viewport` merges this with the ref it keeps for itself
      // (`packages/react/src/viewport-media.tsx:63-89`).
      ref={observeViewport}
    >
      {showsCover ? (
        <Player.Poster
          className="ef-video-cover"
          data-hover-effect={hoverEffect}
        >
          {CustomImage ? (
            <CustomImage
              alt={alt}
              className="ef-video-cover-image"
              src={coverSrc}
            />
          ) : (
            // The wrapper's own `<img>`, not `Player.PosterImage`: that
            // primitive hard-codes `alt=""` after its prop spread
            // (`packages/react/src/poster.tsx:157-159`), so an `alt` passed to
            // it would be silently discarded — and `renderCustomImage` needs a
            // consumer element type in this position anyway.
            //
            // What this keeps is the DOM attribute, not an accessible name:
            // `Player.Poster` sets `aria-hidden="true"`
            // (`packages/react/src/poster.tsx:65`), so nothing rendered inside
            // it reaches the accessibility tree either way. Backpack does
            // expose the text — `VideoCoverImage` puts `role="button"` and
            // `aria-label={alt}` on the cover container itself
            // (`VideoCoverImage.tsx:99-101`) — where here the labelled
            // affordance is the real button underneath, reading "Play video".
            <img alt={alt} className="ef-video-cover-image" src={coverSrc} />
          )}
        </Player.Poster>
      ) : null}
      <Player.Media />
      {!isPlaying && (!startedPlaying || !controls) && showPlayIcon ? (
        <span aria-hidden="true" className="ef-video-play-icon" />
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
        // (`packages/react/src/use-activation.ts:296`), which queues the play
        // (`:235`) for the loader to replay once the provider's `load()`
        // resolves (`:501-514`) — so what this handler adds is only the
        // optimistic half: the cover comes off and `onPlayChange(true)` fires
        // immediately instead of after the provider reports playing. Scoped
        // to `showsCover` so the coverless stories keep reporting only what
        // the player confirms.
        onClick={showsCover ? () => requestPlayback(true) : undefined}
      >
        {''}
      </Player.ActivationButton>
    </Player.Viewport>
  );
};

export const BackpackVideo = ({
  alt = '',
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
  playing,
  ref,
  renderCustomImage,
  showPlayIcon = true,
  threshold = 0,
  url
}: BackpackVideoProps) => {
  // Backpack's `playing` means "start playing on load", which on Reely is
  // autoplay — and Reely rejects `interaction` loading together with autoplay
  // (`packages/react/src/use-activation.ts:85`), since a strategy that waits
  // for a click cannot also start by itself. So the strategy follows the prop:
  // start-on-load loads eagerly and autoplays, everything else loads on the
  // first interaction, which `Player.ActivationButton` performs. Read once at
  // mount because it is a load-time decision: re-deciding it later tears down
  // the attached provider and reloads the source.
  const [startsPlaying] = useState(playing ?? false);
  // Mirrors Backpack's `light={videoLight && !playing && !startedPlaying}`: a
  // player asked to start on load has no pre-play surface to present, so it
  // must not pay for a thumbnail lookup either.
  const coverSrc = useVideoThumbnail(
    light && !startsPlaying ? url : undefined,
    placeholderImageSrc
  );

  return (
    <Player.Root
      autoplay={startsPlaying ? (muted ? 'muted' : 'audible') : false}
      loading={startsPlaying ? 'eager' : 'interaction'}
      loop={loop}
      muted={muted}
      ref={ref}
      source={url}
    >
      <BackpackVideoSurface
        alt={alt}
        className={className}
        controls={controls}
        coverSrc={coverSrc}
        hoverEffect={hoverEffect}
        intersectionObserverRoot={intersectionObserverRoot}
        loadsOnInteraction={!startsPlaying}
        onPlayChange={onPlayChange}
        pauseOnOutOfViewport={pauseOnOutOfViewport}
        playing={playing}
        renderCustomImage={renderCustomImage}
        showPlayIcon={showPlayIcon}
        threshold={threshold}
      />
    </Player.Root>
  );
};
