import * as Player from '@reely/react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect } from 'storybook/test';
import { available, notReady, unavailable, ready } from './support';

const meta = {
  title: 'Player/AirPlayButton',
  component: Player.AirPlayButton,
  parameters: {
    docs: {
      description: {
        component: [
          '`Player.AirPlayButton` opens the platform AirPlay route picker.',
          '',
          '**Usage** — compose it under `Player.Root` (a `Player.Viewport` or `Player.Controls` gives it layout context):',
          '```tsx',
          '<Player.Root source={source}>',
          '  <Player.Viewport>',
          '    <Player.AirPlayButton />',
          '  </Player.Viewport>',
          '</Player.Root>',
          '```',
          '',
          '**Contract** — renders `data-reely-part="airplay-button"` and `data-provider="<provider>"`. It carries **no `data-state`**: the page is never told which route the user picked, so there is no state to expose and an invented value would be a styling hook that never changes.',
          '',
          '**Not a toggle** — unlike `PipButton` and `FullscreenButton`, this has no `aria-pressed` and one static label. Opening the picker is a request, not a state change the page can observe.',
          '',
          '**Accessibility** — a native `<button>`; reachable and operable by keyboard (Tab to focus, Enter/Space to activate).',
          '',
          '**Capability** — gated by `airPlay`; renders nothing until `airPlay` resolves `available`, which in practice means Safari and iOS.'
        ].join('\n')
      }
    }
  },
  render: () => (
    <Player.Viewport style={{ width: 480, height: 270, background: '#0b0e13' }}>
      <Player.AirPlayButton />
    </Player.Viewport>
  )
} satisfies Meta<typeof Player.AirPlayButton>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Available: Story = {
  parameters: ready({ airPlay: available }),
  play: async ({ canvas }) => {
    const button = await canvas.findByRole('button', { name: 'AirPlay' });
    await expect(button).toHaveAttribute('data-reely-part', 'airplay-button');
    await expect(button).not.toHaveAttribute('aria-pressed');
  }
};

/** Focus behavior: keyboard reaches the button. */
export const KeyboardFocusable: Story = {
  parameters: ready({ airPlay: available }),
  play: async ({ canvas, userEvent }) => {
    const button = await canvas.findByRole('button', { name: 'AirPlay' });
    await userEvent.tab();
    await expect(button).toHaveFocus();
  }
};

/** Capability absent: the button stays out of the DOM until it resolves. */
export const CapabilityAbsent: Story = {
  parameters: ready({ airPlay: notReady }),
  play: async ({ canvas }) => {
    await expect(canvas.queryByRole('button')).toBeNull();
  }
};

/** The common case off Safari/iOS: the provider reports AirPlay unavailable. */
export const CapabilityUnavailable: Story = {
  parameters: ready({ airPlay: unavailable }),
  play: async ({ canvas }) => {
    await expect(canvas.queryByRole('button')).toBeNull();
  }
};
