import type * as Player from '@reely/react';
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent
} from 'react';
import { BackpackVideo, type BackpackVideoProps } from './backpack-video';
import { composeClassName } from './compose-class-name';
import { useOnChange } from './use-on-change';
import { VideoCoverImage } from './video-cover-image';
import { useVideoThumbnail } from './video-thumbnail';

/**
 * The prop API of EF Backpack's `VideoHoverPreview`
 * (`src/components/Video/VideoHoverPreview.tsx:23-36`), which is its
 * `VideoPlayer`'s minus `playing` and `autoplay`, plus its own `duration` and
 * `isHovered`.
 *
 * Three more are dropped here where Backpack keeps them, and for the reason
 * ADR-0003 gives for dropping `light` from `BackpackAutoplayVideoProps` — a prop
 * the component cannot honour is better absent than accepted and ignored, and
 * the compiler is the only place that can say so before the caller ships
 * (`docs/adr/0003-backpack-is-a-scenario-source-not-a-spec.md:20-24`):
 *
 * - `light` would make `BackpackVideo` resolve and render a cover of its own,
 *   stacking a second image over the one this composition already owns. Backpack
 *   accepts it and lets it override the `light={!isPlaying}` it composes, because
 *   its own value sits before its prop spread (`VideoHoverPreview.tsx:167,172`).
 * - `hoverEffect` zooms `BackpackVideo`'s cover while hovered, and that cover
 *   does not exist here. It would also be self-defeating: a zoom that only runs
 *   while hovered, over a cover that this component removes on hover.
 * - `playing`, as Backpack omits it. Playback here is the hover's to decide, and
 *   on `BackpackVideo` the prop is read once at mount to choose a loading
 *   strategy (`backpack-video.tsx:480`, `const [startsPlaying]`), so a caller's value would change how the
 *   provider loads rather than merely what plays.
 *
 * `autoplay` never existed on this wrapper's own API, so there is nothing to
 * omit.
 *
 * File references are into the Backpack v4 beta checkout at
 * `/Users/pedrosousa/Documents/apps/backpack/beta`.
 */
export type BackpackVideoHoverPreviewProps = Omit<
  BackpackVideoProps,
  'hoverEffect' | 'light' | 'playing'
> & {
  /**
   * Length of the preview window in seconds, after which playback returns to the
   * start. Backpack's own prop, and its default of `5` — stated twice there, in
   * the JSDoc and in the destructuring
   * (`src/components/Video/VideoHoverPreview.tsx:27-31`, its `@default 5`, and
   * `:48`, its `duration = 5`).
   */
  readonly duration?: number;
  /**
   * Drives the preview from outside, in addition to the pointer. Backpack's own
   * prop, OR'd with its internal hover state rather than replacing it
   * (`src/components/Video/VideoHoverPreview.tsx:32-35,79`), so a parent can
   * start a preview the pointer is not over — the only way in on a touch device,
   * where there is no hover to begin with.
   */
  readonly isHovered?: boolean;
};

/**
 * A video that shows a cover image at rest and plays a short muted preview while
 * the pointer is over it, standing in for Backpack's `VideoHoverPreview`
 * (`src/components/Video/VideoHoverPreview.tsx:44-178`). After the preview window
 * elapses playback returns to the start and continues for as long as the hover
 * lasts; when the pointer leaves, the cover comes back and the video is paused
 * and rewound.
 *
 * ## The restart is driven by position, not by a clock
 * Backpack arms `setInterval(() => seekTo(0), duration * 1000)` when it asks for
 * playback and clears it when it stops (`:89-103`). That interval counts real
 * time from the moment playback was *requested*, which is not the same clock as
 * the video's own position: a provider that takes half a second to load, an
 * autoplay the browser defers, or a buffering stall all leave the two
 * desynchronised, and the seek then fires somewhere short of `duration` — earlier
 * on every subsequent pass, since the drift accumulates. So this composition
 * watches the position the player reports and seeks to `0` on the report that
 * first reaches `duration`. The brief for SIDEPRO-204 asked for Reely's
 * current-time state and seek command for exactly this reason, and it is a
 * deliberate divergence recorded in `docs/backpack-parity.md`.
 *
 * Only a *crossing* restarts, not every report at or past the window: a seek is
 * asynchronous, so a player that reports 5.0, 5.2 and 5.4 before it lands would
 * otherwise be seeked three times. `loop` is separately `true` by default, so a
 * video shorter than the window still wraps at its own end.
 *
 * The window belongs to the hover. Playback the viewer started deliberately —
 * through the play control `BackpackVideo` puts on the surface — is not a preview
 * and is never yanked back to the start. Backpack scopes it the same way, its
 * interval being keyed on its hover-derived `isPlaying` alone (`:90`).
 *
 * ## Hover is the interaction that loads the provider
 * `BackpackVideo` loads on the first interaction, and an external play is
 * therefore two calls — `activateFromInteraction()` to start a dormant player,
 * then `play()`, each a no-op in the case the other handles (SIDEPRO-201, and
 * `external-control.contract.test.ts:131-154`, `'starts the video with one external command'`). Hover issues both. The
 * composition deliberately does *not* switch to eager loading: a grid of these
 * would then attach a provider per card before anyone hovered anything, and
 * Backpack defers the mount here too, through the `light={!isPlaying}` it hands
 * its own player (`:167`).
 *
 * ## The cover layer is this component's own
 * As it is Backpack's, whose `VideoCoverImage` sits outside its `VideoPlayer`
 * (`:144-155`). It cannot be `BackpackVideo`'s: that cover is gated on
 * `!startedPlaying` (`backpack-video.tsx:333`, `const showsCover`), so it never returns, and it
 * renders inside `Player.Poster`, which Reely hides on the first reported
 * playback and does not restore for the same source
 * (`packages/react/src/poster.tsx:75`, driven from `root.tsx:471-476`, the
 * `unsubscribePoster` subscription). A
 * returning cover is this component's whole point, so the *container* is local —
 * and only the container. The image inside it is {@link VideoCoverImage}, the same
 * component `BackpackVideo` renders inside its `Player.Poster`; the source comes
 * from {@link useVideoThumbnail}; and the `ef-video-cover` /
 * `ef-video-cover-image` rules in `backpack-video-styles.ts` draw it. What differs
 * between the two call sites is exactly the thing that cannot be shared: that
 * poster is `aria-hidden`, so its `alt` is a dead DOM attribute, while this
 * container is not, so the same `alt` is a real accessible name for the resting
 * representation of the video.
 *
 * ## Keyboard, and the one thing Backpack does that this does not
 * Backpack makes its root a `role='button'` with `tabIndex={0}` and previews on
 * `Enter`/`Space` keydown, stopping on keyup (`:117-130,134-143`). That root is
 * genuinely focusable, so the affordance is reachable — but it encloses three
 * more tab stops: its cover container, which `VideoCoverImage` gives `tabIndex={0}`
 * unconditionally and, under the `role='img'` this component passes, leaves with
 * neither a role nor an accessible name (`VideoCoverImage.tsx:97-103`); the
 * `ReactPlayer` element, which carries its own `tabIndex` and `aria-label`
 * (`VideoPlayer.tsx:354-355`); and `VideoHiddenControls`, also `tabIndex={0}`
 * (`VideoPlayer.tsx:368`). Interactive controls nested inside a `role='button'`
 * are not exposed as controls, and a tab stop with no name is not usable at all,
 * so reproducing the pattern here would ship a broken affordance rather than a
 * parity one.
 *
 * What this renders instead is one focusable control with a name: the
 * play/pause button `BackpackVideo` already puts on the surface
 * (`backpack-video.tsx:388-390,475-476`, its `const ariaLabel` and the
 * `<button>` it labels). Here it reads "Play video" or "Pause video" and
 * nothing more, because this composition withholds `alt` from the player it
 * wraps and keeps the description on its own cover image instead — the call
 * below says why. The preview root itself takes no role and no `tabIndex`, so a
 * keyboard or touch user gets ordinary click-to-play rather than
 * hold-to-preview, which is also the right resting behaviour on a touch device
 * — recorded as a divergence in `docs/backpack-parity.md`.
 *
 * Playback started that way outlives no hover, because there was none: the pause
 * and rewind below run on a hover *ending*, so a video played from the control
 * without the pointer ever arriving is left alone. A pointer that does hover and
 * then leaves ends playback it did not start, which is Backpack's behaviour too —
 * there the hover state reaches its player as `playing={isPlaying}` (`:162`), so a
 * hover ending pauses a clicked video as well.
 */
export const BackpackVideoHoverPreview = ({
  alt = '',
  className,
  duration = 5,
  isHovered = false,
  loop = true,
  muted = true,
  onPlayChange,
  // Backpack's value for the player it composes (`:171`). A hover preview is
  // under the pointer, so it is on screen by construction, and a pause hook that
  // could disagree would only ever fight the hover. Overridable, as it is there:
  // Backpack's own value sits before its prop spread (`:171-172`).
  pauseOnOutOfViewport = false,
  placeholderImageSrc,
  ref,
  renderCustomImage: CustomImage,
  url,
  ...rest
}: BackpackVideoHoverPreviewProps) => {
  const handle = useRef<Player.PlayerHandle | null>(null);
  const [pointerHovered, setPointerHovered] = useState(false);
  // What the player confirmed, not what the hover asked for: the cover must not
  // come off a video that has not actually started, and must come back for a
  // playback this component did not stop — a viewer pausing through the play
  // control while still hovering. `onPlayChange` is `BackpackVideo`'s report of
  // its own settled state (`backpack-video.tsx:327`, `useOnChange(isPlaying, onPlayChange)`), which is that answer
  // already computed.
  const [isPlaying, setIsPlaying] = useState(false);
  // Always resolved, with no `light` gate: a hover preview has a resting state to
  // draw, so the cover is not optional decoration here the way it is on
  // `BackpackVideo`. Backpack calls `useVideoData(url, coverImageSrc)`
  // unconditionally for the same reason (`:72`).
  const coverSrc = useVideoThumbnail(url, placeholderImageSrc);
  const previewing = isHovered || pointerHovered;

  // The composition drives the player through this handle, and forwards it on so
  // a caller keeps the ref `BackpackVideo` offers. One callback rather than two
  // refs because `BackpackVideo` takes a single `ref`; memoised on the caller's,
  // so a stable ref does not detach and reattach on every render.
  const setHandle = useCallback(
    (instance: Player.PlayerHandle | null) => {
      handle.current = instance;
      if (typeof ref === 'function') return ref(instance);
      if (ref) ref.current = instance;
    },
    [ref]
  );

  // Declared before the effect that starts playback, so the position the restart
  // watches for cannot arrive before there is anything watching. Subscribed
  // rather than read through `usePlayerState`, which this component could not
  // reach anyway from outside `Player.Root` — and which would re-render the whole
  // surface on every time update to compute one comparison.
  useEffect(() => {
    if (!previewing) return;
    const player = handle.current;
    if (!player) return;
    // The position the preview is starting from, read from the player rather than
    // assumed to be zero. In practice it *is* zero a moment later, because hover
    // start rewinds (below) — but reading it keeps the crossing test honest in the
    // one case where that rewind does not happen: a video already playing, which
    // the rewind deliberately leaves alone. Assuming zero there would claim a
    // crossing on the first report from a video that had merely been playing for a
    // while, and yank it back.
    let previous = player.getState().currentTime;
    return player.subscribe((state) => {
      if (previous < duration && state.currentTime >= duration) {
        void player.seekTo(0);
      }
      previous = state.currentTime;
    });
  }, [duration, previewing]);

  // Only on a change, never for the initial value: acting on the opening `false`
  // would pause and rewind a player nobody had touched — and, under interaction
  // loading, do it to one that does not exist yet.
  useOnChange(previewing, (next) => {
    const player = handle.current;
    if (!player) return;
    if (next) {
      player.activateFromInteraction();
      // "From the start of the video", which is a promise about the position and
      // not only about playback: the position a preview inherits can be anything,
      // because the play/pause control is reachable without a pointer — a keyboard
      // viewer can play, watch and pause with no hover at all — and the rewind on
      // hover end only runs for a hover that happened. Backpack gets this for free
      // by unmounting its player on hover end (`:167`, its `light={!isPlaying}`),
      // so every hover of its own mounts a fresh player at zero.
      //
      // Before `play`, so the preview opens on its first frame instead of showing
      // a frame from wherever the video was parked. Skipped for a video already
      // playing, which is Backpack's behaviour too — there the hover sets an
      // `isPlaying` that is already `true`, so nothing remounts and nothing
      // rewinds (`:81-87`) — and the reason is worth more than the symmetry: with
      // a mouse this transition cannot happen mid-playback at all, since the
      // control cannot be clicked without hovering the surface first, so the only
      // viewer who reaches it is one who started the video from the keyboard and
      // would have it yanked back under them.
      if (player.getState().playback !== 'playing') void player.seekTo(0);
      void player.play();
    } else {
      void player.pause();
      // Backpack has nothing here: its `light={!isPlaying}` unmounts the player
      // on hover end, so the position resets by destruction. This one keeps the
      // provider attached, which is the better trade — the next hover plays at
      // once instead of loading again — so the rewind has to be asked for.
      void player.seekTo(0);
    }
  });

  return (
    <div
      // Backpack's own root class first and the caller's second, its
      // `cn('ef-video-hover-preview', root(), className)` (`:115`). The caller's
      // class lands here rather than on the player box, as it does there
      // (`:135`).
      className={composeClassName('ef-video-hover-preview', className)}
      // `pointerenter`/`pointerleave` rather than the bubbling `over`/`out` pair:
      // the latter would report a leave for every move between children of this
      // surface. Touch pointers are ignored, which is what react-aria's `useHover`
      // does for Backpack (`:74-77`) — a tap emits a hover pair a mouse never
      // would, and a preview that started on it could never be ended. A touch
      // device therefore keeps the resting cover, which is the correct behaviour
      // there.
      onPointerEnter={(event) => {
        if (isHoverCapable(event)) setPointerHovered(true);
      }}
      onPointerLeave={(event) => {
        if (isHoverCapable(event)) setPointerHovered(false);
      }}
    >
      {coverSrc && !isPlaying ? (
        // Not `aria-hidden`, unlike `BackpackVideo`'s cover inside
        // `Player.Poster` (`packages/react/src/poster.tsx:66`): there the cover
        // overlays a player whose own button carries the name — the same `alt`
        // among it since SIDEPRO-214 — where here it is the resting
        // representation of the video and its `alt` is worth having in place.
        // Backpack's default `alt = ''` (`:56`) leaves an unlabelled one
        // decorative, which is what an empty `alt` already means.
        //
        // `pointer-events: none` is in the stylesheet, so the layer never becomes
        // the click target for the button underneath it.
        <div className="ef-video-cover">
          <VideoCoverImage
            alt={alt}
            renderCustomImage={CustomImage}
            src={coverSrc}
          />
        </div>
      ) : null}
      <BackpackVideo
        {...rest}
        // No `alt`, though the composition takes one: the text describes the
        // cover above, and that cover is the only one on the surface. This
        // player is handed `light={false}` and no `placeholderImageSrc`, so its
        // own `coverSrc` never resolves (`backpack-video.tsx:603-606`) and its
        // `Player.Poster` never renders — an `alt` passed down here would
        // describe a picture `BackpackVideo` does not draw. Since SIDEPRO-214
        // it would not merely be inert, either: `BackpackVideo` folds the text
        // into its button's name, so a screen-reader user at rest would meet
        // the same description twice, once as the image and again inside "Play
        // video: …". Withheld, so the image keeps the description and the
        // button keeps the bare action.
        //
        // The three refused props, forced after the spread. `Omit` bars them from
        // the props type, but a caller who gets round the compiler — an `any`, an
        // untyped spread of unknown props — would otherwise still have them
        // carried into `BackpackVideo` by `...rest`. This is Backpack's own
        // ordering trick, the one its `AutoplayVideo` uses on `light` and `muted`
        // (`Video/AutoplayVideo.tsx:33-34`) and `BackpackVideo` uses on
        // `autoplayOnViewportEntry` (`backpack-video.tsx:588-590`, `export const BackpackVideo`), which is what
        // makes "refused" a fact rather than a claim. `undefined` for `playing`
        // because that is what `BackpackVideo` reads as "not set" (`backpack-video.tsx:480`,
        // `playing ?? false`) — `false` would instead assert an explicit pause and
        // arm the controlled-pause branch of its off-screen hook
        // (`backpack-video.tsx:286`, `controlledPaused: playing === false`).
        hoverEffect={false}
        light={false}
        loop={loop}
        muted={muted}
        onPlayChange={(next) => {
          setIsPlaying(next);
          onPlayChange?.(next);
        }}
        pauseOnOutOfViewport={pauseOnOutOfViewport}
        playing={undefined}
        ref={setHandle}
        url={url}
      />
    </div>
  );
};

/**
 * Whether a pointer event came from something that can hover at all. React
 * synthesises `pointerenter` for touch, where there is no hovering to report:
 * the tap raises an enter that is never followed by a leave, so a preview
 * started from one would run until the next tap elsewhere. react-aria's
 * `useHover` filters the same case out on Backpack's behalf.
 */
const isHoverCapable = (event: PointerEvent<HTMLDivElement>): boolean =>
  event.pointerType !== 'touch';
