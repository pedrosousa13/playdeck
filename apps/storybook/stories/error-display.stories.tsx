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

/**
 * A non-fatal `network` error with `recoverable: true`, so the default surface
 * offers its retry button. The overlay is a `role="alert"`, which announces
 * itself the moment it appears — the failure has already happened, so there is
 * nothing to wait for.
 */
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

/**
 * A fatal `source` error. The retry action is absent from the DOM entirely,
 * not rendered and disabled: a visible control that cannot work invites the
 * press it will refuse, and a screen reader has no reason to announce a button
 * nothing can do anything with. `data-state` carries the category, so a
 * consumer can still style source failures differently from network ones.
 */
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

/**
 * The render-prop child from the **Custom rendering** snippet, over the same
 * recoverable error as `Retryable`. The default surface is replaced entirely,
 * but the wrapper — `role="alert"`, the part and state attributes — is still
 * the primitive's, so the announcement and the styling hooks survive a full
 * visual rewrite. `retry` arrives as `null` when the error is not recoverable,
 * which is what makes the `retry && …` guard the whole of the capability rule.
 */
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

/**
 * A **Notice** — a non-fatal `configuration` error reporting a value a provider
 * rejected, while the fall-back it degraded to stands unchanged. Nothing
 * stopped working, so this renders no overlay and no `role="alert"`, and the
 * player underneath is never covered (#319).
 *
 * It is still in the DOM at `data-playdeck-part="notice"`, carrying the
 * category on `data-state`, so a consumer can place it and a monitoring system
 * can read it. It has no appearance of its own: what you see below is the
 * story's own `style`, not the library's.
 */
export const ConfigurationNotice: Story = {
  parameters: {
    player: {
      state: {
        lifecycle: 'ready',
        provider: 'youtube',
        error: {
          category: 'configuration',
          fatal: false,
          recoverable: false,
          message: 'The host option was rejected, so the default host was used.'
        }
      } satisfies ProviderStatePatch
    }
  },
  play: async ({ canvas, canvasElement }) => {
    // No overlay, and nothing announcing a failure that did not happen.
    await expect(canvas.queryByRole('alert')).toBeNull();
    const notice = canvasElement.querySelector('[data-playdeck-part="notice"]');
    await expect(notice).toHaveAttribute('data-state', 'configuration');
    // The library gives this part no geometry; only the story's style prop is
    // on it, so the working player underneath stays visible.
    await expect(
      canvasElement.querySelector('[data-playdeck-part="error"]')
    ).toBeNull();
  }
};
