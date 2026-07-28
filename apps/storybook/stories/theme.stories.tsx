import type { CSSProperties, ReactElement } from 'react';
import * as Player from '@reely/react';
// Read as text, not injected. A plain `import '@reely/react/theme.css'`
// attaches it to the whole Storybook preview -- every story renders in the same
// document, and the rest assert unthemed computed styles -- so the theme is
// mounted per story below and torn down with it.
//
// Imported by path rather than as `@reely/react/theme.css?inline`, because Vite
// cannot carry a query through the package exports map. The published entry is
// covered where it belongs: packages/react/test/theme.test.ts asserts the
// exports and files entries, and publint/attw check the tarball.
import themeCss from '../../../packages/react/theme.css?inline';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect } from 'storybook/test';
import { available, ready } from './support';

const withTheme = (Story: () => ReactElement) => (
  <>
    <style>{themeCss}</style>
    <Story />
  </>
);

const viewportStyle = {
  position: 'relative' as const,
  aspectRatio: '16 / 9',
  // Wide enough for the full control row at the largest size these stories
  // demonstrate (`--reely-control-size: 3.5rem` in AccentAndSizeTokens). The
  // buttons are `flex: 0 0 auto` so they push out of the box rather than
  // shrink, and at 480 the row overflowed by 49px once AirPlayButton made it
  // six buttons.
  width: 640
};

// Icon children, supplied here as a consumer supplies them -- the theme sizes
// every button-shaped control to `--reely-control-size` and its `svg` to
// `--reely-control-icon-size`, so the default text labels ("Enter
// fullscreen", "Enter picture-in-picture", ...) wrap and spill out of a 44px
// box. Which icon shows follows player state, the same swap the reference
// example makes: every story is already inside the mock `Player.Root`, so the
// state costs one selector and nothing else.
const ThemedPlayer = () => {
  const state = Player.usePlayerState((snapshot) => ({
    playing: snapshot.playback === 'playing',
    muted: snapshot.muted,
    pictureInPicture: snapshot.pictureInPicture,
    fullscreen: snapshot.fullscreen
  }));

  return (
    <Player.Viewport style={viewportStyle}>
      <Player.Controls
        style={{ position: 'absolute', inset: 'auto 0 0 0' }}
        aria-label="Video player controls"
      >
        <Player.PlayButton>
          {state.playing ? <Player.PauseIcon /> : <Player.PlayIcon />}
        </Player.PlayButton>
        <Player.Time />
        <Player.SeekSlider />
        <Player.MuteButton>
          {state.muted ? <Player.MutedIcon /> : <Player.VolumeHighIcon />}
        </Player.MuteButton>
        <Player.VolumeSlider />
        {/* No children: CaptionsButton's own default is already an icon. */}
        <Player.CaptionsButton />
        <Player.PipButton>
          {state.pictureInPicture ? (
            <Player.PipExitIcon />
          ) : (
            <Player.PipEnterIcon />
          )}
        </Player.PipButton>
        <Player.AirPlayButton>
          <Player.AirPlayIcon />
        </Player.AirPlayButton>
        <Player.FullscreenButton>
          {state.fullscreen ? (
            <Player.FullscreenExitIcon />
          ) : (
            <Player.FullscreenEnterIcon />
          )}
        </Player.FullscreenButton>
      </Player.Controls>
    </Player.Viewport>
  );
};

const fullyCapable = ready({
  seek: available,
  setVolume: available,
  selectTextTrack: available,
  pictureInPicture: available,
  airPlay: available,
  fullscreen: available
});

const meta = {
  title: 'Theme/Theme',
  component: ThemedPlayer,
  decorators: [withTheme],
  parameters: {
    ...fullyCapable,
    docs: {
      description: {
        component: [
          'The optional `@reely/react/theme.css`. Everything lives in an',
          '`@layer reely` cascade layer with `:where()` selectors, so unlayered',
          'consumer CSS wins without `!important` and a single class of your own',
          'outranks any theme rule. Tokens are set on the viewport part, so',
          'dropping a player into a page leaks no names into the document.'
        ].join(' ')
      }
    }
  }
} satisfies Meta<typeof ThemedPlayer>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {
  play: async ({ canvas }) => {
    const play = await canvas.findByRole('button', { name: 'Play' });
    const styles = globalThis.getComputedStyle(play);
    // The theme reached the control: a 44px box is the locked minimum target,
    // and the theme's control size has to agree with it rather than shrink it.
    await expect(styles.width).toBe('44px');
    await expect(styles.height).toBe('44px');
    await expect(styles.cursor).toBe('pointer');

    // The row is a single non-wrapping flex line of `flex: 0 0 auto` boxes, so
    // a control whose content is wider than its box pushes the row past its
    // own width. Icon children fit the box; the primitives' default text
    // labels do not.
    const controls = await canvas.findByRole('group', {
      name: 'Video player controls'
    });
    await expect(controls.scrollWidth).toBeLessThanOrEqual(
      controls.clientWidth
    );
  }
};

// The override contract, which is the whole reason for the layer and :where().
// If this ever fails, consumers are back to specificity fights.
export const ConsumerCssWins: Story = {
  decorators: [
    (Story: () => ReactElement) => (
      <>
        {/* Unlayered, single class, declared BEFORE the theme in document
            order -- so if this wins it is the cascade layer doing the work,
            not source order. */}
        <style>{`.consumer-tint { background-color: rgb(1, 2, 3); }`}</style>
        <Story />
      </>
    ),
    withTheme
  ],
  render: () => (
    <Player.Viewport style={viewportStyle}>
      <Player.Controls
        className="consumer-tint"
        style={{ position: 'absolute', inset: 'auto 0 0 0' }}
        aria-label="Video player controls"
      >
        <Player.PlayButton>
          <Player.PlayIcon />
        </Player.PlayButton>
      </Player.Controls>
    </Player.Viewport>
  ),
  play: async ({ canvas }) => {
    const controls = await canvas.findByRole('group', {
      name: 'Video player controls'
    });
    // One unlayered class beats the theme's own rule for the same property.
    await expect(globalThis.getComputedStyle(controls).backgroundColor).toBe(
      'rgb(1, 2, 3)'
    );
  }
};

// Per-story custom-property overrides, so themed variants are reviewable side
// by side without touching the stylesheet.
export const AccentAndSizeTokens: Story = {
  render: () => (
    <div
      style={
        {
          '--reely-control-size': '3.5rem',
          '--reely-color-accent': 'rgb(255, 0, 128)'
        } as CSSProperties
      }
    >
      <ThemedPlayer />
    </div>
  ),
  play: async ({ canvas }) => {
    const play = await canvas.findByRole('button', { name: 'Play' });
    // Tokens cascade in from an ancestor, no stylesheet edit required.
    await expect(globalThis.getComputedStyle(play).width).toBe('56px');

    // And the row still fits at the largest size these stories demonstrate.
    const controls = await canvas.findByRole('group', {
      name: 'Video player controls'
    });
    await expect(controls.scrollWidth).toBeLessThanOrEqual(
      controls.clientWidth
    );
  }
};

// The 44px minimum touch target is locked, and the primitives enforce it with
// an inline `min-width`/`min-height` that no stylesheet can undercut. A theme
// asking for smaller controls is therefore clamped rather than obeyed — the
// accessibility floor is not themeable away, on purpose.
export const ControlSizeFloorHolds: Story = {
  render: () => (
    <div
      style={
        {
          '--reely-control-size': '2.25rem',
          '--reely-color-surface': 'rgb(20, 20, 30)',
          '--reely-radius': '0px'
        } as CSSProperties
      }
    >
      <ThemedPlayer />
    </div>
  ),
  play: async ({ canvas }) => {
    const play = await canvas.findByRole('button', { name: 'Play' });
    const styles = globalThis.getComputedStyle(play);
    // Clamped up to the locked minimum, not shrunk to 36px.
    await expect(styles.width).toBe('44px');
    await expect(styles.height).toBe('44px');
    // Tokens that do not fight a locked guarantee still apply.
    await expect(styles.borderRadius).toBe('0px');
  }
};
