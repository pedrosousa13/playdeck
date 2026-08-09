import * as Player from '@reely/react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, waitFor } from 'storybook/test';
import type { MockPlayerParameters } from '../.storybook/mock-player';
import { withCss } from '../.storybook/theme';
// The stylesheet the Styled story mounts, read as text so the same string is
// both what renders and what the docs block below prints. `?raw` and not
// `?inline` for the reason spelled out in play-button.stories.tsx: a production
// build minifies `?inline` css, and the printed example has to stay readable.
import partCss from '../../../examples/css-activation.css?raw';

const overlayState = (
  state: MockPlayerParameters['state']
): { player: MockPlayerParameters } => ({ player: { state } });

const part = (root: HTMLElement, name: string): HTMLElement => {
  const element = root.querySelector<HTMLElement>(
    `[data-reely-part="${name}"]`
  );
  if (!element) throw new Error(`Expected a ${name} part in the story.`);
  return element;
};

const meta = {
  title: 'Player/ActivationButton',
  component: Player.ActivationButton,
  parameters: {
    docs: {
      description: {
        component: [
          '`Player.ActivationButton` triggers pre-provider activation (`dormant`/`eligible`/`loading-provider`/`error`).',
          '',
          '**Contract** — `data-reely-part="activation"`, `data-state="<activation>"`.',
          '',
          '**Retryability** — in `error` the button offers a retry only when `error.recoverable` is `true`; otherwise it is `aria-disabled` and refuses activation. It reads that one flag, never the error category, which is the same signal `ErrorDisplay` reads for its own retry action.',
          '',
          '**Layout** — a full-bleed overlay (`position: absolute; inset: 0; margin: auto; z-index: 30`) meant to sit over a poster, not a button beside one. The `margin` does nothing at that size — an auto margin resolves to zero against an auto width and height — and exists for the case where your CSS gives the part a size of its own: four zero offsets over-constrain a sized box, and the margin is what centres it in the viewport rather than leaving it in the corner. See `SizedByConsumerCss`.',
          '',
          '**Children** — `children` replaces the default text child (`Play`, or `Retry` where the error in state reports itself recoverable); pass an icon or image instead. See `OverlayOnPoster`.',
          '',
          '**Accessibility** — native `<button>`, keyboard-operable. The accessible name comes from `aria-label` (default `Play video`, or `Retry loading video` where the error in state reports itself recoverable), never from `children`, so a decorative child is safe.',
          '',
          '**Styling** — plain CSS against the part, one selector per `data-state`. The `Styled` story below mounts this file as its own `<style>`. Turning the Theme toolbar toggle on adds `theme.css` underneath, not over: everything here is unlayered, and unlayered CSS beats the `@layer reely` the whole theme lives in:',
          '```css',
          partCss.trim(),
          '```'
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

export const ErrorNotRecoverable: Story = {
  name: 'Error (not recoverable)',
  parameters: overlayState({
    activation: 'error',
    lifecycle: 'error',
    error: {
      category: 'configuration',
      fatal: false,
      recoverable: false,
      message: 'Interaction loading cannot be used with autoplay.'
    }
  }),
  play: async ({ canvas }) => {
    // The other half of the **Retryability** rule: the same `error` state as
    // above, and the flag is all that differs. So the name is `Play video`
    // rather than `Retry loading video`, and the button refuses the press it
    // still carries the error state's colour for.
    const button = await canvas.findByRole('button', { name: 'Play video' });
    await waitFor(() => expect(button).toHaveAttribute('data-state', 'error'));
    await expect(button).toHaveAttribute('aria-disabled', 'true');
  }
};

/**
 * The same overlay with the CSS from this page's **Styling** section applied,
 * in `dormant` — one of the two states a press acts on, `error` (which retries)
 * being the other. Mounted as a `<style>` inside this story's own tree, so it
 * is torn down with the story and no other story on the page sees it.
 */
export const Styled: Story = {
  decorators: [withCss(partCss)],
  parameters: overlayState({ activation: 'dormant', lifecycle: 'idle' }),
  play: async ({ canvas }) => {
    const button = await canvas.findByRole('button', { name: 'Play video' });
    await waitFor(() =>
      expect(button).toHaveAttribute('data-state', 'dormant')
    );
    const styles = globalThis.getComputedStyle(button);
    await expect(styles.backgroundColor).toBe('rgba(11, 14, 19, 0.65)');
    // `dormant` must NOT be wearing the receded look, which belongs to
    // `eligible` — activation is already committed by then and a further press
    // does nothing. The two were shipped swapped once; this is what catches it.
    await expect(styles.opacity).toBe('1');
    await expect(styles.cursor).toBe('pointer');
  }
};

// A consumer stylesheet, unlayered and with no relation to `theme.css`, that
// gives the overlay a fixed size. Local to this story rather than
// `examples/css-activation.css`: that file is a docs fixture printed on this
// page and pinned by `docs:check`, and it teaches painting a full-bleed
// overlay — sizing it would change the lesson.
const sizedCss = `
[data-reely-part='activation'] {
  width: 96px;
  height: 96px;
  border-radius: 50%;
  background: rgb(29 78 216 / 85%);
  color: #ffffff;
}
`;

/**
 * The overlay sized down by a consumer's own CSS, rather than left full-bleed.
 * A fixed size against the primitive's four zero offsets is over-constrained,
 * and the box landed in the viewport's top-left corner (#160) until
 * `ActivationButton` started stating `margin: auto` alongside the offsets that
 * over-constrain it. The bundled theme hits the same case, but it is not the
 * only stylesheet that will ever size this part and for a headless library it
 * is not even the likely one — which is why the `auto` margin is inline on the
 * primitive and not in `theme.css` (ADR-0001).
 */
export const SizedByConsumerCss: Story = {
  decorators: [withCss(sizedCss)],
  parameters: overlayState({ activation: 'dormant', lifecycle: 'idle' }),
  play: async ({ canvas, canvasElement }) => {
    const button = await canvas.findByRole('button', { name: 'Play video' });
    const styles = globalThis.getComputedStyle(button);
    // First that the stylesheet reached the part at all — an unsized overlay is
    // full-bleed, and a full-bleed box is trivially concentric with its
    // viewport, so the centring assertion below only says something once the
    // box is 96px.
    await expect(styles.width).toBe('96px');
    await expect(styles.height).toBe('96px');

    const centre = (element: Element) => {
      const box = element.getBoundingClientRect();
      return { x: box.left + box.width / 2, y: box.top + box.height / 2 };
    };
    const buttonCentre = centre(button);
    const viewportCentre = centre(part(canvasElement, 'viewport'));
    await expect(
      Math.abs(buttonCentre.x - viewportCentre.x)
    ).toBeLessThanOrEqual(1);
    await expect(
      Math.abs(buttonCentre.y - viewportCentre.y)
    ).toBeLessThanOrEqual(1);
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
        <Player.PosterImage src="/poster.svg" />
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

    const poster = part(canvasElement, 'poster');
    await waitFor(() =>
      expect(part(canvasElement, 'poster-image')).toHaveAttribute(
        'data-state',
        'loaded'
      )
    );

    // Stacked, not merely both present. `elementFromPoint` cannot see the
    // poster — it is `pointer-events: none` — so the layering is read off the
    // boxes and the stacking order rather than off a hit-test stack: the
    // overlay covers exactly what the poster covers, and paints above it.
    const overlayBox = button.getBoundingClientRect();
    await expect(overlayBox.toJSON()).toEqual(
      poster.getBoundingClientRect().toJSON()
    );
    const zIndex = (element: HTMLElement) =>
      Number(globalThis.getComputedStyle(element).zIndex);
    await expect(zIndex(button)).toBeGreaterThan(zIndex(poster));

    // The centring claim, made load-bearing: nothing styles the button, so a
    // centred icon is the `<button>` centring its own content across the
    // full-bleed box. Not an exact match — the UA button stylesheet's
    // asymmetric padding/border offsets the content box by ~1.5px vertically
    // — so allow a few pixels, and measure against the boxes rather than
    // fixed coordinates so a viewport-size change does not rewrite the test.
    const centre = (box: DOMRect) => ({
      x: box.left + box.width / 2,
      y: box.top + box.height / 2
    });
    const icon = button.querySelector('svg');
    if (!icon) throw new Error('Expected a play icon in the story.');
    const iconBox = icon.getBoundingClientRect();
    const overlayCentre = centre(overlayBox);
    const iconCentre = centre(iconBox);
    await expect(Math.abs(iconCentre.x - overlayCentre.x)).toBeLessThanOrEqual(
      3
    );
    await expect(Math.abs(iconCentre.y - overlayCentre.y)).toBeLessThanOrEqual(
      3
    );

    // And the overlay is what a click in the middle of the poster reaches.
    const hit = document.elementFromPoint(overlayCentre.x, overlayCentre.y);
    if (!hit) {
      throw new Error(
        'No element at the overlay centre: the point is outside the viewport, so the story is scrolled out of view rather than the overlay being unreachable.'
      );
    }
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
