import * as Player from '@playdeck/react';
import type { PlayerError, ProviderStatePatch } from '@playdeck/core';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect } from 'storybook/test';

const surfaceStyle = {
  display: 'grid',
  placeItems: 'center',
  gap: '0.75rem',
  color: '#e8edf4',
  background: 'rgba(11, 14, 19, 0.85)',
  fontFamily: 'system-ui, sans-serif',
  textAlign: 'center' as const,
  padding: '1rem'
};

const errorState = (error: PlayerError): ProviderStatePatch => ({
  lifecycle: 'error',
  activation: 'error',
  provider: 'native',
  error
});

const network: PlayerError = {
  category: 'network',
  fatal: false,
  recoverable: true,
  message: 'Playback stalled — the network connection was lost.'
};

const unavailable: PlayerError = {
  category: 'source',
  fatal: true,
  recoverable: false,
  message: 'This video is unavailable.'
};

const meta = {
  title: 'Player/ErrorDisplay',
  component: Player.ErrorDisplay,
  parameters: {
    docs: {
      description: {
        component: [
          '`Player.ErrorDisplay` renders `PlayerState.error` with an accessible, capability-aware retry action. It renders nothing when `error` is `null`.',
          '',
          '**Contract** — `role="alert"`, `data-playdeck-part="error"`, `data-state` (the error category), `data-provider`; `className`/`style`/`ref` pass through.',
          '',
          '**Capability-aware retry** — the retry action is present only when `error.recoverable` is `true`; it is absent (never disabled-but-visible) otherwise.',
          '',
          '**Custom rendering** — pass a render-prop child `({ error, retry }) => …`; `retry` is `null` when the error is not recoverable.',
          '',
          '```tsx',
          'import * as Player from "@playdeck/react";',
          '',
          '<Player.Viewport>',
          '  <Player.Media />',
          '  <Player.ErrorDisplay>',
          '    {({ error, retry }) => (',
          '      <div role="alert">',
          '        <p>{error.message}</p>',
          '        {retry && <button onClick={() => retry()}>Retry</button>}',
          '      </div>',
          '    )}',
          '  </Player.ErrorDisplay>',
          '</Player.Viewport>',
          '```'
        ].join('\n')
      }
    }
  },
  render: () => (
    <Player.Viewport
      style={{
        width: 480,
        height: 270,
        background: '#0b0e13',
        position: 'relative'
      }}
    >
      <Player.ErrorDisplay style={surfaceStyle} />
    </Player.Viewport>
  )
} satisfies Meta<typeof Player.ErrorDisplay>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Retryable: Story = {
  parameters: { player: { state: errorState(network) } },
  play: async ({ canvas, userEvent }) => {
    const surface = await canvas.findByRole('alert');
    await expect(surface).toHaveAttribute('data-playdeck-part', 'error');
    await expect(surface).toHaveAttribute('data-state', 'network');
    const retry = canvas.getByRole('button', { name: 'Retry' });
    await userEvent.click(retry);
    // Retry is wired to the controller; the mock provider offers no retry,
    // so the surface stays put — the assertion is that clicking never throws.
    await expect(canvas.getByRole('alert')).toBeInTheDocument();
  }
};

export const NotRecoverable: Story = {
  parameters: { player: { state: errorState(unavailable) } },
  play: async ({ canvas }) => {
    const surface = await canvas.findByRole('alert');
    await expect(surface).toHaveAttribute('data-state', 'source');
    await expect(surface).toHaveTextContent('This video is unavailable.');
    // Capability-aware: no retry offered when the error is not recoverable.
    await expect(canvas.queryByRole('button')).toBeNull();
  }
};

export const CustomRendering: Story = {
  parameters: { player: { state: errorState(network) } },
  render: () => (
    <Player.Viewport
      style={{
        width: 480,
        height: 270,
        background: '#0b0e13',
        position: 'relative'
      }}
    >
      <Player.ErrorDisplay style={surfaceStyle}>
        {({ error, retry }) => (
          <>
            <strong>{`Something went wrong (${error.category})`}</strong>
            {retry && (
              <button onClick={() => retry()} type="button">
                Try again
              </button>
            )}
          </>
        )}
      </Player.ErrorDisplay>
    </Player.Viewport>
  ),
  play: async ({ canvas }) => {
    await expect(
      canvas.getByText('Something went wrong (network)')
    ).toBeInTheDocument();
    await expect(
      canvas.getByRole('button', { name: 'Try again' })
    ).toBeInTheDocument();
  }
};
