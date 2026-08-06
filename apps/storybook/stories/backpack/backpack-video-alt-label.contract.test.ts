import {
  act,
  cleanup,
  fireEvent,
  render,
  screen
} from '@testing-library/react';
import { createElement } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { BackpackVideo, type BackpackVideoProps } from './backpack-video';
import { useReportingProvider } from './reporting-provider';

/**
 * SIDEPRO-214: `alt` used to reach one place only — a DOM attribute on the
 * cover `<img>` inside `Player.Poster`, which is `aria-hidden="true"`
 * (`packages/react/src/poster.tsx:66`). So the text a consumer supplied was
 * dead weight: nothing in a hidden subtree reaches the accessibility tree, and
 * the one named affordance on the surface said "Play video" and nothing about
 * which video. Backpack does expose the text, from its cover container's own
 * `aria-label={alt}` (`VideoCoverImage.tsx:99-100`).
 *
 * What this pins is the answer the wrapper gives instead: the text goes onto
 * the affordance that is actually named, as `${action}: ${alt}`. The action
 * verb stays first, which is the whole reason the format is a prefix rather
 * than a replacement — a name that opens with a place ("EF campus tour,
 * Brighton") tells a screen-reader user nothing about what pressing does, and
 * the button is a play/pause toggle before it is a description of anything.
 *
 * Folded unconditionally on `alt`, not on whether a cover happens to be
 * showing: the text describes the video, and the affordance acts on the video,
 * so a name that appeared and vanished with the poster would be describing the
 * image instead. The tests below therefore stage a player that is already
 * `ready`, where no cover is up at all.
 *
 * Every assertion is by role and accessible name rather than by reading the
 * `alt` attribute, because the attribute was never the thing in question — it
 * was already there and already silent.
 *
 * The player is staged the way `external-control.contract.test.ts` and
 * `off-screen-pause.contract.test.ts` stage theirs: a
 * {@link useReportingProvider} installed straight onto the controller through
 * the wrapper's own ref. Reported `ready`, so `awaitingActivation` is false and
 * the wrapper's own `ef-video-controller` toggle is the surface's one button —
 * `Player.ActivationButton` renders itself away at that point
 * (`packages/react/src/loading-error.tsx:40`). It is also what makes the
 * play/pause flip reachable offline: the provider's `play` emits
 * `playback: 'playing'` back, which is what moves the label.
 *
 * The other `aria-label` this format reaches, `Player.ActivationButton`'s, is
 * pinned in `backpack-video-activation-error.contract.test.ts` — including the
 * one state it must not reach, an activation error, where the wrapper hands the
 * primitive nothing and the primitive's own "Retry loading video" applies.
 */

/**
 * `BackpackVideo` with the staged provider on its forwarded ref.
 * `pauseOnOutOfViewport: false` at the call site below keeps the off-screen
 * hook out of these tests explicitly, as `external-control.contract.test.ts`
 * does, rather than resting on happy-dom's `IntersectionObserver` never
 * reporting anything.
 */
const StagedVideo = (props: BackpackVideoProps) =>
  createElement(BackpackVideo, { ...props, ref: useReportingProvider() });

const renderVideo = (overrides: Partial<BackpackVideoProps> = {}) => {
  const view = render(
    createElement(StagedVideo, {
      muted: true,
      pauseOnOutOfViewport: false,
      url: 'mock://reely/unresolvable.mp4',
      ...overrides
    })
  );
  return {
    ...view,
    /** The viewer clicking the wrapper's own play/pause toggle. */
    toggle: () => {
      act(() => {
        fireEvent.click(view.container.querySelector('.ef-video-controller')!);
      });
    }
  };
};

describe('BackpackVideo cover alt in the play affordance’s name', () => {
  afterEach(() => {
    cleanup();
  });

  // `name` as a string is an exact whole-name match in Testing Library, so this
  // one query pins both halves at once: the alt is in the name, and the action
  // is still what the name opens with.
  it('names the play affordance for the action and then the alt', () => {
    renderVideo({ alt: 'EF campus tour, Brighton' });

    const play = screen.getByRole('button', {
      name: 'Play video: EF campus tour, Brighton'
    });

    expect(play.getAttribute('aria-pressed')).toBe('false');
  });

  it('leaves the name alone when no alt is supplied', () => {
    renderVideo();

    expect(
      screen.getByRole('button', { name: 'Play video' }).getAttribute('class')
    ).toBe('ef-video-controller');
  });

  // Whitespace is the same absence: a caller who passes `' '` has described
  // nothing, and a name reading "Play video: " would be a separator with
  // nothing after it.
  it('leaves the name alone for a whitespace-only alt', () => {
    renderVideo({ alt: '   ' });

    expect(
      screen.getByRole('button', { name: 'Play video' }).getAttribute('class')
    ).toBe('ef-video-controller');
  });

  it('flips to the pause form, alt and all, once the video plays', () => {
    const { toggle } = renderVideo({ alt: 'EF campus tour, Brighton' });

    toggle();

    const pause = screen.getByRole('button', {
      name: 'Pause video: EF campus tour, Brighton'
    });
    expect(pause.getAttribute('aria-pressed')).toBe('true');

    toggle();

    const play = screen.getByRole('button', {
      name: 'Play video: EF campus tour, Brighton'
    });
    expect(play.getAttribute('aria-pressed')).toBe('false');
  });
});
