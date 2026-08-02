import * as Player from '@reely/react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect } from 'storybook/test';
import { available, notReady, ready } from './support';

const meta = {
  title: 'Player/PipButton',
  component: Player.PipButton,
  parameters: {
    docs: {
      description: {
        component: [
          '`Player.PipButton` toggles picture-in-picture.',
          '',
          '**Usage** — compose it under `Player.Root` (a `Player.Viewport` or `Player.Controls` gives it layout context):',
          '```tsx',
          '<Player.Root source={source}>',
          '  <Player.Viewport>',
          '    <Player.PipButton />',
          '  </Player.Viewport>',
          '</Player.Root>',
          '```',
          '',
          '**Contract** — renders `data-reely-part="pip-button"`, `data-provider="<provider>"`, and `data-state="active" | "inline"`.',
          '',
          '**Accessibility** — a native `<button>`; reachable and operable by keyboard (Tab to focus, Enter/Space to toggle).',
          '',
          '**Capability** — gated by `pictureInPicture`; renders nothing until `pictureInPicture` resolves `available`.'
        ].join('\n')
      }
    }
  },
  render: () => (
    <Player.Viewport style={{ width: 480, height: 270, background: '#0b0e13' }}>
      <Player.PipButton />
    </Player.Viewport>
  )
} satisfies Meta<typeof Player.PipButton>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Inline: Story = {
  parameters: ready(
    { pictureInPicture: available },
    { pictureInPicture: false }
  ),
  play: async ({ canvas }) => {
    const button = await canvas.findByRole('button', {
      name: 'Enter picture-in-picture'
    });
    await expect(button).toHaveAttribute('data-state', 'inline');
  }
};

export const Active: Story = {
  parameters: ready(
    { pictureInPicture: available },
    { pictureInPicture: true }
  ),
  play: async ({ canvas }) => {
    const button = await canvas.findByRole('button', {
      name: 'Exit picture-in-picture'
    });
    await expect(button).toHaveAttribute('aria-pressed', 'true');
  }
};

/** Capability absent: the button stays out of the DOM until it resolves. */
export const CapabilityAbsent: Story = {
  parameters: ready({ pictureInPicture: notReady }),
  play: async ({ canvas }) => {
    await expect(canvas.queryByRole('button')).toBeNull();
  }
};
