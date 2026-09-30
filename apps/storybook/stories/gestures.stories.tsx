import * as Player from '@playdeck/react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect } from 'storybook/test';
import { assetUrl } from './asset-url';
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

/**
 * `e2e/gestures-hit-test.spec.ts`'s fixture. `@playdeck/react/docked.css`,
 * mounted through the toolbar's Theme global, with `Gestures` before
 * `Controls` exactly as this file's own JSDoc instructs, and the bar
 * positioned by the JSDoc's general rule: `position: relative`, which
 * leaves the bar exactly where `docked.css` lays it out — below the
 * picture, never overlaid (`docked.css`'s own header comment). `Viewport`
 * carries only a `width`, no fixed height: `Media` and `Controls` are both
 * plain, unstyled children, so `Viewport` grows to fit both rather than
 * clipping the bar the way a fixed-height box would. Without the
 * positioning rule this full-bleed layer still stretches to cover that
 * whole (taller) box and swallows the bar's clicks even though it sits
 * below the picture — which is what the e2e spec demonstrates by removing
 * it.
 *
 * Real media (`tracer.mp4`), not the mock provider: the point is a real
 * pointer click resolving against real layout, which the mock's synthetic
 * `userEvent` interactions in `WithCustomIcons` above do not exercise the
 * same way a Playwright `click()` does. `real-playback` opts out of
 * `withMockPlayer`; `!test` keeps this off Storybook's own deterministic
 * story-test run, the same pairing every other real-media fixture in this
 * workbench carries (`stories/real-playback.stories.tsx`).
 *
 * Demonstrated red and green: see this commit's message.
 */
export const ClickableUnderDockedTheme: Story = {
  tags: ['real-playback', '!test'],
  globals: { theme: 'docked' },
  render: () => (
    <Player.Root loading="interaction" source={assetUrl('tracer.mp4')}>
      <Player.Viewport style={{ width: 640 }}>
        <style>
          {'[data-playdeck-part="controls"] { position: relative; }'}
        </style>
        <Player.Media />
        <Player.Gestures onToggleControls={() => {}} />
        <Player.ActivationButton aria-label="Load and play" />
        <Player.Controls aria-label="Video player controls">
          <Player.MuteButton />
        </Player.Controls>
      </Player.Viewport>
    </Player.Root>
  )
};
