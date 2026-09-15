import * as Player from '@playdeck/react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect } from 'storybook/test';
import { assetUrl } from './asset-url';
import { available, notReady, unavailable, ready } from './support';

const meta = {
  title: 'Player/RemotePlaybackButton',
  component: Player.RemotePlaybackButton,
  parameters: {
    docs: {
      description: {
        component: [
          '`Player.RemotePlaybackButton` opens the browser’s Remote Playback picker — the standards-based route to Chromecast and other receivers, distinct from the (unimplemented) Cast SDK.',
          '',
          '**Usage** — compose it under `Player.Root` (a `Player.Viewport` or `Player.Controls` gives it layout context):',
          '```tsx',
          '<Player.Root source={source}>',
          '  <Player.Viewport>',
          '    <Player.RemotePlaybackButton />',
          '  </Player.Viewport>',
          '</Player.Root>',
          '```',
          '',
          '**Contract** — renders `data-playdeck-part="remote-playback-button"` and `data-provider="<provider>"`. It carries **no `data-state`**: which device the viewer picked — or whether they picked one at all — is never exposed. `PlayerState.remotePlayback` does carry the connection state (`connecting`/`connected`/`disconnected`) once a session starts, for a consumer who wants to render it; this button does not.',
          '',
          '**Not a toggle** — like `AirPlayButton`, this has no `aria-pressed` and one static label. Opening the picker is a request.',
          '',
          '**Accessibility** — a native `<button>`; reachable and operable by keyboard (Tab to focus, Enter/Space to activate).',
          '',
          '**Capability** — gated by `remotePlayback`; renders nothing until a receiver is actually reachable on the network, which the honest CI default never has.'
        ].join('\n')
      }
    }
  },
  render: () => (
    <Player.Viewport style={{ width: 480, height: 270, background: '#0b0e13' }}>
      <Player.RemotePlaybackButton />
    </Player.Viewport>
  )
} satisfies Meta<typeof Player.RemotePlaybackButton>;

export default meta;

type Story = StoryObj<typeof meta>;

/**
 * The only rendered state this button has. It carries no `data-state` and no
 * `aria-pressed`, which the play function asserts: opening the route picker
 * is a request, and there is no "casting" for it to reflect.
 */
export const Available: Story = {
  parameters: ready({ remotePlayback: available }),
  play: async ({ canvas }) => {
    const button = await canvas.findByRole('button', { name: 'Cast' });
    await expect(button).toHaveAttribute(
      'data-playdeck-part',
      'remote-playback-button'
    );
    await expect(button).not.toHaveAttribute('aria-pressed');
  }
};

/** Focus behavior: keyboard reaches the button. */
export const KeyboardFocusable: Story = {
  parameters: ready({ remotePlayback: available }),
  play: async ({ canvas, userEvent }) => {
    const button = await canvas.findByRole('button', { name: 'Cast' });
    await userEvent.tab();
    await expect(button).toHaveFocus();
  }
};

/** Capability absent: the button stays out of the DOM until it resolves. */
export const CapabilityAbsent: Story = {
  parameters: ready({ remotePlayback: notReady }),
  play: async ({ canvas }) => {
    await expect(canvas.queryByRole('button')).toBeNull();
  }
};

/** The common case: no receiver is reachable, so the capability stays unavailable. */
export const CapabilityUnavailable: Story = {
  parameters: ready({ remotePlayback: unavailable }),
  play: async ({ canvas }) => {
    await expect(canvas.queryByRole('button')).toBeNull();
  }
};

/**
 * A real native provider, no mock — the honest CI default this issue's
 * acceptance criteria name: chromium in CI never has a Remote Playback
 * receiver on the network, so `capabilities.remotePlayback` genuinely settles
 * `unavailable` and the button renders nothing. `e2e/remote-playback-button.spec.ts`
 * drives this story by id; the `Available` story above is what proves the
 * button can render at all once a device is reported, since there is no real
 * device to report one here.
 */
export const RealProviderNoDevice: Story = {
  tags: ['real-playback', '!test'],
  render: () => (
    <Player.Root loading="eager" source={assetUrl('tracer.mp4')}>
      <Player.Viewport
        style={{ width: 480, height: 270, background: '#0b0e13' }}
      >
        <Player.Media />
        <Player.RemotePlaybackButton />
      </Player.Viewport>
    </Player.Root>
  )
};
