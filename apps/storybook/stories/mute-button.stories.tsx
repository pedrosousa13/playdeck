import * as Player from '@playdeck/react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect } from 'storybook/test';
import { available, notReady, ready } from './support';

const meta = {
  title: 'Player/MuteButton',
  component: Player.MuteButton,
  parameters: {
    docs: {
      description: {
        component: [
          '`Player.MuteButton` mutes/unmutes the active provider.',
          '',
          '**Usage** — compose it under `Player.Root` (a `Player.Viewport` or `Player.Controls` gives it layout context):',
          '```tsx',
          '<Player.Root source={source}>',
          '  <Player.Viewport>',
          '    <Player.MuteButton />',
          '  </Player.Viewport>',
          '</Player.Root>',
          '```',
          '',
          '**Contract** — renders `data-playdeck-part="mute-button"`, `data-provider="<provider>"`, and `data-state="muted" | "unmuted"`.',
          '',
          '**Accessibility** — a native `<button>`; label reflects the mute state; reachable and operable by keyboard (Tab to focus, Enter/Space to toggle).',
          '',
          '**Capability** — gated by `setVolume`; renders nothing until `setVolume` resolves `available`.'
        ].join('\n')
      }
    }
  },
  render: () => (
    <Player.Viewport style={{ width: 480, height: 270, background: '#0b0e13' }}>
      <Player.MuteButton />
    </Player.Viewport>
  )
} satisfies Meta<typeof Player.MuteButton>;

export default meta;

type Story = StoryObj<typeof meta>;

/**
 * Audio on. The label says `Mute` — what the next press does — while
 * `aria-pressed="false"` says where the toggle currently is.
 */
export const Unmuted: Story = {
  parameters: ready({ setVolume: available }, { muted: false }),
  play: async ({ canvas }) => {
    const button = await canvas.findByRole('button', { name: 'Mute' });
    await expect(button).toHaveAttribute('aria-pressed', 'false');
    await expect(button).toHaveAttribute('data-state', 'unmuted');
  }
};

/**
 * Muted, with both signals flipped. Muting is a separate axis from the volume
 * level — `Player/VolumeSlider`'s own `Muted` story holds a volume of 0.7 while
 * reading 0% — so this button reflects `state.muted` and never the level.
 */
export const Muted: Story = {
  parameters: ready({ setVolume: available }, { muted: true }),
  play: async ({ canvas }) => {
    const button = await canvas.findByRole('button', { name: 'Unmute' });
    await expect(button).toHaveAttribute('aria-pressed', 'true');
  }
};

/** Focus behavior: keyboard reaches the button. */
export const KeyboardFocusable: Story = {
  parameters: ready({ setVolume: available }, { muted: false }),
  play: async ({ canvas, userEvent }) => {
    const button = await canvas.findByRole('button', { name: 'Mute' });
    await userEvent.tab();
    await expect(button).toHaveFocus();
  }
};

/** Capability absent: an unresolved volume capability renders nothing. */
export const CapabilityAbsent: Story = {
  parameters: ready({ setVolume: notReady }),
  play: async ({ canvas }) => {
    await expect(canvas.queryByRole('button')).toBeNull();
  }
};
