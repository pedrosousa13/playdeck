import {
  BackpackVideoInternal,
  type BackpackVideoProps
} from './backpack-video';
import { composeClassName } from './compose-class-name';

/**
 * The prop API of EF Backpack's `AutoplayVideo`
 * (`src/components/Video/AutoplayVideo.tsx:8-15`), which is its `VideoPlayer`'s
 * minus the three props it takes over, plus its own `playing`.
 *
 * Two of those three are missing here where Backpack keeps one of them:
 * Backpack omits `playing`, `autoplay` and `muted` from the type and then also
 * forces `light={false}` — a prop it still accepts and silently discards
 * (`:33`). ADR-0003 is why this type drops `light` as well
 * (`docs/adr/0003-backpack-is-a-scenario-source-not-a-spec.md:20-24`): a prop
 * the component cannot honour is better absent than accepted and ignored, and
 * the compiler is the only place that can say so before the caller ships.
 * `autoplay` never existed on this wrapper's own API, so there is nothing to
 * omit.
 *
 * File references are into the Backpack v4 beta checkout at
 * `/Users/pedrosousa/Documents/apps/backpack/beta`.
 */
export type BackpackAutoplayVideoProps = Omit<
  BackpackVideoProps,
  'light' | 'muted' | 'playing'
> & {
  /**
   * Whether to play the video automatically once it is visible. Backpack's own
   * prop and its default (`src/components/Video/AutoplayVideo.tsx:10-14`);
   * `false` holds the video paused, and flipping it to `true` later starts it
   * like any other controlled `playing`.
   */
  readonly playing?: boolean;
};

/**
 * A muted video that starts playing when it scrolls into view and pauses when it
 * leaves, standing in for Backpack's `AutoplayVideo`
 * (`src/components/Video/AutoplayVideo.tsx:21-38`). An optional
 * `placeholderImageSrc` covers it until playback starts.
 *
 * ## What this does that Backpack does not
 * Backpack composes `playing={true}` onto its `VideoPlayer`, which mounts a
 * player and plays it at mount wherever the box happens to be, and leaves
 * `pauseOnOutOfViewport` to stop it again if that was off screen
 * (`:30`, `Video/useVideoPlayerState.ts:144-154`). Reely has a loading strategy
 * for the thing the component is actually about: the strategy named
 * `loading: 'viewport'` observes the player's own `Player.Viewport` box and
 * attaches the provider when it first scrolls into view
 * (`packages/react/src/use-activation.ts:328-447`), and muted autoplay then
 * starts playback as soon as that provider reports ready — so playing on the way
 * in is the mechanism rather than a correction applied after the fact, and
 * nothing plays off screen. `autoplayOnViewportEntry` is the wrapper-internal
 * prop that selects it, reached through `BackpackVideoInternal` because the
 * public `BackpackVideo` name deliberately does not offer it.
 *
 * ## `threshold` does not reach the start, only the pause
 * Inherited from `BackpackVideoProps` and worth knowing before it is used: it
 * reaches the off-screen-pause observer alone. The two observers on an
 * autoplaying video are asymmetric and cannot currently be aligned — Reely's
 * activation observer is constructed with `{ rootMargin: options.loadMargin }`
 * and nothing else (`packages/react/src/use-activation.ts:399`), and
 * `Player.Root` exposes no threshold for it to carry
 * (`packages/react/src/root.tsx:44-45,91-92` offer `loading` and `loadMargin`
 * only). So with `threshold` above `0` the start fires at the first visible
 * pixel while the pause hook still calls the video out of view, which pauses it
 * again at once: one spurious play/pause pair, both reported through
 * `onPlayChange`. No story passes `threshold` to this component, so nothing
 * exercises it today; closing it needs a threshold on Reely's viewport loading,
 * and it is recorded in `docs/backpack-parity.md` rather than worked around
 * here.
 *
 * ## What is forced, and where the forcing lives
 * `muted` is `true` and `light` is `false`, as in Backpack, for the reason
 * Backpack gives: an audible autoplay is blocked by browsers, and a `light`
 * player has no player mounted to autoplay (`:19,33-34`). Backpack forces them
 * by ordering them after its prop spread; here they are absent from the props
 * type instead, so there is nothing to order — `light` is left to
 * `BackpackVideo`'s own `false` default rather than restated, and `muted` is the
 * one value this component has to pass. `controls` is Backpack's `false` before
 * its spread, which is `BackpackVideo`'s default too, so it stays overridable
 * without being named here.
 */
export const BackpackAutoplayVideo = ({
  className,
  playing = true,
  ...rest
}: BackpackAutoplayVideoProps) => (
  <BackpackVideoInternal
    {...rest}
    autoplayOnViewportEntry
    // Backpack's `cn('ef-autoplay-video', className)` (`:28`), so the caller's
    // class stays last. The name also carries a background of its own, which is
    // where `backpack-video-styles.ts`'s `.ef-video-player.ef-autoplay-video`
    // rule comes from — its comment is the argument.
    className={composeClassName('ef-autoplay-video', className)}
    muted
    playing={playing}
  />
);
