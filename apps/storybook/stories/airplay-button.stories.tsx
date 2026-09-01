import * as Player from '@playdeck/react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect } from 'storybook/test';
import { available, notReady, unavailable, ready } from './support';

const meta = {
  title: 'Player/AirPlayButton',
  component: Player.AirPlayButton,
  parameters: {
    docs: {
      description: {
        component: [
          '`Player.AirPlayButton` opens the platform AirPlay route picker.',
          '',
          '**Usage** — compose it under `Player.Root` (a `Player.Viewport` or `Player.Controls` gives it layout context):',
          '```tsx',
          '<Player.Root source={source}>',
          '  <Player.Viewport>',
          '    <Player.AirPlayButton />',
          '  </Player.Viewport>',
          '</Player.Root>',
          '```',
          '',
          '**Contract** — renders `data-playdeck-part="airplay-button"` and `data-provider="<provider>"`. It carries **no `data-state`**: which device the user picked is never exposed, and Playdeck does not currently surface an active-route flag, so there is no state to render. Current behaviour rather than a permanent guarantee — WebKit can report an active wireless route and Playdeck has deferred plumbing it.',
          '',
          '**Not a toggle** — unlike `PipButton` and `FullscreenButton`, this has no `aria-pressed` and one static label. Opening the picker is a request; `aria-pressed` on a non-toggle would have a screen reader announce "not pressed" forever, which is an active lie about state.',
          '',
          '**Accessibility** — a native `<button>`; reachable and operable by keyboard (Tab to focus, Enter/Space to activate).',
          '',
          '**Capability** — gated by `airPlay`; renders nothing until `airPlay` resolves `available`, which in practice means Safari and iOS.'
        ].join('\n')
      }
    }
  },
  render: () => (
    <Player.Viewport style={{ width: 480, height: 270, background: '#0b0e13' }}>
      <Player.AirPlayButton />
    </Player.Viewport>
  )
} satisfies Meta<typeof Player.AirPlayButton>;

export default meta;

type Story = StoryObj<typeof meta>;

/**
 * The only rendered state this button has. It carries no `data-state` and no
 * `aria-pressed`, which the play function asserts: opening the route picker is
 * a request, and there is no "AirPlay is on" for it to reflect.
 */
export const Available: Story = {
  parameters: ready({ airPlay: available }),
  play: async ({ canvas }) => {
    const button = await canvas.findByRole('button', { name: 'AirPlay' });
    await expect(button).toHaveAttribute(
      'data-playdeck-part',
      'airplay-button'
    );
    await expect(button).not.toHaveAttribute('aria-pressed');
  }
};

/** Focus behavior: keyboard reaches the button. */
export const KeyboardFocusable: Story = {
  parameters: ready({ airPlay: available }),
  play: async ({ canvas, userEvent }) => {
    const button = await canvas.findByRole('button', { name: 'AirPlay' });
    await userEvent.tab();
    await expect(button).toHaveFocus();
  }
};

/** Capability absent: the button stays out of the DOM until it resolves. */
export const CapabilityAbsent: Story = {
  parameters: ready({ airPlay: notReady }),
  play: async ({ canvas }) => {
    await expect(canvas.queryByRole('button')).toBeNull();
  }
};

/** The common case off Safari/iOS: the provider reports AirPlay unavailable. */
export const CapabilityUnavailable: Story = {
  parameters: ready({ airPlay: unavailable }),
  play: async ({ canvas }) => {
    await expect(canvas.queryByRole('button')).toBeNull();
  }
};
