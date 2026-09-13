import * as Player from '@playdeck/react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect } from 'storybook/test';
import { available, ready, unavailable } from './support';

const meta = {
  title: 'Player/PlaybackRateMenu',
  component: Player.PlaybackRateMenu,
  parameters: {
    docs: {
      description: {
        component: [
          '`Player.PlaybackRateMenu` is a preset assembly over `Player.SettingsMenu` / `Player.MenuRadioGroup` / `Player.MenuRadioItem`, in the same shape as `Player.QualityMenu`: it lists a rate ladder and renders nothing until `capabilities.setPlaybackRate` resolves `available`.',
          '',
          '**Rate list** — defaults to `[0.5, 1, 1.5, 2]`, the same ladder `RateMenu` in the composed-example guide hand-lists; pass `rates` to offer a different set. Each rung reads `{rate}×`.',
          '',
          '**Selection** — the active rung is marked from `state.playbackRate`; choosing a rung issues `controller.setPlaybackRate(rate)`.',
          '',
          '**Accessibility** — the trigger carries `aria-label="Playback rate"`; each rung is `role="menuitemradio"` with `aria-checked` reflecting the current rate.'
        ].join('\n')
      }
    }
  }
} satisfies Meta<typeof Player.PlaybackRateMenu>;

export default meta;

type Story = StoryObj<typeof meta>;

/**
 * The default `[0.5, 1, 1.5, 2]` ladder. The active rate is `aria-checked`.
 */
export const List: Story = {
  parameters: ready({ setPlaybackRate: available }, { playbackRate: 1.5 }),
  render: () => (
    <Player.Viewport
      style={{
        width: 640,
        height: 360,
        background: '#0b0e13',
        position: 'relative'
      }}
    >
      <Player.PlaybackRateMenu
        style={{ position: 'absolute', bottom: '0.75rem', right: '0.75rem' }}
      />
    </Player.Viewport>
  ),
  play: async ({ canvas, userEvent }) => {
    const trigger = await canvas.findByRole('button', {
      name: 'Playback rate'
    });
    await userEvent.click(trigger);
    const rungs = await canvas.findAllByRole('menuitemradio');
    expect(rungs.map((rung) => rung.textContent)).toEqual([
      '0.5×',
      '1×',
      '1.5×',
      '2×'
    ]);
    await expect(
      canvas.getByRole('menuitemradio', { name: '1.5×' })
    ).toHaveAttribute('aria-checked', 'true');
    await expect(
      canvas.getByRole('menuitemradio', { name: '1×' })
    ).toHaveAttribute('aria-checked', 'false');
  }
};

/**
 * A consumer-supplied `rates` list replaces the default ladder entirely.
 */
export const CustomRates: Story = {
  parameters: ready({ setPlaybackRate: available }, { playbackRate: 2 }),
  render: () => (
    <Player.Viewport
      style={{
        width: 640,
        height: 360,
        background: '#0b0e13',
        position: 'relative'
      }}
    >
      <Player.PlaybackRateMenu
        rates={[1, 2, 4]}
        style={{ position: 'absolute', bottom: '0.75rem', right: '0.75rem' }}
      />
    </Player.Viewport>
  ),
  play: async ({ canvas, userEvent }) => {
    const trigger = await canvas.findByRole('button', {
      name: 'Playback rate'
    });
    await userEvent.click(trigger);
    const rungs = await canvas.findAllByRole('menuitemradio');
    expect(rungs.map((rung) => rung.textContent)).toEqual(['1×', '2×', '4×']);
    await expect(
      canvas.getByRole('menuitemradio', { name: '2×' })
    ).toHaveAttribute('aria-checked', 'true');
  }
};

/**
 * `setPlaybackRate` unavailable — the whole menu renders nothing, not an
 * empty trigger.
 */
export const Unavailable: Story = {
  parameters: ready({ setPlaybackRate: unavailable }),
  render: () => (
    <Player.Viewport style={{ width: 480, height: 270, background: '#0b0e13' }}>
      <Player.PlaybackRateMenu />
    </Player.Viewport>
  ),
  play: async ({ canvas }) => {
    expect(
      canvas.queryByRole('button', { name: 'Playback rate' })
    ).not.toBeInTheDocument();
  }
};
