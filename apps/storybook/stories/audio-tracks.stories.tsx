import * as Player from '@playdeck/react';
import type { AudioTrack } from '@playdeck/core';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect } from 'storybook/test';
import { available, ready, unavailable } from './support';

const tracks: readonly AudioTrack[] = [
  { id: 'en', label: 'English', language: 'en', active: true },
  { id: 'es', label: 'Español', language: 'es', active: false }
];

const meta = {
  title: 'Player/AudioTrackMenu',
  component: Player.AudioTrackMenu,
  parameters: {
    docs: {
      description: {
        component: [
          '`Player.AudioTrackMenu` is a preset assembly over `Player.SettingsMenu` / `Player.MenuRadioGroup` / `Player.MenuRadioItem`, in the same shape as `Player.QualityMenu` and `Player.PlaybackRateMenu`: it lists `state.audioTracks` and renders nothing until `capabilities.selectAudioTrack` resolves `available`.',
          '',
          '**No "Auto" row.** Unlike `QualityMenu`, an audio track carries its own `active` field rather than a sibling `state.selectedAudioTrackId` (see the comment above `AudioTrack`, `packages/core/src/types.ts`), and there is no auto-selection concept for audio tracks — every row names a real track.',
          '',
          '**Selection** — choosing a row issues `controller.selectAudioTrack(id)`.',
          '',
          '**Accessibility** — the trigger carries `aria-label="Audio track"`; each row is `role="menuitemradio"` with `aria-checked` reflecting the track it was built from.'
        ].join('\n')
      }
    }
  }
} satisfies Meta<typeof Player.AudioTrackMenu>;

export default meta;

type Story = StoryObj<typeof meta>;

/**
 * Two published tracks, English active. Selecting the other row would issue
 * `controller.selectAudioTrack('es')`.
 */
export const List: Story = {
  parameters: ready({ selectAudioTrack: available }, { audioTracks: tracks }),
  render: () => (
    <Player.Viewport
      style={{
        width: 640,
        height: 360,
        background: '#0b0e13',
        position: 'relative'
      }}
    >
      <Player.AudioTrackMenu
        style={{ position: 'absolute', bottom: '0.75rem', right: '0.75rem' }}
      />
    </Player.Viewport>
  ),
  play: async ({ canvas, userEvent }) => {
    const trigger = await canvas.findByRole('button', { name: 'Audio track' });
    await userEvent.click(trigger);
    const english = await canvas.findByRole('menuitemradio', {
      name: 'English'
    });
    const spanish = canvas.getByRole('menuitemradio', { name: 'Español' });
    await expect(english).toHaveAttribute('aria-checked', 'true');
    await expect(spanish).toHaveAttribute('aria-checked', 'false');
  }
};

/**
 * `selectAudioTrack` unavailable (a single-audio source, say) — the whole
 * menu renders nothing, not an empty trigger.
 */
export const Unavailable: Story = {
  parameters: ready({ selectAudioTrack: unavailable }, { audioTracks: [] }),
  render: () => (
    <Player.Viewport style={{ width: 480, height: 270, background: '#0b0e13' }}>
      <Player.AudioTrackMenu />
    </Player.Viewport>
  ),
  play: async ({ canvas }) => {
    expect(
      canvas.queryByRole('button', { name: 'Audio track' })
    ).not.toBeInTheDocument();
  }
};
