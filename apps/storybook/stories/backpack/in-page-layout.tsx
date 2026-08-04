import { useState, type CSSProperties, type ReactNode } from 'react';
import { playerBox } from './story-queries';

/**
 * Backpack's `InPageLayout` (`stories/components/Video/Video.stories.tsx:314-355`)
 * on this workbench: a scroll container that is the video's
 * `intersectionObserverRoot`, a sticky badge reporting what `onPlayChange`
 * says, and a tall spacer either side of the video so it can be scrolled out of
 * the container and back.
 *
 * Shared by the deterministic `Backpack parity/Video` stories and the
 * `Real playback/BackpackVideo` ones, because the layout is the whole of what
 * those two sets have in common and the video inside it is the whole of what
 * they differ on. Which video that is, is the `video` prop's business: the
 * deterministic stories put a mock-staged player there, the real-playback ones
 * the wrapper itself.
 *
 * Backpack's Tailwind classes and its `Text` component are not reproduced —
 * behaviour is what the wrapper is for, so the styling is story-local.
 *
 * Inline `style`, where the neighbouring `backpack-video-styles.ts` is a
 * stylesheet mounted by `withCss`: nothing here needs a selector, so nothing
 * here needs a stylesheet. That file exists because the rules it carries cannot
 * be written inline — a `:hover` state, a `::after` play triangle, and
 * descendant matches against class names the wrapper itself emits, which no
 * caller of the wrapper is in a position to set a `style` on. This layout
 * renders its own elements and every rule below applies unconditionally to one
 * of them, so the styles live on the elements they style and there is no second
 * file to keep in step.
 */

/*
 * What a `play` function needs to drive this layout: the height to build it at,
 * the two elements to reach for, and the scroll that puts the video at a chosen
 * position. They live here rather than in a story file because they are this
 * layout's own driving surface — every one of them is written against the
 * geometry below — and because two story suites now scroll it
 * (`Backpack parity/Video` and `Backpack parity/AutoplayVideo`), so a second
 * copy would be a second set of numbers free to disagree with these.
 */

/**
 * Height of the scroll container the deterministic in-page stories build.
 * Fixed rather than Backpack's `h-screen`, so the geometry their `play`
 * functions scroll through cannot depend on the runner's window size, and
 * taller than the player box in either suite — 270px at `Video`'s 480px width,
 * 338px at `AutoplayVideo`'s 600px — so "the whole video is inside the
 * container" is a position that exists in both.
 */
export const scrollPanelHeight = '360px';

/** How much of the video's own height is inside the container's top edge. */
export const fullyVisible = 1;
export const quarterVisible = 0.25;
/** Negative: half the video's height *past* the edge, so none of it shows. */
export const clearOfTheEdge = -0.5;

/** The scroll container and the player box inside it. */
export const inPageParts = (canvasElement: HTMLElement) => ({
  container: canvasElement.querySelector('[role="region"]')!,
  video: playerBox(canvasElement)
});

/**
 * Scrolls `container` so that `fraction` of the video's own height is left
 * inside the container's top edge. Every number comes from live geometry, so
 * the spacers, the player's width and the runner's window can all change
 * without the scroll losing its meaning — and there is no distance to
 * hard-code.
 */
export const scrollToVisibleFraction = (
  container: Element,
  video: Element,
  fraction: number
): void => {
  const { bottom, height } = video.getBoundingClientRect();
  container.scrollTop +=
    bottom - container.getBoundingClientRect().top - fraction * height;
};

/** What the layout hands the video it wraps. */
export type InPageVideoProps = {
  /**
   * The scroll container, or `null` on the first render — the video's own
   * observer waits for it (`off-screen-pause.ts:219-233`, its `if (!node) return`
   * effect, keyed on `[node, root, threshold]`).
   */
  readonly intersectionObserverRoot: Element | null;
  /** Drives the badge, and the story's own `onPlayChange` under it. */
  readonly onPlayChange: (isPlaying: boolean) => void;
};

export type InPageLayoutProps = {
  /**
   * Height of the scroll container. Backpack's is `h-screen`; the
   * deterministic stories pass a pixel value instead, so the geometry their
   * `play` functions scroll through cannot depend on the test runner's window
   * size.
   */
  readonly height: string;
  /**
   * Called with every transition the badge shows, so a story's own spy sees
   * the sequence too.
   */
  readonly onPlayChange?: (isPlaying: boolean) => void;
  readonly video: (props: InPageVideoProps) => ReactNode;
};

const badgeStyle: CSSProperties = {
  background: '#0b0e13',
  borderRadius: '0.25rem',
  color: '#ffffff',
  fontSize: '0.875rem',
  fontWeight: 500,
  padding: '0.5rem 1rem',
  // Restores what the bar below gives up.
  pointerEvents: 'auto'
};

const badgeBarStyle: CSSProperties = {
  display: 'flex',
  justifyContent: 'flex-end',
  padding: '0 1rem',
  // The bar spans the container's full width above the video (Backpack's
  // `sticky top-m z-50 flex justify-end`), so without this it would swallow a
  // click on whatever it happens to be sitting over. A status readout has no
  // business being a click target.
  pointerEvents: 'none',
  position: 'sticky',
  top: '1rem',
  zIndex: 50
};

/** Backpack's `h-[900px]` filler, tall enough to scroll the video clear. */
const spacerStyle: CSSProperties = {
  alignItems: 'center',
  background: '#f3f4f6',
  color: '#0b0e13',
  display: 'flex',
  height: '900px',
  justifyContent: 'center'
};

const videoBoxStyle: CSSProperties = {
  display: 'flex',
  justifyContent: 'center',
  padding: '1rem'
};

export const InPageLayout = ({
  height,
  onPlayChange,
  video
}: InPageLayoutProps) => {
  const [isPlaying, setIsPlaying] = useState(false);
  // `useState` rather than `useRef`: setting the element triggers a re-render,
  // so the video has a defined root before its `IntersectionObserver` is set up.
  // A ref would still be empty on the render that passed it down. Backpack's own
  // comment says the same (`Video.stories.tsx:321-322`).
  const [scrollContainer, setScrollContainer] = useState<Element | null>(null);

  return (
    // A named region, for the same reason the badge below is a `status`: it is
    // the other thing a `play` function reaches for — the element it scrolls —
    // so it gets a role to find it by rather than an exported class name that
    // would carry no styles. Naming a scrollable area is what a real page would
    // do with its own landmarks anyway.
    <div
      aria-label="In-page content"
      ref={setScrollContainer}
      role="region"
      style={{ height, overflowY: 'auto', position: 'relative' }}
    >
      <div style={badgeBarStyle}>
        {/*
          A live region, where Backpack's badge is a plain `div`: it is what a
          `play` function reads the playback state off, so it gets a role to
          find it by rather than a class, and "the playback state changed" is
          what `status` is for.
        */}
        <div role="status" style={badgeStyle}>
          {isPlaying ? '▶ Playing' : '⏸ Paused'}
        </div>
      </div>
      <div style={spacerStyle}>
        <p>Scroll down to see the video</p>
      </div>
      <div style={videoBoxStyle}>
        {video({
          intersectionObserverRoot: scrollContainer,
          onPlayChange: (playing) => {
            setIsPlaying(playing);
            onPlayChange?.(playing);
          }
        })}
      </div>
      <div style={spacerStyle}>
        <p>Scroll up to see the video again</p>
      </div>
    </div>
  );
};
