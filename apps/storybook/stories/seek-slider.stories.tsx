import * as Player from '@reely/react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, waitFor } from 'storybook/test';
import { available, notReady, ready } from './support';

const meta = {
  title: 'Player/SeekSlider',
  component: Player.SeekSlider,
  parameters: {
    docs: {
      description: {
        component: [
          '`Player.SeekSlider` scrubs the current time; a child `seek-buffered` element reflects buffered ranges.',
          '',
          '**Usage** — compose it under `Player.Root` (a `Player.Viewport` or `Player.Controls` gives it layout context):',
          '```tsx',
          '<Player.Root source={source}>',
          '  <Player.Viewport>',
          '    <Player.SeekSlider />',
          '  </Player.Viewport>',
          '</Player.Root>',
          '```',
          '',
          '**Contract** — renders `data-reely-part="seek-slider"` (with a child `data-reely-part="seek-buffered"`), `data-provider="<provider>"`, `data-state="idle" | "ready"` (`ready` once a duration is known), and `data-buffering="true" | "false"`.',
          '',
          '**Stalls** — `data-buffering` is a separate axis from `data-state`: it reports a stall, `data-state` reports whether a seek window exists. It is debounced (500ms before a stall is admitted, 500ms held once admitted) so a short rebuffer never twitches the slider; `state.buffering` remains the raw signal. The slider stays interactive during a stall — seeking away is how a user escapes one.',
          '',
          '**Accessibility** — a range control; arrow keys seek.',
          '',
          '**Capability** — gated by `seek`; renders nothing until `seek` resolves `available`.'
        ].join('\n')
      }
    }
  },
  render: () => (
    <Player.Viewport style={{ width: 480, height: 270, background: '#0b0e13' }}>
      <Player.SeekSlider style={{ width: '90%', margin: '2rem auto' }} />
    </Player.Viewport>
  )
} satisfies Meta<typeof Player.SeekSlider>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Midway: Story = {
  parameters: ready({ seek: available }, { currentTime: 30, duration: 100 }),
  play: async ({ canvas }) => {
    const slider = await canvas.findByRole('slider', { name: 'Seek' });
    await expect(slider).toHaveAttribute('max', '100');
    await expect(slider).toHaveAttribute('aria-valuetext', '0:30 of 1:40');
  }
};

export const WithBufferedRanges: Story = {
  parameters: ready(
    { seek: available },
    {
      currentTime: 30,
      duration: 100,
      buffered: [
        { start: 0, end: 45 },
        { start: 60, end: 80 }
      ]
    }
  ),
  play: async ({ canvasElement }) => {
    const ranges = canvasElement.querySelectorAll(
      '[data-reely-part="seek-buffered-range"]'
    );
    await expect(ranges).toHaveLength(2);
  }
};

/** Mid-playback stall: `data-buffering` flips once the debounce admits it. */
export const Stalled: Story = {
  parameters: ready(
    { seek: available },
    {
      playback: 'playing',
      currentTime: 30,
      duration: 100,
      buffered: [{ start: 0, end: 35 }],
      buffering: true
    }
  ),
  play: async ({ canvas, canvasElement }) => {
    await canvas.findByRole('slider', { name: 'Seek' });
    const root = canvasElement.querySelector(
      '[data-reely-part="seek-slider"]'
    ) as HTMLElement;
    // A stall must persist 500ms before it is admitted (#35). The timeout is
    // explicit so this does not silently depend on waitFor's default being
    // larger than the delay.
    await waitFor(
      () => expect(root).toHaveAttribute('data-buffering', 'true'),
      {
        timeout: 2_000
      }
    );
    // The seek window is a separate axis and must not move during a stall.
    await expect(root).toHaveAttribute('data-state', 'ready');
  }
};

/** Focus behavior: the native slider is keyboard-reachable. */
export const KeyboardFocusable: Story = {
  parameters: ready({ seek: available }, { currentTime: 30, duration: 100 }),
  play: async ({ canvas, userEvent }) => {
    const slider = await canvas.findByRole('slider', { name: 'Seek' });
    await userEvent.tab();
    await expect(slider).toHaveFocus();
  }
};

/** Capability absent: an unresolved seek capability renders nothing. */
export const CapabilityAbsent: Story = {
  parameters: ready({ seek: notReady }, { currentTime: 30, duration: 100 }),
  play: async ({ canvas }) => {
    await expect(canvas.queryByRole('slider')).toBeNull();
  }
};
