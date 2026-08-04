import { useState, type CSSProperties, type ReactNode } from 'react';

/**
 * Backpack's `InPageLayout` (`stories/components/Video/Video.stories.tsx:314-355`)
 * on this workbench: a scroll container that is the video's
 * `intersectionObserverRoot`, a sticky badge reporting what `onPlayChange`
 * says, and a tall spacer either side of the video so it can be scrolled out of
 * the container and back.
 *
 * Shared by the deterministic `Backpack parity/Video` stories and the
 * `Real playback/BackpackVideo` ones — like `backpack-video-css.ts` — because
 * the layout is the whole of what those two sets have in common and the video
 * inside it is the whole of what they differ on. Which video that is, is the
 * `video` prop's business: the deterministic stories put a mock-staged player
 * there, the real-playback ones the wrapper itself.
 *
 * Backpack's Tailwind classes and its `Text` component are not reproduced —
 * behaviour is what the wrapper is for, so the styling here is story-local
 * inline CSS in the shape of Backpack's own classes.
 */

/** Class on the scroll container, so a `play` function can scroll it. */
export const scrollContainerClass = 'story-in-page-scroll';

/** What the layout hands the video it wraps. */
export type InPageVideoProps = {
  /**
   * The scroll container, or `null` on the first render — the video's own
   * observer waits for it (`viewport-pause.ts:148-162`).
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
  // `useState` rather than `useRef`, and Backpack's own comment says why
  // (`Video.stories.tsx:321-322`): setting the element triggers a re-render,
  // giving the video a defined root before its `IntersectionObserver` is set
  // up. A ref would still be empty on the render that passed it down.
  const [scrollContainer, setScrollContainer] = useState<Element | null>(null);

  return (
    <div
      className={scrollContainerClass}
      ref={setScrollContainer}
      style={{ height, overflowY: 'auto', position: 'relative' }}
    >
      <div style={badgeBarStyle}>
        {/*
          A live region, where Backpack's badge is a plain `div`: it is the one
          thing in the layout a `play` function reads, so it gets a role to
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
