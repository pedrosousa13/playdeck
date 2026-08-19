import * as Player from '@playdeck/react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect } from 'storybook/test';
import { available, ready } from './support';

const barStyle = {
  display: 'flex',
  gap: '0.5rem',
  alignItems: 'center',
  padding: '0.5rem',
  color: '#e8edf4',
  fontFamily: 'system-ui, sans-serif'
} as const;

const meta = {
  title: 'Player/Controls',
  component: Player.Controls,
  parameters: {
    docs: {
      description: {
        component: [
          '`Player.Controls` is the control-bar container; `data-state` distinguishes a `global` bar from a `scoped` one.',
          '',
          '**Usage** — compose it under `Player.Root` (a `Player.Viewport` gives it layout context), nesting the individual control primitives inside it:',
          '```tsx',
          '<Player.Root source={source}>',
          '  <Player.Viewport>',
          '    <Player.Controls>',
          '      <Player.PlayButton />',
          '      <Player.SeekSlider />',
          '    </Player.Controls>',
          '  </Player.Viewport>',
          '</Player.Root>',
          '```',
          '',
          '**Contract** — renders `data-playdeck-part="controls"`, `data-provider="<provider>"`, and `data-state="global" | "scoped"`.',
          '',
          '**Accessibility** — groups its child controls, and owns the media keyboard shortcuts while focus is inside it (`global` attaches the same map to the document instead): Space and `k` toggle playback, `ArrowLeft`/`ArrowRight` seek 5s back and forward, `j`/`PageDown` seek 10s back and `l`/`PageUp` 10s forward, `ArrowUp`/`ArrowDown` move the volume by 0.05, and `m`, `f` and `c` toggle muted, fullscreen and captions. The region owns those keys on a focused `<input type="range">` too, so the arrow distances are the same on `SeekSlider` and `VolumeSlider` as off them; text entry still swallows every key, and a focused button keeps Space and `Enter`.',
          '',
          '`shortcuts={false}` turns the layer off entirely — in `global` mode no `document` listener is attached at all. An object overrides individual actions (`shortcuts={{ seekBackward: null, seekForward: null }}` hands the arrows back to a focused native control); every action it does not name keeps its default. WCAG 2.1.4 Character Key Shortcuts requires that of `global` mode, whose keys are live wherever focus is on the page; the region-scoped default conforms through the active-on-focus exception instead. The `GlobalShortcuts` reference story is the composition the axe sweep scans in that mode.',
          '',
          '**Capability** — reflects the aggregate of `seek`, `setVolume`, `fullscreen`, and `pictureInPicture`.'
        ].join('\n')
      }
    }
  },
  render: () => (
    <Player.Viewport style={{ width: 640, height: 360, background: '#0b0e13' }}>
      <Player.Controls aria-label="Video player controls" style={barStyle}>
        <Player.PlayButton />
        <Player.MuteButton />
        <Player.VolumeSlider />
        <Player.SeekSlider style={{ flex: 1 }} />
        <Player.Time type="current" />
        <Player.FullscreenButton />
        <Player.PipButton />
      </Player.Controls>
    </Player.Viewport>
  )
} satisfies Meta<typeof Player.Controls>;

export default meta;

type Story = StoryObj<typeof meta>;

const fullyCapable = ready(
  {
    seek: available,
    setVolume: available,
    fullscreen: available,
    pictureInPicture: available
  },
  { currentTime: 42, duration: 180, volume: 0.6, muted: false }
);

/** The assembled control bar with every capability resolved. */
export const AssembledBar: Story = {
  parameters: fullyCapable,
  play: async ({ canvas }) => {
    const region = await canvas.findByRole('group', {
      name: 'Video player controls'
    });
    await expect(region).toHaveAttribute('data-playdeck-part', 'controls');
    await expect(
      canvas.getByRole('button', { name: 'Play' })
    ).toBeInTheDocument();
    await expect(
      canvas.getByRole('slider', { name: 'Seek' })
    ).toBeInTheDocument();
  }
};

/**
 * Focus behavior: the controls region is itself focusable (it is the scope for
 * keyboard shortcuts), so the first Tab lands on the region and the next Tab
 * enters the individual controls, in order.
 */
export const KeyboardTraversal: Story = {
  parameters: fullyCapable,
  play: async ({ canvas, userEvent }) => {
    const region = await canvas.findByRole('group', {
      name: 'Video player controls'
    });
    await userEvent.tab();
    await expect(region).toHaveFocus();
    await userEvent.tab();
    await expect(canvas.getByRole('button', { name: 'Play' })).toHaveFocus();
    await userEvent.tab();
    await expect(canvas.getByRole('button', { name: 'Mute' })).toHaveFocus();
  }
};
