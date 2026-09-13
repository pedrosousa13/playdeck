import * as Player from '@playdeck/react';
import type { PlayerQuality } from '@playdeck/core';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect } from 'storybook/test';
import { available, ready, unavailable } from './support';

const ladder: readonly PlayerQuality[] = [
  { id: '1080p', height: 1080, width: 1920, bitrate: 5_000_000 },
  { id: '720p', height: 720, width: 1280, bitrate: 2_500_000 },
  { id: '480p', height: 480, width: 854, bitrate: 1_200_000 }
];

const meta = {
  title: 'Player/QualityMenu',
  component: Player.QualityMenu,
  parameters: {
    docs: {
      description: {
        component: [
          '`Player.QualityMenu` is a preset assembly over `Player.SettingsMenu` / `Player.MenuRadioGroup` / `Player.MenuRadioItem`, in the same shape as `Player.CaptionsMenu`: it lists `state.qualities` plus an "Auto" row, and renders nothing until `capabilities.selectQuality` resolves `available`.',
          '',
          '**Auto row** — `state.selectedQualityId === null` means auto. Its own label names the level actually playing (`state.quality`), e.g. "Auto (1080p)", falling back to "Auto" before a level is known.',
          '',
          '**Selection** — choosing a rung issues `controller.selectQuality(id)`; choosing the auto row issues `controller.selectQuality(null)`.',
          '',
          '**Accessibility** — the trigger carries `aria-label="Quality"`; each rung is `role="menuitemradio"` with `aria-checked` reflecting the current selection.'
        ].join('\n')
      }
    }
  }
} satisfies Meta<typeof Player.QualityMenu>;

export default meta;

type Story = StoryObj<typeof meta>;

/**
 * The full ladder, with a rung selected explicitly. The selected rung is
 * `aria-checked`; the auto row is not.
 */
export const List: Story = {
  parameters: ready(
    { selectQuality: available },
    { qualities: ladder, quality: ladder[0], selectedQualityId: '720p' }
  ),
  render: () => (
    <Player.Viewport
      style={{
        width: 640,
        height: 360,
        background: '#0b0e13',
        position: 'relative'
      }}
    >
      <Player.QualityMenu
        style={{ position: 'absolute', bottom: '0.75rem', right: '0.75rem' }}
      />
    </Player.Viewport>
  ),
  play: async ({ canvas, userEvent }) => {
    const trigger = await canvas.findByRole('button', { name: 'Quality' });
    await userEvent.click(trigger);
    const auto = await canvas.findByRole('menuitemradio', { name: 'Auto' });
    const p1080 = canvas.getByRole('menuitemradio', { name: '1080p' });
    const p720 = canvas.getByRole('menuitemradio', { name: '720p' });
    const p480 = canvas.getByRole('menuitemradio', { name: '480p' });
    await expect(auto).toHaveAttribute('aria-checked', 'false');
    await expect(p1080).toHaveAttribute('aria-checked', 'false');
    await expect(p720).toHaveAttribute('aria-checked', 'true');
    await expect(p480).toHaveAttribute('aria-checked', 'false');
  }
};

/**
 * `selectedQualityId: null` — auto. The auto row's label names the level
 * actually playing rather than just reading "Auto".
 */
export const Auto: Story = {
  parameters: ready(
    { selectQuality: available },
    { qualities: ladder, quality: ladder[0], selectedQualityId: null }
  ),
  render: () => (
    <Player.Viewport
      style={{
        width: 640,
        height: 360,
        background: '#0b0e13',
        position: 'relative'
      }}
    >
      <Player.QualityMenu
        style={{ position: 'absolute', bottom: '0.75rem', right: '0.75rem' }}
      />
    </Player.Viewport>
  ),
  play: async ({ canvas, userEvent }) => {
    const trigger = await canvas.findByRole('button', { name: 'Quality' });
    await userEvent.click(trigger);
    const auto = await canvas.findByRole('menuitemradio', {
      name: 'Auto (1080p)'
    });
    await expect(auto).toHaveAttribute('aria-checked', 'true');
  }
};

/**
 * `selectQuality` unavailable (a native MP4 source, say) — the whole menu
 * renders nothing, not an empty trigger.
 */
export const Unavailable: Story = {
  parameters: ready({ selectQuality: unavailable }, { qualities: ladder }),
  render: () => (
    <Player.Viewport style={{ width: 480, height: 270, background: '#0b0e13' }}>
      <Player.QualityMenu />
    </Player.Viewport>
  ),
  play: async ({ canvas }) => {
    expect(
      canvas.queryByRole('button', { name: 'Quality' })
    ).not.toBeInTheDocument();
  }
};
