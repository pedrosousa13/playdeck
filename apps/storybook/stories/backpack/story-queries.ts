/**
 * The DOM queries the wrapper's `play` functions share, against the class names
 * the wrapper itself emits.
 *
 * One home rather than a copy per story file, for the reason `in-page-layout.ts`
 * gives about its scroll geometry: a second copy of `.ef-video-player` is a
 * second selector free to disagree with the first the moment either the wrapper
 * or `backpack-video-styles.ts` renames anything. Queries used by exactly one
 * story file stay in it.
 */

/** The player box, which carries the aspect-ratio, variant and class CSS. */
export const playerBox = (canvasElement: HTMLElement): Element =>
  canvasElement.querySelector('.ef-video-player')!;

/** The play overlay, or `null` once playback has taken it away. */
export const playIcon = (canvasElement: HTMLElement): Element | null =>
  canvasElement.querySelector('.ef-video-play-icon');
