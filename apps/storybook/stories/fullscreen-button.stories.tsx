import * as Player from '@reely/react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect } from 'storybook/test';
import { available, notReady, ready } from './support';

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
          '**Contract** — renders `data-reely-part="fullscreen-button"`, `data-provider="<provider>"`, and `data-state="active" | "inline"`.',
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

export const Active: Story = {
  parameters: ready({ fullscreen: available }, { fullscreen: true }),
  play: async ({ canvas }) => {
    const button = await canvas.findByRole('button', {
      name: 'Exit fullscreen'
    });
    await expect(button).toHaveAttribute('aria-pressed', 'true');
  }
};

/**
 * Capability absent: the button stays out of the DOM until the platform
 * resolves fullscreen support — no disabled-but-visible flash-in.
 */
export const CapabilityAbsent: Story = {
  parameters: ready({ fullscreen: notReady }),
  play: async ({ canvas }) => {
    await expect(canvas.queryByRole('button')).toBeNull();
  }
};
