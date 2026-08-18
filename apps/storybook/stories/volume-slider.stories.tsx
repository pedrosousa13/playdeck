import * as Player from '@playdeck/react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect } from 'storybook/test';
import { available, notReady, ready } from './support';

const meta = {
  title: 'Player/VolumeSlider',
  component: Player.VolumeSlider,
  parameters: {
    docs: {
      description: {
        component: [
          "`Player.VolumeSlider` sets the active provider's volume.",
          '',
          '**Usage** — compose it under `Player.Root` (a `Player.Viewport` or `Player.Controls` gives it layout context):',
          '```tsx',
          '<Player.Root source={source}>',
          '  <Player.Viewport>',
          '    <Player.VolumeSlider />',
          '  </Player.Viewport>',
          '</Player.Root>',
          '```',
          '',
          '**Contract** — renders `data-playdeck-part="volume-slider"`, `data-provider="<provider>"`, and `data-state="muted" | "unmuted"`.',
          '',
          '**Accessibility** — exposes a range semantics control. On its own, every arrow key adjusts the value by `step`. Inside a `Player.Controls` region the shortcut layer owns the arrows: `ArrowUp`/`ArrowDown` still adjust the volume, by 0.05 through `setVolume` rather than through `step`, and `ArrowLeft`/`ArrowRight` seek instead. `Home` and `End` stay native either way.',
          '',
          '**Capability** — gated by `setVolume`; renders nothing until `setVolume` resolves `available`.'
        ].join('\n')
      }
    }
  },
  render: () => (
    <Player.Viewport style={{ width: 480, height: 270, background: '#0b0e13' }}>
      <Player.VolumeSlider />
    </Player.Viewport>
  )
} satisfies Meta<typeof Player.VolumeSlider>;

export default meta;

type Story = StoryObj<typeof meta>;

export const HalfVolume: Story = {
  parameters: ready({ setVolume: available }, { volume: 0.5, muted: false }),
  play: async ({ canvas }) => {
    const slider = await canvas.findByRole('slider', { name: 'Volume' });
    await expect(slider).toHaveAttribute('aria-valuetext', '50%');
    await expect(slider).toHaveAttribute('min', '0');
    await expect(slider).toHaveAttribute('max', '1');
  }
};

export const Muted: Story = {
  parameters: ready({ setVolume: available }, { volume: 0.7, muted: true }),
  play: async ({ canvas }) => {
    const slider = await canvas.findByRole('slider', { name: 'Volume' });
    await expect(slider).toHaveAttribute('aria-valuetext', '0%');
  }
};

/** Focus behavior: the native slider is keyboard-reachable. */
export const KeyboardFocusable: Story = {
  parameters: ready({ setVolume: available }, { volume: 0.5 }),
  play: async ({ canvas, userEvent }) => {
    const slider = await canvas.findByRole('slider', { name: 'Volume' });
    await userEvent.tab();
    await expect(slider).toHaveFocus();
  }
};

/** Capability absent: an unresolved volume capability renders nothing. */
export const CapabilityAbsent: Story = {
  parameters: ready({ setVolume: notReady }),
  play: async ({ canvas }) => {
    await expect(canvas.queryByRole('slider')).toBeNull();
  }
};
