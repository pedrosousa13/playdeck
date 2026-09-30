import * as Player from '@playdeck/react';
import type { Chapter } from '@playdeck/core';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect } from 'storybook/test';
import { available, ready, unavailable } from './support';

const chapters: readonly Chapter[] = [
  { id: 'intro', title: 'Intro', startTime: 0, endTime: 20 },
  { id: 'main', title: 'The main event', startTime: 20, endTime: 45 },
  { id: 'outro', title: 'Outro', startTime: 45, endTime: null }
];

const meta = {
  title: 'Player/ChaptersMenu',
  component: Player.ChaptersMenu,
  parameters: {
    docs: {
      description: {
        component: [
          '`Player.ChaptersMenu` is a preset assembly over `Player.SettingsMenu` / `Player.MenuRadioGroup` / `Player.MenuRadioItem`, in the same shape as `Player.QualityMenu`: it lists `state.chapters`, marks the one containing the current playback position, and renders nothing until `capabilities.chapters` resolves `available` or while the published list is empty.',
          '',
          '**Rungs** — one per published chapter, reading `{title} · {start time}`.',
          '',
          '**Current chapter** — the rung marked from `state.currentTime`: the last chapter whose own `startTime` has been reached.',
          '',
          "**Selection** — choosing a rung seeks to that chapter's `startTime`, tagged with the user origin (`controller.seekToWithOrigin(startTime, 'user')`).",
          '',
          '**Accessibility** — the trigger carries `aria-label="Chapters"`; each rung is `role="menuitemradio"` with `aria-checked` reflecting the current chapter.'
        ].join('\n')
      }
    }
  }
} satisfies Meta<typeof Player.ChaptersMenu>;

export default meta;

type Story = StoryObj<typeof meta>;

/**
 * The full chapter list, `currentTime` inside the second chapter. The rung
 * marked `aria-checked` is the one containing it, not the first or the
 * selected one.
 */
export const List: Story = {
  parameters: ready({ chapters: available }, { chapters, currentTime: 25 }),
  render: () => (
    <Player.Viewport
      style={{
        width: 640,
        height: 360,
        background: '#0b0e13',
        position: 'relative'
      }}
    >
      <Player.ChaptersMenu
        style={{ position: 'absolute', bottom: '0.75rem', right: '0.75rem' }}
      />
    </Player.Viewport>
  ),
  play: async ({ canvas, userEvent }) => {
    const trigger = await canvas.findByRole('button', { name: 'Chapters' });
    await userEvent.click(trigger);
    const rungs = await canvas.findAllByRole('menuitemradio');
    expect(rungs.map((rung) => rung.textContent)).toEqual([
      'Intro · 0:00',
      'The main event · 0:20',
      'Outro · 0:45'
    ]);
    await expect(
      canvas.getByRole('menuitemradio', { name: 'The main event · 0:20' })
    ).toHaveAttribute('aria-checked', 'true');
    await expect(
      canvas.getByRole('menuitemradio', { name: 'Intro · 0:00' })
    ).toHaveAttribute('aria-checked', 'false');
  }
};

/**
 * `capabilities.chapters` unavailable — the whole menu renders nothing, not
 * an empty trigger.
 */
export const Unavailable: Story = {
  parameters: ready({ chapters: unavailable }),
  render: () => (
    <Player.Viewport style={{ width: 480, height: 270, background: '#0b0e13' }}>
      <Player.ChaptersMenu />
    </Player.Viewport>
  ),
  play: async ({ canvas }) => {
    expect(
      canvas.queryByRole('button', { name: 'Chapters' })
    ).not.toBeInTheDocument();
  }
};

/**
 * `capabilities.chapters` available, but the published list is empty — the
 * menu still renders nothing, the same as the unavailable case, rather than
 * an empty trigger with nothing under it.
 */
export const EmptyList: Story = {
  parameters: ready({ chapters: available }, { chapters: [] }),
  render: () => (
    <Player.Viewport style={{ width: 480, height: 270, background: '#0b0e13' }}>
      <Player.ChaptersMenu />
    </Player.Viewport>
  ),
  play: async ({ canvas }) => {
    expect(
      canvas.queryByRole('button', { name: 'Chapters' })
    ).not.toBeInTheDocument();
  }
};
