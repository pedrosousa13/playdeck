/**
 * Story-local CSS for the `BackpackVideo` wrapper, shared by its deterministic
 * and its real-playback stories. Behaviour parity is the goal of the wrapper,
 * so Backpack's styling stack (tailwind-variants plus its theme) is out of
 * scope; the class names are Backpack's own, which keeps the shape of the
 * markup comparable to the component this stands in for.
 *
 * `width` is the only thing the two sets disagree on, so it is the only
 * parameter.
 */
export const backpackVideoCss = (width: string): string => `
.ef-video-player {
  position: relative;
  width: ${width};
  aspect-ratio: 16 / 9;
  background: #0b0e13;
  border-radius: 0.25rem;
  overflow: hidden;
}

.ef-video-play-icon {
  position: absolute;
  inset: 0;
  margin: auto;
  width: 4rem;
  height: 4rem;
  border-radius: 50%;
  background: rgba(232, 237, 244, 0.92);
  pointer-events: none;
  z-index: 20;
}

.ef-video-play-icon::after {
  content: '';
  position: absolute;
  inset: 0;
  margin: auto;
  width: 0;
  height: 0;
  border-style: solid;
  border-width: 0.75rem 0 0.75rem 1.25rem;
  border-color: transparent transparent transparent #0b0e13;
}

/* Worn by the wrapper's toggle and by Player.ActivationButton, so the click
   target looks the same before and after the provider attaches. */
.ef-video-controller {
  appearance: none;
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  padding: 0;
  border: 0;
  background: transparent;
  cursor: pointer;
  z-index: 30;
}

.ef-video-controls {
  position: absolute;
  right: 0;
  bottom: 0;
  left: 0;
  display: flex;
  gap: 0.5rem;
  padding: 0.5rem;
  z-index: 30;
}

/* Player.Poster already positions itself (inset: 0, z-index: 10); this only
   clips the hover zoom below to the cover's own bounds. */
.ef-video-cover {
  overflow: hidden;
}

.ef-video-cover-image {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: cover;
  transform: scale(1);
  transition: transform 200ms ease;
}

/* Short transition so a story can hover and assert the settled transform
   under waitFor without a long wait. */
.ef-video-player:hover .ef-video-cover[data-hover-effect='true'] .ef-video-cover-image {
  transform: scale(1.05);
}
`;
