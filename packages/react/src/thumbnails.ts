import { useEffect, useRef, useState } from 'react';
import {
  parseThumbnailCues,
  thumbnailCueAt,
  type PlayerController,
  type ThumbnailCue,
  type ThumbnailRegion
} from '@playdeck/core';
import { permittedUrl } from './permitted-url.js';
import { useRefusedUrlReport } from './player-context.js';

const EMPTY_CUES: readonly ThumbnailCue[] = Object.freeze([]);

type CuesState = {
  readonly url: string | undefined;
  readonly cues: readonly ThumbnailCue[];
  // Whether `arm()` has already started (or finished) a fetch for `url`, so a
  // repeat call is a no-op.
  readonly armed: boolean;
};

const initialState: CuesState = Object.freeze({
  url: undefined,
  cues: EMPTY_CUES,
  armed: false
});

export type ThumbnailCuesResult = {
  readonly cues: readonly ThumbnailCue[];
  // Starts (or restarts, for a new `url`) the fetch. A no-op once the
  // current `url` is already armed -- fetching or fetched -- so a caller can
  // call it on every pointer/focus event without tracking whether this is
  // the first one itself.
  readonly arm: () => void;
};

// Loads and parses the WebVTT file `SeekSlider`'s `thumbnails` prop names,
// lazily: nothing is fetched until `arm()` is called, which `SeekSlider`
// calls from the first `pointerenter`/`pointermove` over the slider or the
// first keyboard `focus` on its input -- never at mount, so a consumer who
// sets the prop but whose viewer never hovers or tabs to the control never
// costs a network request.
//
// One fetch per resolved `url`: a second `arm()` call for the same `url` is a
// no-op, and a changed `url` invalidates whatever was in flight or already
// parsed for the old one -- its cues are dropped and the next interaction
// re-arms and re-fetches for the new one. The in-flight request is aborted on
// unmount too, on the same path a `url` change already takes.
//
// A response that fails to fetch, or parses to no cues, settles on the same
// empty result an unset `thumbnails` prop produces. This module is not the
// allowlist: `SeekSlider` resolves `url` through `permittedUrl` before it
// ever reaches here (or withholds a refused one -- an `arm()` with no valid
// `url` is simply never fetched), so a fetch failure or an empty parse here
// is a malformed or unreachable file, not a refused one, and stays silent the
// same way `parseThumbnailCues` itself does (see its own header comment).
export const useThumbnailCues = (
  url: string | undefined
): ThumbnailCuesResult => {
  // Holds the resolved cues alongside the `url` they belong to, and whether a
  // fetch for that `url` has already started -- a plain ref, not state,
  // because it is reset synchronously below rather than through an effect
  // (see the comment there for why), and read into a render-time local
  // (`cues`) for everything downstream to use like ordinary state.
  const stateRef = useRef<CuesState>(initialState);
  const abortRef = useRef<AbortController | null>(null);
  // Its setter's only job is forcing a re-render once `arm()`'s fetch
  // resolves and mutates `stateRef` from outside render -- the same pairing
  // `PosterImage` uses for its own ref-backed state (`poster.tsx`).
  const [, rerender] = useState(0);

  /* eslint-disable react-hooks/refs -- A changed `url` must reset the exposed
     cues during THIS render, not after one commits: `useSeekPreview`'s own
     preview release (`transport-controls.tsx`) and `PosterImage`'s request-key
     reset are the precedent for adjusting a ref this way instead of through an
     effect, which is what a synchronous `setState` in an effect body would be
     doing here regardless (`react-hooks/set-state-in-effect`). A render
     React discards costs nothing: the next attempt recomputes the same reset
     from the same committed props. */
  if (stateRef.current.url !== url) {
    abortRef.current?.abort();
    abortRef.current = null;
    stateRef.current = { url, cues: EMPTY_CUES, armed: false };
  }
  const cues = stateRef.current.cues;
  /* eslint-enable react-hooks/refs */

  // The one real side effect: abort whatever is in flight when this instance
  // unmounts. The `url`-changed case above already aborts synchronously
  // during render, so this covers only the case that reset cannot -- the
  // component going away entirely.
  useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  const arm = (): void => {
    if (url === undefined || stateRef.current.armed) return;
    stateRef.current = { ...stateRef.current, armed: true };
    const controller = new AbortController();
    abortRef.current = controller;
    fetch(url, { signal: controller.signal })
      .then((response) => (response.ok ? response.text() : undefined))
      .then((text) => {
        // Stale if aborted, or if a `url` change has since moved this
        // instance on to a different fetch this result must not overwrite.
        if (controller.signal.aborted || stateRef.current.url !== url) return;
        stateRef.current = {
          url,
          cues: text === undefined ? EMPTY_CUES : parseThumbnailCues(text),
          armed: true
        };
        rerender((value) => value + 1);
      })
      .catch(() => {
        // A network failure -- including this fetch's own abort -- is silent,
        // same as a fetch that resolves but fails: no thumbnails, no notice.
      });
  };

  /* eslint-disable react-hooks/refs -- `cues` is the synchronous snapshot
     taken above, and `arm` only reads its refs from an event handler, after
     render, same as `PosterImage`'s own returned closures. */
  return { cues, arm };
  /* eslint-enable react-hooks/refs */
};

// The image a `thumbnail` part has to crop, or `null` when there is none:
// `region: null` (from `ThumbnailCue`'s own contract) means "the whole
// image", not "nothing to show" -- that distinction is `thumbnailImage`
// itself being `null` below.
export type ThumbnailPreviewImage = {
  readonly region: ThumbnailRegion | null;
  readonly url: string;
};

export type ThumbnailPreviewResult = {
  readonly previewedTime: number | null;
  readonly thumbnailImage: ThumbnailPreviewImage | null;
  // The `thumbnail` part's CSS `left`, ready to hand straight to its inline
  // `style` -- see `thumbnailLeftStyle` below for what it contains and why.
  readonly thumbnailLeft: string;
  // Arms the load and records the pointer's x within `target`'s box as the
  // previewed fraction. Bound to `pointerenter`/`pointermove` on the slider's
  // own wrapper -- `target` is that wrapper's element, not a ref this hook
  // holds itself, so a caller supplies it straight off the event.
  readonly trackPointer: (clientX: number, target: Element) => void;
  readonly onBlur: () => void;
  // Arms the load and starts previewing the input's current `value`, unless
  // a pointer is already doing that job.
  readonly onFocus: () => void;
  readonly onPointerLeave: () => void;
};

// The `thumbnail` part's CSS `left`, as a percentage of `SeekSlider`'s own
// wrapper -- the same box `previewedTime`'s pointer fraction is already
// measured against -- clamped so the part, centred on `left` by the caller's
// `translateX(-50%)`, never sits partly outside that box near either end of
// the track (`Player.Viewport` sets `overflow: hidden` in
// viewport-media.tsx, which would otherwise clip it). Constraining `left` to
// `[halfWidth, 100% - halfWidth]` keeps the whole box inside: CSS `clamp()`
// resolves identically for the pointer path and the keyboard-focus path,
// needs no `getBoundingClientRect` call, and can't go stale on resize the
// way a JS-measured clamp could.
//
// Only possible when `regionWidth` is known, i.e. the cue names a region --
// that is the only source of the box's pixel width (`SeekSlider` also uses
// it, unclamped, for the part's own `width` style). A region-less cue's box
// sizes to its natural image width, unknown until the image loads, so it is
// left unclamped. If the slider is narrower than the thumbnail, `clamp()`'s
// min exceeds its max and, per spec, resolves to the min -- the preview
// overflows to the right rather than centring, an accepted degenerate case
// rather than something worth code of its own.
//
// A pure function, not inlined into the JSX: `packages/react/test`'s DOM
// environment (happy-dom) rejects `clamp()`/`min()` as invalid CSS outright
// -- `el.style.left = 'clamp(...)'` is silently dropped, leaving whatever
// the element held before -- so a rendered `style.left` can never be
// asserted on for this value. Exporting the computation lets it be tested as
// a plain string instead.
export const thumbnailLeftStyle = (
  previewedTime: number | null,
  min: number,
  span: number,
  regionWidth: number | undefined
): string => {
  if (previewedTime === null) return '0%';
  const pct = ((previewedTime - min) / span) * 100;
  if (regionWidth === undefined) return `${pct}%`;
  const halfWidth = regionWidth / 2;
  return `clamp(${halfWidth}px, ${pct}%, calc(100% - ${halfWidth}px))`;
};

// Derives what a `thumbnail` part should show from `SeekSlider`'s own
// pointer/focus interaction, `useThumbnailCues`'s resolved `cues`, and the
// slider's already-computed geometry (`min`/`span`/`value`/`hasWindow`):
// local interaction state in, a previewed value out -- the same shape
// `useSeekPreview` above is, for a pending seek's preview rather than a
// hover/focus one. Kept beside `useThumbnailCues` rather than in
// `transport-controls.tsx`: between them the two hooks now own every
// non-JSX thumbnail concern, and `SeekSlider` is left with the prop, the
// part, and two hook calls.
export const useThumbnailPreview = ({
  arm,
  controller,
  cues,
  hasWindow,
  min,
  resolvedThumbnails,
  span,
  value
}: {
  readonly arm: () => void;
  readonly controller: PlayerController;
  readonly cues: readonly ThumbnailCue[];
  readonly hasWindow: boolean;
  readonly min: number;
  readonly resolvedThumbnails: string | undefined;
  readonly span: number;
  readonly value: number;
}): ThumbnailPreviewResult => {
  // The pointer's x within the wrapper, as a fraction of its width -- `null`
  // while no pointer is over it. Focus is a separate axis: a pointer active
  // at the same time as focus wins, per `previewedTime` below.
  const [pointerFraction, setPointerFraction] = useState<number | null>(null);
  const [inputFocused, setInputFocused] = useState(false);

  // The time the `thumbnail` part previews: the pointer's position while it
  // is over the wrapper, else the input's own current `value` while it holds
  // focus, else no preview at all. `null` whenever there is no seek window to
  // place a preview in, or the feature is off (an absent or refused
  // `thumbnails`).
  const previewedTime =
    resolvedThumbnails === undefined || !hasWindow
      ? null
      : pointerFraction !== null
        ? min + pointerFraction * span
        : inputFocused
          ? value
          : null;
  const activeCue =
    previewedTime === null ? null : thumbnailCueAt(cues, previewedTime);
  // The active cue's image, through the same allowlist as `thumbnails`
  // itself. A refusal here reports the `'thumbnails cue image'` surface and
  // drops only this cue -- the next preview resolves its own cue independently.
  const cueImageUrl =
    activeCue === null ? undefined : permittedUrl(activeCue.url);
  useRefusedUrlReport(
    controller,
    'thumbnails cue image',
    activeCue !== null && cueImageUrl === undefined
  );
  // What the `thumbnail` part actually has to show, or `null` for every
  // reason it might not: no active preview, no cue at that time, or that
  // cue's own image refused.
  const thumbnailImage: ThumbnailPreviewImage | null =
    activeCue === null || cueImageUrl === undefined
      ? null
      : { region: activeCue.region, url: cueImageUrl };

  // Tracks the pointer's x within the wrapper as a fraction of its width, and
  // arms the lazy load on the same gesture -- `pointerenter`/`pointermove`
  // are both "a pointer is over the slider" as far as this feature is
  // concerned.
  const trackPointer = (clientX: number, target: Element): void => {
    if (resolvedThumbnails === undefined) return;
    arm();
    const rect = target.getBoundingClientRect();
    setPointerFraction(
      rect.width > 0
        ? Math.min(1, Math.max(0, (clientX - rect.left) / rect.width))
        : 0
    );
  };

  return {
    previewedTime,
    thumbnailImage,
    thumbnailLeft: thumbnailLeftStyle(
      previewedTime,
      min,
      span,
      thumbnailImage?.region?.width
    ),
    trackPointer,
    onBlur: () => setInputFocused(false),
    onFocus: () => {
      if (resolvedThumbnails === undefined) return;
      arm();
      setInputFocused(true);
    },
    onPointerLeave: () => setPointerFraction(null)
  };
};
