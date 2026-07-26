import * as Player from '@reely/react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, waitFor } from 'storybook/test';

const meta = {
  title: 'Player/LoadingIndicator',
  component: Player.LoadingIndicator,
  parameters: {
    docs: {
      description: {
        component: [
          '`Player.LoadingIndicator` surfaces buffering/loading.',
          '',
          '**Contract** — `data-reely-part="loading-indicator"`, `data-state="loading-provider" | "buffering" | "idle"`. Both active states share one full-bleed box, so styling them differently is a CSS decision, not a prop.',
          '',
          '**Debounce (#35)** — a stall must persist 500ms before it is admitted, and once admitted it is held 500ms, so a short rebuffer never strobes the indicator. A provider load shows immediately (nothing is on screen to flicker against) but is held by the same 500ms floor. A terminal activation error clears it at once. `state.buffering` remains the raw, undebounced signal.',
          '',
          '**Accessibility** — decorative/status.',
          '',
          '**Capability** — not gated (state-driven).'
        ].join('\n')
      }
    }
  },
  render: () => (
    <Player.Viewport style={{ width: 480, height: 270, background: '#0b0e13' }}>
      <Player.LoadingIndicator
        style={{
          display: 'grid',
          placeItems: 'center',
          color: '#e8edf4',
          fontFamily: 'system-ui, sans-serif'
        }}
      />
    </Player.Viewport>
  )
} satisfies Meta<typeof Player.LoadingIndicator>;

export default meta;

type Story = StoryObj<typeof meta>;

export const LoadingProvider: Story = {
  parameters: {
    player: {
      state: { activation: 'loading-provider', lifecycle: 'loading' }
    }
  },
  play: async ({ canvas }) => {
    const indicator = await canvas.findByRole('status');
    await waitFor(() =>
      expect(indicator).toHaveAttribute('data-state', 'loading-provider')
    );
  }
};

export const Buffering: Story = {
  parameters: {
    player: {
      state: {
        activation: 'ready',
        lifecycle: 'ready',
        playback: 'playing',
        buffering: true
      }
    }
  },
  play: async ({ canvas }) => {
    const indicator = await canvas.findByRole('status');
    // The indicator debounces: a stall must persist 500ms before it is
    // admitted (#35). The timeout is explicit so this does not silently depend
    // on waitFor's default being larger than the delay.
    await waitFor(
      () => expect(indicator).toHaveAttribute('data-state', 'buffering'),
      { timeout: 2_000 }
    );
  }
};
