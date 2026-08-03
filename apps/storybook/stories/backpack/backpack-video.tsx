import * as Player from '@reely/react';
import { useEffect, useRef, useState, type Ref } from 'react';

/**
 * The slice of EF Backpack's `VideoPlayer` prop API this wrapper reimplements
 * on Reely primitives. Every name is Backpack's own — the point of the wrapper
 * is that a Backpack consumer's props keep working unchanged.
 *
 * Reference: `backpack/src/components/Video/VideoPlayer.tsx`.
 */
export type BackpackVideoProps = {
  /** Additional CSS classes to apply to the component. */
  readonly className?: string;
  /** Set to `true` or `false` to show or hide the player controls. */
  readonly controls?: boolean;
  /** Set to `true` to loop the video once ended. */
  readonly loop?: boolean;
  /** Mutes the player on load. */
  readonly muted?: boolean;
  /** Callback function when the video is played or paused. */
  readonly onPlayChange?: (isPlaying: boolean) => void;
  /** Set to `true` to start playing on load. */
  readonly playing?: boolean;
  /**
   * Backpack's `VideoPlayer` forwards a ref to its underlying player; this
   * wrapper forwards Reely's `PlayerHandle` in the same position.
   */
  readonly ref?: Ref<Player.PlayerHandle>;
  /** Whether to show the play icon when the video is not playing. */
  readonly showPlayIcon?: boolean;
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
  'className' | 'controls' | 'onPlayChange' | 'playing' | 'showPlayIcon'
> & {
  /** Whether `Player.Root` was given the interaction loading strategy. */
  readonly loadsOnInteraction: boolean;
};

/**
 * Everything below `Player.Root`, so it can read player state and issue player
 * commands.
 *
 * `isPlaying` is component state rather than a read of `state.playback`, which
 * is how Backpack's `useVideoPlayerState` models it: the component asks for
 * playback and the player confirms it afterwards. Reely is driven from here,
 * and what Reely confirms is folded back in.
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
 * attaches simply reports not-ready. The play icon follows Backpack's own
 * condition (`VideoPlayer.tsx:349-351`), which keeps showing it under visible
 * controls until playback has started once.
 */
const BackpackVideoSurface = ({
  className,
  controls,
  loadsOnInteraction,
  onPlayChange,
  playing,
  showPlayIcon
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

  const requestPlayback = (next: boolean) => {
    setIsPlaying(next);
    if (next) setStartedPlaying(true);
  };

  // What the player reports, folded back in — Backpack's `onPlaying` and
  // `onPause` handlers. Only a change is applied, so a player that reports
  // nothing (no provider attached yet) leaves the requested state alone
  // instead of clobbering it.
  if (playerReported) requestPlayback(playerPlaying);
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

  return (
    <Player.Viewport
      className={['ef-video-player', className].filter(Boolean).join(' ')}
      data-playing={isPlaying}
    >
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
      >
        {''}
      </Player.ActivationButton>
    </Player.Viewport>
  );
};

export const BackpackVideo = ({
  className,
  controls = false,
  loop = false,
  muted = false,
  onPlayChange,
  playing,
  ref,
  showPlayIcon = true,
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
        className={className}
        controls={controls}
        loadsOnInteraction={!startsPlaying}
        onPlayChange={onPlayChange}
        playing={playing}
        showPlayIcon={showPlayIcon}
      />
    </Player.Root>
  );
};
