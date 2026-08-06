import type { ElementType } from 'react';

/**
 * The three values a cover image needs, which travelled together at both call
 * sites before this module existed and are one type now: the resolved image, the
 * text for it, and the consumer element type that may render it instead.
 */
export type VideoCoverImageProps = {
  /**
   * The cover's alt text. Whether it reaches the accessibility tree is the
   * caller's business, not this component's — see {@link VideoCoverImage}.
   *
   * `undefined` is admitted rather than coerced to `''` because the two are not
   * the same thing in the DOM — an absent `alt` is an unlabelled image, an empty
   * one is a decorative image — and coercing here would change what
   * `BackpackVideo` renders. In practice both wrappers default it to `''` at their
   * own boundary (`backpack-video.tsx`'s and
   * `backpack-video-hover-preview.tsx`'s `alt = ''`), which is Backpack's default
   * too (`Video/VideoHoverPreview.tsx:56`); it is the internal surface's prop type
   * that keeps the optionality alive this far down.
   */
  readonly alt: string | undefined;
  /**
   * A consumer's own element type, rendered in place of the `<img>` with the same
   * three attributes. Backpack's `renderCustomImage`, whose own stories spread
   * the props they are handed and then override `alt`
   * (`stories/components/Video/VideoHoverPreview.stories.tsx:122-128`), so the
   * attribute order below is load-bearing: `alt` is passed, and a consumer that
   * sets its own after the spread wins.
   */
  readonly renderCustomImage?: ElementType;
  /** The resolved cover source, from `useVideoThumbnail` or a caller's prop. */
  readonly src: string;
};

/**
 * The image inside a cover layer, and only the image. Both `BackpackVideo` and
 * `BackpackVideoHoverPreview` render this, and each supplies its own container —
 * which is the whole reason the container is not in here:
 *
 * - `BackpackVideo` wraps it in `Player.Poster`, which sets `aria-hidden="true"`
 *   (`packages/react/src/poster.tsx:66`). So there the `alt` below is a DOM
 *   attribute and nothing more: nothing inside a hidden subtree reaches the
 *   accessibility tree. The text still reaches it, from the other end —
 *   SIDEPRO-214 folded the same `alt` into the play button underneath, which
 *   reads "Play video: <alt>" — so the cover here is decoration over a control
 *   that carries the description.
 * - `BackpackVideoHoverPreview` wraps it in a plain `div` of its own, because
 *   `Player.Poster` cannot host a cover that comes back (`docs/backpack-parity.md`
 *   records why). There the `alt` is a real accessible name for the resting
 *   representation of the video.
 *
 * A single component covering both would have to take that difference as a flag
 * and then decide the accessibility semantics from it, which is exactly the
 * decision each caller should be seen making. Backpack draws the line in the same
 * place: its own `VideoCoverImage` takes the image concerns and its callers place
 * it (`src/components/Video/VideoCoverImage.tsx:45-108`).
 *
 * Deliberately not `Player.PosterImage`: that primitive hard-codes `alt=""` after
 * its prop spread (`packages/react/src/poster.tsx:157-159`), so an `alt` passed to
 * it is silently discarded — and `renderCustomImage` needs a consumer element type
 * in this position anyway.
 */
export const VideoCoverImage = ({
  alt,
  renderCustomImage: CustomImage,
  src
}: VideoCoverImageProps) =>
  CustomImage ? (
    <CustomImage alt={alt} className="ef-video-cover-image" src={src} />
  ) : (
    <img alt={alt} className="ef-video-cover-image" src={src} />
  );
