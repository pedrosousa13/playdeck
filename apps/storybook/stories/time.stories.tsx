import * as Player from '@playdeck/react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect } from 'storybook/test';
import { ready } from './support';

const meta = {
  title: 'Player/Time',
  component: Player.Time,
  parameters: {
    docs: {
      description: {
        component: [
          '`Player.Time` displays current time and/or duration. On a source with no duration — a live stream, or one whose duration has not arrived — `type="duration"` and `type="remaining"` display nothing rather than `0:00`; compose a `LIVE` badge or any other fallback off `data-state="untimed"`, or pass `children`.',
          '',
          '**Usage** — compose it under `Player.Root` (a `Player.Viewport` or `Player.Controls` gives it layout context):',
          '```tsx',
          '<Player.Root source={source}>',
          '  <Player.Viewport>',
          '    <Player.Time type="current" />',
          '  </Player.Viewport>',
          '</Player.Root>',
          '```',
          '',
          '**Contract** — renders `data-playdeck-part="time"`, `data-state="timed" | "untimed"`, and `data-provider="<provider>"`. A `<time>` element, or a `<span>` where it displays nothing, so select on the part rather than the tag.',
          '',
          '**Accessibility** — text content; not an interactive control.',
          '',
          '**Capability** — not gated; it is a display-only element.'
        ].join('\n')
      }
    }
  },
  render: (args) => (
    <Player.Viewport style={{ width: 480, height: 270, background: '#0b0e13' }}>
      <Player.Time
        {...args}
        style={{ color: '#e8edf4', fontFamily: 'system-ui, sans-serif' }}
      />
    </Player.Viewport>
  )
} satisfies Meta<typeof Player.Time>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Current: Story = {
  args: { type: 'current' },
  parameters: ready({}, { currentTime: 75, duration: 100 }),
  play: async ({ canvas }) => {
    const time = await canvas.findByText('1:15');
    await expect(time).toHaveAttribute('data-time-type', 'current');
    await expect(time.tagName).toBe('TIME');
  }
};

export const Duration: Story = {
  args: { type: 'duration' },
  parameters: ready({}, { currentTime: 10, duration: 3725 }),
  play: async ({ canvas }) => {
    await expect(await canvas.findByText('1:02:05')).toBeInTheDocument();
  }
};

export const Remaining: Story = {
  args: { type: 'remaining' },
  parameters: ready({}, { currentTime: 30, duration: 100 }),
  play: async ({ canvas }) => {
    await expect(await canvas.findByText('-1:10')).toBeInTheDocument();
  }
};
