import * as Player from '@playdeck/react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect } from 'storybook/test';
import { available, ready } from './support';

const meta = {
  title: 'Player/LiveIndicator',
  component: Player.LiveIndicator,
  parameters: {
    docs: {
      description: {
        component: [
          '`Player.LiveIndicator` reflects `PlayerState.live` (`PlayerLiveState`).',
          '',
          '**Usage** — compose it under `Player.Root` (a `Player.Viewport` or `Player.Controls` gives it layout context):',
          '```tsx',
          '<Player.Root source={source}>',
          '  <Player.Viewport>',
          '    <Player.LiveIndicator />',
          '  </Player.Viewport>',
          '</Player.Root>',
          '```',
          '',
          '**Contract** — renders `data-playdeck-part="live"` and `data-state="at-edge" | "behind-edge"`. Renders nothing when `state.live` is `null` — not live, or liveness not yet known. There is no third `data-state` for "not live": `PlayerLiveState` is non-null only when `isLive` is `true`, so those are the only two reachable values.',
          '',
          '**Accessible name** — "Live" by default, and "Go to live" only where pressing the part would act: `liveEdge` seekable and `data-state="behind-edge"`. The visible text stays "Live" in every state; a consumer `aria-label` always wins.',
          '',
          '**A non-interactive badge today** — a `<button type="button">`, and `disabled`, so it is genuinely out of the tab order rather than merely `aria-disabled`, which would leave it focusable for a press that does nothing. That is current behaviour rather than a permanent guarantee: if live-edge seeking is ever wired onto this control, it gains an `onClick` and sheds `disabled`.'
        ].join('\n')
      }
    }
  },
  render: () => (
    <Player.Viewport style={{ width: 480, height: 270, background: '#0b0e13' }}>
      <Player.LiveIndicator />
    </Player.Viewport>
  )
} satisfies Meta<typeof Player.LiveIndicator>;

export default meta;

type Story = StoryObj<typeof meta>;

/** `state.live` is `null` on a source that is not live, or before liveness is known. */
export const NotLive: Story = {
  parameters: ready(),
  play: async ({ canvas }) => {
    await expect(canvas.queryByRole('button')).toBeNull();
  }
};

/** At the live edge. */
export const AtLiveEdge: Story = {
  parameters: ready(
    {},
    { live: { isLive: true, atLiveEdge: true, offsetFromEdge: 0 } }
  ),
  play: async ({ canvas }) => {
    const button = await canvas.findByRole('button', { name: 'Live' });
    await expect(button).toHaveAttribute('data-playdeck-part', 'live');
    await expect(button).toHaveAttribute('data-state', 'at-edge');
    await expect(button).toBeDisabled();
  }
};

/** Behind the live edge — the viewer has scrubbed back from it. */
export const BehindLiveEdge: Story = {
  parameters: ready(
    {},
    { live: { isLive: true, atLiveEdge: false, offsetFromEdge: 12 } }
  ),
  play: async ({ canvas }) => {
    const button = await canvas.findByRole('button', { name: 'Live' });
    await expect(button).toHaveAttribute('data-state', 'behind-edge');
  }
};

/** Behind the live edge with `liveEdge` seekable: the default accessible
 *  name becomes "Go to live", naming what pressing the part does, while the
 *  visible text stays "Live". */
export const BehindLiveEdgeSeekable: Story = {
  parameters: ready(
    { liveEdge: available },
    { live: { isLive: true, atLiveEdge: false, offsetFromEdge: 12 } }
  ),
  play: async ({ canvas }) => {
    const button = await canvas.findByRole('button', { name: 'Go to live' });
    await expect(button).toHaveAttribute('data-state', 'behind-edge');
    await expect(button).not.toBeDisabled();
    await expect(button).toHaveTextContent('Live');
  }
};
