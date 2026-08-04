import { useEffect, useRef, useState } from 'react';

/**
 * What the wrapper knows and this hook deliberately does not own. Playback
 * state stays in `BackpackVideoSurface`'s machine
 * (`backpack-video.tsx:256-308`, from its `isPlaying` state to the `useOnChange`
 * that drives the player) — Backpack keeps both in one hook
 * (`useVideoPlayerState`), but here the machine already exists and folding a
 * second owner of `isPlaying` into it would give the same value two homes.
 *
 * File references are into the Backpack v4 beta checkout at
 * `/Users/pedrosousa/Documents/apps/backpack/beta/src/components`.
 */
export type OffScreenPauseOptions = {
  /**
   * Whether an explicit `playing={false}` is in force: a caller holding the
   * video paused has said the last word on playback, and a scroll-back-in must
   * not overrule it. An answer rather than the `playing` prop itself, because
   * only the wrapper knows what else feeds it — Backpack's own answer folds in a
   * second source, its carousel's `parentPlaying`
   * (`Video/useVideoPlayerState.ts:36,117-124`), which has no equivalent here.
   *
   * Read through a ref, never as a dependency — see the hook's doc comment.
   */
  readonly controlledPaused: boolean;
  /**
   * Live playback state. Never a dependency of the *decision* — that is read
   * through a ref, and the hook's doc comment says why it is the whole
   * difficulty of this behaviour. One effect does watch it, and does nothing
   * but drop a pending resume.
   */
  readonly isPlaying: boolean;
  /** Backpack's `pauseOnOutOfViewport` (`Video/VideoPlayer.tsx:159,207`). */
  readonly pauseOnOutOfViewport: boolean;
  /**
   * The observer root, under the `IntersectionObserver` option's own name;
   * the public prop spells it `intersectionObserverRoot`, which is Backpack's
   * name for it (`Video/VideoPlayer.tsx:154,227`). Optional and passed through
   * untouched, so the observer applies its own default: a default here could
   * only ever be a second copy of one, free to disagree with the first.
   */
  readonly root?: Element | null;
  /**
   * Whether playback has started at least once
   * (`backpack-video.tsx:257,278`, its `startedPlaying` state and the
   * `requestPlayback` that sets it), Backpack's `startedPlaying`.
   */
  readonly startedPlaying: boolean;
  /** Backpack's `threshold` (`Video/VideoPlayer.tsx:204,226`). */
  readonly threshold?: number;
};

/**
 * A request for the wrapper's machine, not a state to render. Identity is the
 * signal: a new object is a new request, so the wrapper folds it in with the
 * `useChanged` it already uses for the player's own reports
 * (`backpack-video.tsx:258,274`, its two `useChanged` calls), and re-rendering the
 * same object asks
 * for nothing. A plain boolean could not say that — it would keep asking for a
 * pause for as long as the video stayed off screen, and so would undo a play
 * the viewer started while it was there.
 */
export type OffScreenPlaybackIntent = { readonly playing: boolean };

export type OffScreenPause = {
  readonly intent: OffScreenPlaybackIntent;
  /** For `Player.Viewport`, which merges it with its own ref. */
  readonly ref: (node: Element | null) => void;
};

/**
 * Never applied: the wrapper's `useChanged` fold ignores the value a render
 * starts with, so the first intent the hook raises is the first one it acts on.
 */
const INITIAL_INTENT: OffScreenPlaybackIntent = { playing: false };

/**
 * Pauses a playing video when it scrolls out of view and resumes it when it
 * comes back — Backpack's `pauseOnOutOfViewport`, which is the effect at
 * `Video/useVideoPlayerState.ts:144-154` plus the observer at
 * `hooks/useIntersectionObserverSingleton.tsx`. The hook owns the observer and
 * the resume bookkeeping; the wrapper owns playback.
 *
 * ## The pending resume, and who is allowed to cancel it
 * A resume is armed only by a pause this hook performed, and any later playback
 * change it did not ask for cancels it: the viewer's or the parent's last
 * instruction wins, so a video paused by hand off screen stays paused when it
 * comes back. The hook has to make that call itself — under `controls` the
 * viewer's clicks reach the wrapper as player reports, with no handler on the
 * path that could announce them — which is why it keeps a record of what it
 * asked for. Backpack instead cancels from its own `start` and `toggle`
 * (`:167,174`) — which works there, because its `onPlay` handler routes through
 * `start()`, so a video can never be playing off screen with the flag still
 * armed. This wrapper has no such chokepoint: playback can become live through
 * the player-report fold without passing a handler at all, which is how an
 * earlier revision of this file let a controls-issued pause auto-resume.
 * Recording the request rather than trusting the handlers removes the class of
 * bug instead of the one instance.
 *
 * ## Why `isPlaying` and `controlledPaused` are read from refs
 * A scroll is the only event that may re-run the decision, so the decision
 * effect's dependencies are the observer's answer and the two switches that
 * enable the behaviour, and nothing else. Everything else it needs it reads
 * live. Both of those live reads are load-bearing, and each breaks a different
 * way as a dependency:
 *
 * - `isPlaying` as a dependency would re-run the effect on every play and
 *   pause while the video is off screen, and the pause branch would re-arm the
 *   resume flag — so a video the viewer paused *while* it was off screen would
 *   spring back to life on scroll-in. Backpack writes the same hazard up under
 *   "Why isPlayingRef exists" (`:40-45`), with guards at
 *   `VideoPlayer.test.tsx:207-243`.
 * - `controlledPaused` as a dependency would re-run the effect the moment a
 *   parent lifts `playing={false}`. The wrapper applies that prop during the
 *   same render (`backpack-video.tsx:298`, its `propChanged` branch), so playback
 *   is already live when
 *   the effect runs, and off screen the pause branch would pause the video the
 *   parent just asked to play — inverting the wrapper's own precedence, where
 *   `playing` is the last word.
 *
 * ## Deliberately not mirrored
 * - The observer cache in `useIntersectionObserverSingleton.tsx:42-52`. It
 *   shares one observer between videos with equal options; a single video's
 *   behaviour does not depend on it, and its cache key
 *   (`Object.values(options).toString()`, `:12`) collapses distinct roots to
 *   `[object HTMLDivElement]`.
 * - `freezeOnceVisible` (`:28`) — `VideoPlayer.tsx:228` passes `false`, and an
 *   observer that stops reporting could never pause anything.
 * - `rootMargin` (`:24`). Backpack's `VideoPlayer` exposes no prop for it, so
 *   the wrapper has nothing to pass.
 * - The `window.IntersectionObserver` support check (`:36`). Reely's own
 *   activation path already requires the API
 *   (`packages/react/src/use-activation.ts:407-414`, its
 *   `'Viewport loading requires IntersectionObserver.'`), so a branch here could
 *   only guard an environment where the player itself does not run.
 */
export const useOffScreenPause = ({
  controlledPaused,
  isPlaying,
  pauseOnOutOfViewport,
  root,
  startedPlaying,
  threshold
}: OffScreenPauseOptions): OffScreenPause => {
  // The node arrives as state, not a ref, so the observer effect re-runs the
  // moment it attaches. `Player.Viewport` assigns a consumer ref from an
  // effect of its own (`packages/react/src/viewport-media.tsx:76-88`), which
  // leaves a ref object empty for the render that would have read it —
  // Backpack lives with exactly that, by listing `elementRef?.current` as a
  // dependency (`hooks/useIntersectionObserverSingleton.tsx:58`).
  const [node, setNode] = useState<Element | null>(null);
  // Backpack's `isVisible` and `hasObserverEntry` (`VideoPlayer.tsx:230-231`)
  // in one value: `undefined` until the observer's first entry. Only
  // `isIntersecting` is kept, where Backpack stores the entry — nothing here
  // reads the rest of it, and keeping the object would re-render on every
  // callback that reports the visibility already held.
  const [visible, setVisible] = useState<boolean | undefined>(undefined);
  const [intent, setIntent] = useState(INITIAL_INTENT);

  // Live playback for the decision effect to read without depending on it
  // (Backpack's `isPlayingRef`, `Video/useVideoPlayerState.ts:76-78`). Synced
  // from an effect declared before the decision effect, so a commit that
  // changes both delivers the new playback state first.
  const isPlayingRef = useRef(isPlaying);
  useEffect(() => {
    isPlayingRef.current = isPlaying;
  }, [isPlaying]);

  // Backpack has no ref for this: it reads `playing` straight out of the
  // decision effect's closure (`Video/useVideoPlayerState.ts:118`), which the
  // effect's own dependencies then keep out of the decision. A ref says the
  // same thing without `react-hooks/exhaustive-deps` reporting the closure read
  // as a dependency someone forgot — same value, same timing, and declared
  // before the decision effect for the same reason as above.
  const controlledPausedRef = useRef(controlledPaused);
  useEffect(() => {
    controlledPausedRef.current = controlledPaused;
  }, [controlledPaused]);

  // Backpack's `wasPlayingBeforeOutOfViewRef`
  // (`Video/useVideoPlayerState.ts:80`): set only by a pause this hook
  // performed, which is what makes resuming the exception rather than the rule
  // — a video already paused when it went off screen is not started on the
  // way back.
  const wasPlayingBeforeOutOfView = useRef(false);

  // The playback the hook last asked for and has not yet seen applied, or
  // `undefined` when it is waiting for nothing. The one thing that tells the
  // hook's own doing from everybody else's, which nothing in the wrapper can
  // report for it: under visible controls the viewer's clicks reach the wrapper
  // as player reports, with no handler on the path to announce them.
  const requestedPlayback = useRef<boolean | undefined>(undefined);

  // Playback changed to something the hook did not ask for, so the viewer or
  // the parent has given an instruction, and it outranks a resume the hook was
  // still holding: the last instruction wins, whichever direction it went in.
  // A pause dropping the resume is the whole point — a video paused by hand
  // must stay paused when it scrolls back — and a play dropping it costs
  // nothing, because a video already playing has nothing to resume.
  //
  // Separate from the decision effect because this is the one place that must
  // watch `isPlaying` live. As a dependency *there* it would re-run the
  // decision on every play and pause off screen, whose pause branch would
  // re-arm the resume — the hazard the hook's doc comment describes. Nothing
  // here re-decides; this effect only ever drops a pending resume. Declared
  // before the decision effect, so a commit that both starts playback and
  // takes the video off screen arms the resume rather than dropping it.
  useEffect(() => {
    // The hook's own request, now applied. The provider may report the same
    // transition back afterwards, but that echo cannot reach here: `isPlaying`
    // already holds the reported value, so the effect does not re-run for it.
    if (requestedPlayback.current === isPlaying) {
      requestedPlayback.current = undefined;
      return;
    }
    wasPlayingBeforeOutOfView.current = false;
  }, [isPlaying]);

  useEffect(() => {
    if (!node) return;
    const observer = new IntersectionObserver(
      (entries) => {
        // The last entry, where Backpack takes the first
        // (`hooks/useIntersectionObserverSingleton.tsx:30`): a batch for one
        // target ends with its current visibility.
        const entry = entries[entries.length - 1];
        if (entry) setVisible(entry.isIntersecting);
      },
      { root, threshold }
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [node, root, threshold]);

  // The decision. Its dependencies are a scroll's answer and the two switches
  // that enable the behaviour, because those are the only things that may
  // re-open the question; every other value it reads comes from a ref, and the
  // hook's doc comment says what each of them would break as a dependency
  // instead. Backpack's equivalent is `Video/useVideoPlayerState.ts:144-154`.
  useEffect(() => {
    if (!pauseOnOutOfViewport || !startedPlaying || visible === undefined) {
      return;
    }

    // Both branches go through here, so the record of what the hook asked for
    // can never drift from the request it describes.
    const request = (playing: boolean) => {
      requestedPlayback.current = playing;
      setIntent({ playing });
    };

    if (visible && wasPlayingBeforeOutOfView.current) {
      wasPlayingBeforeOutOfView.current = false;
      // A pause is asked for rather than the request being skipped, so that an
      // explicit `playing={false}` is still restated as the wrapper's current
      // playback; on an already-paused video it is a no-op. Backpack spells the
      // same thing `requestPlayUnlessControlledPaused` (`:117-124`).
      request(!controlledPausedRef.current);
    } else if (!visible && isPlayingRef.current) {
      wasPlayingBeforeOutOfView.current = true;
      request(false);
    }
  }, [pauseOnOutOfViewport, startedPlaying, visible]);

  return { intent, ref: setNode };
};
