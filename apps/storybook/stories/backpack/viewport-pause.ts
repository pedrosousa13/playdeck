import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * What the wrapper knows and this hook deliberately does not own. Playback
 * state stays in `BackpackVideoSurface`'s machine
 * (`backpack-video.tsx:165-192`) — Backpack keeps both in one hook
 * (`useVideoPlayerState`), but here the machine already exists and folding a
 * second owner of `isPlaying` into it would give the same value two homes.
 *
 * File references are into the Backpack v4 beta checkout at
 * `/Users/pedrosousa/Documents/apps/backpack/beta/src/components`.
 */
export type ViewportPauseOptions = {
  /**
   * Whether an explicit `playing={false}` is in force. Backpack computes it as
   * `(playing ?? parentPlaying) === false` inside
   * `requestPlayUnlessControlledPaused` (`Video/useVideoPlayerState.ts:117-124`)
   * — a caller holding the video paused outranks a scroll-back-in. It is an
   * input rather than the `playing` prop itself because `parentPlaying`,
   * Backpack's carousel atom (`useVideoPlayerState.ts:36`), has no equivalent
   * here: what the hook needs is the answer, not the two sources.
   */
  readonly controlledPaused: boolean;
  /**
   * Live playback state. Read through a ref, never as a dependency — see the
   * hook's doc comment for why that is the whole difficulty of this behaviour.
   */
  readonly isPlaying: boolean;
  /** Backpack's `pauseOnOutOfViewport` (`Video/VideoPlayer.tsx:159,207`). */
  readonly pauseOnOutOfViewport: boolean;
  /**
   * Backpack's `intersectionObserverRoot` (`Video/VideoPlayer.tsx:154,227`),
   * under the `IntersectionObserver` option's own name. Optional and passed
   * through untouched: Backpack's defaults (`null` root, `0` threshold) belong
   * on the wrapper's props, and are the observer's own defaults anyway, so a
   * second default here could only ever disagree with the first.
   */
  readonly root?: Element | null;
  /**
   * Whether playback has started at least once
   * (`backpack-video.tsx:166,172`), Backpack's `startedPlaying`.
   */
  readonly startedPlaying: boolean;
  /** Backpack's `threshold` (`Video/VideoPlayer.tsx:204,226`). */
  readonly threshold?: number;
};

/**
 * A request for the wrapper's machine, not a state to render. Identity is the
 * signal: a new object is a new request, so the wrapper folds it in with the
 * `useChanged` it already uses for the player's own reports
 * (`backpack-video.tsx:69-74,167-182`), and re-rendering the same object asks
 * for nothing. A plain boolean could not say that — it would keep asking for a
 * pause for as long as the video stayed off screen, and so would undo a play
 * the viewer started while it was there.
 */
export type ViewportPlaybackIntent = { readonly playing: boolean };

export type ViewportPause = {
  /**
   * Drops any pending auto-resume, so a video the viewer paused by hand stays
   * paused when it scrolls back in. Backpack does this from `start` and
   * `toggle` (`Video/useVideoPlayerState.ts:167,174`); here the wrapper calls
   * it from the same two places — its click handlers — because a hook that
   * cannot see `isPlaying` change cannot tell a viewer's pause from its own.
   */
  readonly cancelResume: () => void;
  readonly intent: ViewportPlaybackIntent;
  /** For `Player.Viewport`, which merges it with its own ref. */
  readonly ref: (node: Element | null) => void;
};

/**
 * Never applied: the wrapper's `useChanged` fold ignores the value a render
 * starts with, so the first intent the hook raises is the first one it acts on.
 */
const INITIAL_INTENT: ViewportPlaybackIntent = { playing: false };

/**
 * Pauses a playing video when it scrolls out of view and resumes it when it
 * comes back — Backpack's `pauseOnOutOfViewport`, which is the effect at
 * `Video/useVideoPlayerState.ts:144-154` plus the observer at
 * `hooks/useIntersectionObserverSingleton.tsx`. The hook owns the observer and
 * the resume bookkeeping; the wrapper owns playback.
 *
 * ## Why `isPlaying` is read from a ref
 * The decision effect must see live playback without depending on it. As a
 * dependency, every play and pause would re-run the effect while the video is
 * off screen, and the pause branch would re-arm the resume flag — so a video
 * the viewer paused *while* it was off screen would spring back to life on
 * scroll-in. Backpack's module doc says the same under "Why isPlayingRef
 * exists" (`Video/useVideoPlayerState.ts:40-45`), and its two regression
 * guards are `VideoPlayer.test.tsx:207-243`.
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
 *   (`packages/react/src/use-activation.ts:348-355`), so a branch here could
 *   only guard an environment where the player itself does not run.
 */
export const useViewportPause = ({
  controlledPaused,
  isPlaying,
  pauseOnOutOfViewport,
  root,
  startedPlaying,
  threshold
}: ViewportPauseOptions): ViewportPause => {
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

  // Backpack's `isPlayingRef` (`Video/useVideoPlayerState.ts:76-78`). Synced
  // from an effect declared before the decision effect, so a commit that
  // changes both delivers the new playback state first.
  const isPlayingRef = useRef(isPlaying);
  useEffect(() => {
    isPlayingRef.current = isPlaying;
  }, [isPlaying]);

  // Backpack's `wasPlayingBeforeOutOfViewRef`
  // (`Video/useVideoPlayerState.ts:80`): set only by a pause this hook
  // performed, which is what makes resuming the exception rather than the rule
  // — a video already paused when it left the viewport is not started on the
  // way back.
  const wasPlayingBeforeOutOfView = useRef(false);

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

  // Backpack's viewport effect (`Video/useVideoPlayerState.ts:144-154`),
  // structure for structure. `controlledPaused` is a dependency here where
  // Backpack reads `playing` out of the closure without declaring it
  // (`:118,154`); the extra run that costs can raise nothing by itself,
  // because off screen the pause branch still needs live playback, and on
  // screen the resume flag has already been cleared.
  useEffect(() => {
    if (!pauseOnOutOfViewport || !startedPlaying || visible === undefined) {
      return;
    }

    if (visible && wasPlayingBeforeOutOfView.current) {
      wasPlayingBeforeOutOfView.current = false;
      // Backpack's `requestPlayUnlessControlledPaused` (`:117-124`), which
      // asks for a pause rather than skipping the request — the wrapper
      // applies it as any other, and on an already-paused video it is a no-op.
      setIntent({ playing: !controlledPaused });
    } else if (!visible && isPlayingRef.current) {
      wasPlayingBeforeOutOfView.current = true;
      setIntent({ playing: false });
    }
  }, [controlledPaused, pauseOnOutOfViewport, startedPlaying, visible]);

  // Stable, so `Player.Viewport`'s ref effect and any dependency array the
  // wrapper puts it in are left alone by a re-render.
  const cancelResume = useCallback(() => {
    wasPlayingBeforeOutOfView.current = false;
  }, []);

  return { cancelResume, intent, ref: setNode };
};
