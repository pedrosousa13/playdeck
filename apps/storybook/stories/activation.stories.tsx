import * as Player from '@reely/react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, waitFor } from 'storybook/test';
import type { MockPlayerParameters } from '../.storybook/mock-player';

const overlayState = (
  state: MockPlayerParameters['state']
): { player: MockPlayerParameters } => ({ player: { state } });

const meta = {
  title: 'Player/ActivationButton',
  component: Player.ActivationButton,
  parameters: {
    docs: {
      description: {
        component: [
          '`Player.ActivationButton` triggers pre-provider activation (`dormant`/`eligible`/`loading-provider`/`error`).',
          '',
          '**Contract** — `data-reely-part="activation"`, `data-state="<activation>"`. It is a full-bleed overlay (`position: absolute; inset: 0; z-index: 30`) meant to sit over a poster, not a button beside one.',
          '',
          '**Children** — `children` replaces the default text child (`Play`, or `Retry` in the error state); pass an icon or image instead. See `OverlayOnPoster`.',
          '',
          '**Accessibility** — native `<button>`, keyboard-operable. The accessible name comes from `aria-label` (default `Play video`, or `Retry loading video` in the error state), never from `children`, so a decorative child is safe.'
        ].join('\n')
      }
    }
  },
  render: () => (
    <Player.Viewport style={{ width: 480, height: 270, background: '#0b0e13' }}>
      <Player.ActivationButton />
    </Player.Viewport>
  )
} satisfies Meta<typeof Player.ActivationButton>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Dormant: Story = {
  parameters: overlayState({ activation: 'dormant', lifecycle: 'idle' }),
  play: async ({ canvas }) => {
    const button = await canvas.findByRole('button', { name: 'Play video' });
    await waitFor(() =>
      expect(button).toHaveAttribute('data-state', 'dormant')
    );
  }
};

export const Eligible: Story = {
  parameters: overlayState({ activation: 'eligible', lifecycle: 'idle' }),
  play: async ({ canvas }) => {
    const button = await canvas.findByRole('button', { name: 'Play video' });
    await waitFor(() =>
      expect(button).toHaveAttribute('data-state', 'eligible')
    );
  }
};

export const LoadingProvider: Story = {
  parameters: overlayState({
    activation: 'loading-provider',
    lifecycle: 'loading'
  }),
  play: async ({ canvas }) => {
    const button = await canvas.findByRole('button', { name: 'Play video' });
    await waitFor(() =>
      expect(button).toHaveAttribute('data-state', 'loading-provider')
    );
    await expect(button).toHaveAttribute('aria-disabled', 'true');
  }
};

export const ErrorState: Story = {
  name: 'Error',
  parameters: overlayState({
    activation: 'error',
    lifecycle: 'error',
    error: {
      category: 'provider',
      fatal: false,
      recoverable: true,
      message: 'Unable to load the player provider.'
    }
  }),
  play: async ({ canvas }) => {
    const button = await canvas.findByRole('button', {
      name: 'Retry loading video'
    });
    await waitFor(() => expect(button).toHaveAttribute('data-state', 'error'));
  }
};

/**
 * The realistic shape: a poster underneath, the button full-bleed on top of it
 * with an icon child instead of the default `Play` text. Nothing here styles
 * the button — a `<button>` centres its own content, so the full-bleed overlay
 * puts the icon in the middle of the viewport unaided.
 */
export const OverlayOnPoster: Story = {
  render: () => (
    <Player.Viewport style={{ width: 480, height: 270, background: '#0b0e13' }}>
      <Player.Poster>
        <Player.PosterImage
          alt=""
          src="/poster.svg"
          style={{ width: '100%', height: '100%', objectFit: 'cover' }}
        />
      </Player.Poster>
      <Player.ActivationButton>
        <Player.PlayIcon style={{ color: '#fff', fontSize: '3rem' }} />
      </Player.ActivationButton>
    </Player.Viewport>
  ),
  play: async ({ canvas, canvasElement }) => {
    // The name is the `aria-label`'s, not the child's: the icon is
    // `aria-hidden`, so the button contributes no text of its own — which is
    // also the proof that `children` replaced the default `Play` text.
    const button = await canvas.findByRole('button', { name: 'Play video' });
    await expect(button).toHaveAttribute('aria-label', 'Play video');
    await expect(button.textContent).toBe('');

    const part = (name: string): HTMLElement => {
      const element = canvasElement.querySelector<HTMLElement>(
        `[data-reely-part="${name}"]`
      );
      if (!element) throw new Error(`Expected a ${name} part in the story.`);
      return element;
    };
    const poster = part('poster');
    await waitFor(() =>
      expect(part('poster-image')).toHaveAttribute('data-state', 'loaded')
    );

    // Stacked, not merely both present. `elementsFromPoint` cannot see the
    // poster — it is `pointer-events: none` — so the layering is read off the
    // boxes and the stacking order: the overlay covers exactly what the poster
    // covers, and paints above it.
    const overlayBox = button.getBoundingClientRect();
    await expect(overlayBox.toJSON()).toEqual(
      poster.getBoundingClientRect().toJSON()
    );
    const zIndex = (element: HTMLElement) =>
      Number(globalThis.getComputedStyle(element).zIndex);
    await expect(zIndex(button)).toBeGreaterThan(zIndex(poster));

    // And the overlay is what a click in the middle of the poster reaches.
    const hit = document.elementFromPoint(
      overlayBox.left + overlayBox.width / 2,
      overlayBox.top + overlayBox.height / 2
    );
    await expect(button.contains(hit)).toBe(true);
  }
};

/**
 * Reference `play`-function interaction test: clicking the overlay moves the
 * pristine player from `dormant` to `eligible`. No `Player.Media` is
 * rendered, so activation never proceeds to a provider load.
 */
export const ActivatesOnClick: Story = {
  play: async ({ canvas, userEvent }) => {
    const button = await canvas.findByRole('button', { name: 'Play video' });
    await expect(button).toHaveAttribute('data-state', 'dormant');
    await userEvent.click(button);
    await waitFor(() =>
      expect(button).toHaveAttribute('data-state', 'eligible')
    );
  }
};
