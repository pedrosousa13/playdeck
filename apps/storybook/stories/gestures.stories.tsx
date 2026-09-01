import * as Player from '@playdeck/react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect } from 'storybook/test';
import { available, ready } from './support';

const meta = {
  title: 'Player/Gestures',
  component: Player.Gestures,
  parameters: {
    docs: {
      description: {
        component: [
          '`Player.Gestures` is a headless viewport layer. A single tap fires `onToggleControls` (it never toggles playback); a double-tap seeks ±`seekOffset` seconds — left half back, right half forward — and can be disabled with `doubleTapSeek={false}`.',
          '',
          '**Custom icons** — every control accepts a built-in icon (or your own) as `children`; the built-ins are inline SVG using `currentColor` and are individually tree-shakeable:',
          '```tsx',
          '<Player.PlayButton><Player.PlayIcon /></Player.PlayButton>',
          '<Player.FullscreenButton><Player.FullscreenEnterIcon /></Player.FullscreenButton>',
          '```'
        ].join('\n')
      }
    }
  },
  render: () => (
    <Player.Viewport
      style={{
        width: 640,
        height: 360,
        background: '#0b0e13',
        position: 'relative'
      }}
    >
      <Player.Gestures onToggleControls={() => {}} />
      <Player.Controls
        aria-label="Video player controls"
        style={{
          position: 'absolute',
          bottom: 0,
          left: 0,
          right: 0,
          display: 'flex',
          gap: '0.5rem',
          padding: '0.5rem',
          color: '#e8edf4'
        }}
      >
        <Player.PlayButton>
          <Player.PlayIcon />
        </Player.PlayButton>
        <Player.MuteButton>
          <Player.VolumeHighIcon />
        </Player.MuteButton>
        <Player.FullscreenButton>
          <Player.FullscreenEnterIcon />
        </Player.FullscreenButton>
      </Player.Controls>
    </Player.Viewport>
  )
} satisfies Meta<typeof Player.Gestures>;

export default meta;

type Story = StoryObj<typeof meta>;

/**
 * A `Player.Gestures` layer under a control row whose buttons carry icon
 * children instead of their default text labels. The pairing is the point: the
 * gesture layer is invisible and covers the viewport, so the thing worth
 * showing is that the controls above it still work and still keep their
 * accessible names — the play function finds the play button by its label
 * `Play` while its only content is an `<svg>`.
 */
export const WithCustomIcons: Story = {
  parameters: ready({
    seek: available,
    setVolume: available,
    fullscreen: available,
    pictureInPicture: available
  }),
  play: async ({ canvas, userEvent }) => {
    // The play button renders an inline svg (custom icon) yet keeps its label.
    const play = await canvas.findByRole('button', { name: 'Play' });
    await expect(play.querySelector('svg')).not.toBeNull();
    await userEvent.click(play);
  }
};
