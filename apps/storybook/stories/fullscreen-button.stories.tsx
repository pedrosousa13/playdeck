import * as Player from '@playdeck/react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect } from 'storybook/test';
import { available, notReady, unavailable, ready } from './support';

const meta = {
  title: 'Player/FullscreenButton',
  component: Player.FullscreenButton,
  parameters: {
    docs: {
      description: {
        component: [
          '`Player.FullscreenButton` toggles fullscreen on the viewport.',
          '',
          '**Usage** — compose it under `Player.Root` (a `Player.Viewport` or `Player.Controls` gives it layout context):',
          '```tsx',
          '<Player.Root source={source}>',
          '  <Player.Viewport>',
          '    <Player.FullscreenButton />',
          '  </Player.Viewport>',
          '</Player.Root>',
          '```',
          '',
          '**Contract** — renders `data-playdeck-part="fullscreen-button"`, `data-provider="<provider>"`, and `data-state="active" | "inline"`.',
          '',
          '**Accessibility** — a native `<button>`; reachable and operable by keyboard (Tab to focus, Enter/Space to toggle).',
          '',
          '**Capability** — gated by `fullscreen`; renders nothing until `fullscreen` resolves `available`.'
        ].join('\n')
      }
    }
  },
  render: () => (
    <Player.Viewport style={{ width: 480, height: 270, background: '#0b0e13' }}>
      <Player.FullscreenButton />
    </Player.Viewport>
  )
} satisfies Meta<typeof Player.FullscreenButton>;

export default meta;

type Story = StoryObj<typeof meta>;

/**
 * Not in fullscreen — the state a page loads in. `aria-pressed="false"` and the
 * `Enter fullscreen` label make the toggle's off position explicit rather than
 * leaving it to be inferred from an icon.
 */
export const Inline: Story = {
  parameters: ready({ fullscreen: available }, { fullscreen: false }),
  play: async ({ canvas }) => {
    const button = await canvas.findByRole('button', {
      name: 'Enter fullscreen'
    });
    await expect(button).toHaveAttribute('data-state', 'inline');
    await expect(button).toHaveAttribute('aria-pressed', 'false');
  }
};

/**
 * In fullscreen. One button, not two: the label flips to `Exit fullscreen` and
 * `aria-pressed` to `true`, so the accessible name always describes what the
 * next press does while `aria-pressed` describes where you are.
 */
export const Active: Story = {
  parameters: ready({ fullscreen: available }, { fullscreen: true }),
  play: async ({ canvas }) => {
    const button = await canvas.findByRole('button', {
      name: 'Exit fullscreen'
    });
    await expect(button).toHaveAttribute('aria-pressed', 'true');
  }
};

/** Focus behavior: keyboard reaches the button. */
export const KeyboardFocusable: Story = {
  parameters: ready({ fullscreen: available }, { fullscreen: false }),
  play: async ({ canvas, userEvent }) => {
    const button = await canvas.findByRole('button', {
      name: 'Enter fullscreen'
    });
    await userEvent.tab();
    await expect(button).toHaveFocus();
  }
};

/**
 * Capability absent: the button stays out of the DOM until the platform
 * resolves fullscreen support — no disabled-but-visible flash-in.
 */
export const CapabilityUnknown: Story = {
  parameters: ready({ fullscreen: notReady }),
  play: async ({ canvas }) => {
    await expect(canvas.queryByRole('button')).toBeNull();
  }
};

/**
 * The settled negative, as distinct from the not-yet-resolved one above: the
 * provider has answered and fullscreen is not available here — an iOS inline
 * `<video>`, or an embed whose host forbids it. The rendered result is the
 * same nothing, deliberately, so a consumer never has to distinguish "waiting"
 * from "no" in layout.
 */
export const CapabilityUnavailable: Story = {
  parameters: ready({ fullscreen: unavailable }),
  play: async ({ canvas }) => {
    await expect(canvas.queryByRole('button')).toBeNull();
  }
};
