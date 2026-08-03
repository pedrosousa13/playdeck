import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { expect, fn, waitFor } from 'storybook/test';
import {
  useMockPlayer,
  type MockPlayerParameters
} from '../../.storybook/mock-player';
import { withCss } from '../../.storybook/theme';
import { backpackVideoCss } from './backpack-video-css';
import { ready } from '../support';
import { BackpackVideo, type BackpackVideoProps } from './backpack-video';

// Deterministic and offline (apps/storybook/README.md), even though the args
// below are Backpack's own provider URLs: every story here stages a player that
// already reports `activation: 'ready'`, so `Player.ActivationButton` renders
// nothing, nothing commits the source, and `Player.Media` therefore mounts no
// embed. The URL is inert — nothing in this file can reach it, which the
// per-story no-external-request guard confirms. The stories that do attach a
// real provider are in `backpack-video-real.stories.tsx`, tagged `real-playback`
// and `!test` like every other real-media story in this repo.

const vimeoUrl = 'https://vimeo.com/336066147';
const youtubeUrl = 'https://www.youtube.com/watch?v=mhN3E_hlWmU';

const pausedPlayer = ready({}, { playback: 'paused' });
const playingPlayer = ready({}, { playback: 'playing' });

/** Every clickable thing in the story, as `TAG[accessible name]`. */
const affordances = (canvasElement: HTMLElement): string[] =>
  [...canvasElement.querySelectorAll('button, [role="button"]')].map(
    (element) =>
      `${element.tagName}[${element.getAttribute('aria-label') ?? element.textContent?.trim() ?? ''}]`
  );

const playIcon = (canvasElement: HTMLElement): Element | null =>
  canvasElement.querySelector('.ef-video-play-icon');

/**
 * Installs the workbench's mock provider into the wrapper's own `Player.Root`
 * (the wrapper owns it, because `url` is what Reely's source detection reads),
 * so these stories drive player state with no provider, no embed and no
 * network — the same contract `withMockPlayer` gives every other story.
 */
const MockedBackpackVideo = ({
  player,
  ...props
}: BackpackVideoProps & { readonly player: MockPlayerParameters }) => (
  <BackpackVideo {...props} ref={useMockPlayer(player)} />
);

/**
 * The same wrapper with the staged player state under story controls, so a play
 * function can walk it through a not-started → playing → paused sequence. The
 * mock stages state once per parameters object, so a second report needs a
 * second object.
 */
const PlayerReports = ({
  player,
  ...props
}: BackpackVideoProps & { readonly player: MockPlayerParameters }) => {
  const [staged, setStaged] = useState(player);
  return (
    <>
      <BackpackVideo {...props} ref={useMockPlayer(staged)} />
      <button onClick={() => setStaged(playingPlayer.player)} type="button">
        Report playing
      </button>
      <button onClick={() => setStaged(pausedPlayer.player)} type="button">
        Report paused
      </button>
    </>
  );
};

const meta = {
  title: 'Backpack parity/Video',
  component: BackpackVideo,
  decorators: [withCss(backpackVideoCss('480px'))],
  args: { onPlayChange: fn() },
  render: (args, { parameters }) => (
    <MockedBackpackVideo
      {...args}
      player={parameters.player as MockPlayerParameters}
    />
  )
} satisfies Meta<typeof BackpackVideo>;

export default meta;

type Story = StoryObj<typeof meta>;

/**
 * Backpack's `Default` args, verbatim. With `controls` off and the provider
 * attached, the whole player surface is the play/pause toggle and it is the
 * only clickable thing — Backpack's `VideoHiddenControls`.
 */
export const Default: Story = {
  args: { url: vimeoUrl, muted: true },
  parameters: pausedPlayer,
  play: async ({ args, canvas, canvasElement, userEvent }) => {
    await expect(playIcon(canvasElement)).not.toBeNull();
    const paused = await canvas.findByRole('button', { name: 'Play video' });
    await expect(paused.tagName).toBe('BUTTON');
    await expect(paused).toHaveAttribute('aria-pressed', 'false');
    // The toggle has taken over from the activation affordance, and there is
    // no control bar, so it is the only click target on the player.
    await expect(affordances(canvasElement)).toEqual(['BUTTON[Play video]']);

    await userEvent.click(paused);
    const playing = await canvas.findByRole('button', { name: 'Pause video' });
    await expect(playing).toHaveAttribute('aria-pressed', 'true');
    await expect(playIcon(canvasElement)).toBeNull();
    await expect(args.onPlayChange).toHaveBeenLastCalledWith(true);

    await userEvent.click(playing);
    await expect(
      await canvas.findByRole('button', { name: 'Play video' })
    ).toHaveAttribute('aria-pressed', 'false');
    await expect(playIcon(canvasElement)).not.toBeNull();
    await expect(args.onPlayChange).toHaveBeenLastCalledWith(false);
  }
};

/**
 * Before a provider attaches there is nothing to toggle, so Reely's own
 * activation affordance is the click target — it is what loads the provider.
 * Clicking it here would load the real one, which is what
 * `Real playback/BackpackVideo` is for; this story only pins that the
 * affordance is present, is Reely's, and is alone on the surface.
 */
export const AwaitingActivation: Story = {
  args: { url: vimeoUrl, muted: true },
  parameters: { player: {} },
  play: async ({ canvas, canvasElement }) => {
    const activate = await canvas.findByRole('button', { name: 'Play video' });
    await expect(activate).toHaveAttribute('data-reely-part', 'activation');
    await expect(activate).toHaveAttribute('data-state', 'dormant');
    await expect(affordances(canvasElement)).toEqual(['BUTTON[Play video]']);
    // Paused and never started, so the icon sits over the activation target.
    await expect(playIcon(canvasElement)).not.toBeNull();
  }
};

/**
 * `playing` asks for playback on load, but only the player can say it started.
 * Here it never does: the source resolves to nothing, so no provider attaches
 * and nothing ever reports playing. A real page reaches the same state when the
 * browser blocks an audible autoplay — `playing` with `muted` off asks for one.
 * (An unresolvable source is what makes this deterministic; a resolvable one
 * would load a real provider, which this suite forbids.) The label, the icon
 * and `aria-pressed` must report what the player is doing, not what was asked.
 */
export const PlaybackRequestedButNeverStarted: Story = {
  args: { url: 'mock://reely/unresolvable.mp4', muted: false, playing: true },
  parameters: { player: {} },
  play: async ({ canvas, canvasElement }) => {
    const surface = await canvas.findByRole('button', { name: 'Play video' });
    await expect(surface).toHaveAttribute('aria-pressed', 'false');
    await expect(playIcon(canvasElement)).not.toBeNull();
    await expect(affordances(canvasElement)).toEqual(['BUTTON[Play video]']);
  }
};

/**
 * A state change nobody clicked for: the player itself reports playback, the
 * way a provider does when it starts. The label, the overlay and
 * `onPlayChange` all follow the player.
 */
export const ProgrammaticPlayback: Story = {
  args: { url: vimeoUrl, muted: true },
  parameters: playingPlayer,
  play: async ({ args, canvas, canvasElement }) => {
    const surface = await canvas.findByRole('button', { name: 'Pause video' });
    await expect(surface).toHaveAttribute('aria-pressed', 'true');
    await expect(playIcon(canvasElement)).toBeNull();
    await expect(args.onPlayChange).toHaveBeenCalledWith(true);
  }
};

/** Backpack's `YouTube Video` args, verbatim. */
export const YouTubeVideo: Story = {
  name: 'YouTube Video',
  args: { url: youtubeUrl, muted: true },
  parameters: pausedPlayer,
  play: async ({ canvas, canvasElement }) => {
    await expect(
      await canvas.findByRole('button', { name: 'Play video' })
    ).toHaveAttribute('aria-pressed', 'false');
    await expect(affordances(canvasElement)).toEqual(['BUTTON[Play video]']);
  }
};

/**
 * Backpack's `WithControls` args (its `light: false` is out of this slice and
 * is left off rather than half-implemented). Backpack forwards `controls` to
 * react-player, which shows the provider's own chrome; the wrapper shows
 * Reely's `Player.Controls` instead, because Reely renders its controls itself.
 * What matches is that the controls replace the click-to-toggle surface —
 * Backpack's `VideoHiddenControls` returns `null` for exactly this case — and
 * that the play icon stays up until playback has started.
 */
export const WithControls: Story = {
  args: { url: vimeoUrl, muted: true, controls: true },
  parameters: pausedPlayer,
  play: async ({ canvas, canvasElement }) => {
    await canvas.findByRole('button', { name: 'Play' });
    await expect(affordances(canvasElement)).toEqual(['BUTTON[Play]']);
    await expect(playIcon(canvasElement)).not.toBeNull();
  }
};

/**
 * Backpack's `Loop` args. `loop` reaches `Player.Root`, but Reely forwards its
 * native playback options to the HLS and native providers only, so a Vimeo or
 * YouTube source never receives it (SIDEPRO-210). Nothing for a story to
 * observe, so this one holds the args and the render.
 */
export const Loop: Story = {
  args: { url: vimeoUrl, muted: true, controls: true, loop: true },
  parameters: pausedPlayer,
  play: async ({ canvas }) => {
    await canvas.findByRole('button', { name: 'Play' });
  }
};

/**
 * Once playback has started and the controls are shown, the play icon does not
 * come back on pause — the controls are the affordance from then on. This is
 * the `startedPlaying` half of Backpack's overlay condition.
 */
export const PlayIconYieldsToControls: Story = {
  args: { url: vimeoUrl, muted: true, controls: true },
  parameters: pausedPlayer,
  render: (args, { parameters }) => (
    <PlayerReports
      {...args}
      player={parameters.player as MockPlayerParameters}
    />
  ),
  play: async ({ canvas, canvasElement, userEvent }) => {
    await expect(playIcon(canvasElement)).not.toBeNull();

    await userEvent.click(
      await canvas.findByRole('button', { name: 'Report playing' })
    );
    await waitFor(() => expect(playIcon(canvasElement)).toBeNull());

    await userEvent.click(
      await canvas.findByRole('button', { name: 'Report paused' })
    );
    await waitFor(() => expect(playIcon(canvasElement)).toBeNull());
  }
};

/**
 * `showPlayIcon` off with `controls` defaulting off: no overlay and no control
 * bar, so the invisible toggle is the only thing on the surface.
 */
export const WithoutPlayIcon: Story = {
  args: { url: vimeoUrl, muted: true, showPlayIcon: false },
  parameters: pausedPlayer,
  play: async ({ canvas, canvasElement }) => {
    await canvas.findByRole('button', { name: 'Play video' });
    await expect(playIcon(canvasElement)).toBeNull();
    await expect(affordances(canvasElement)).toEqual(['BUTTON[Play video]']);
  }
};

/**
 * `className` is added to the component's own class, not swapped for it.
 * `controls` defaults off here too, so the overlay is expected and a control
 * bar is not.
 */
export const WithClassName: Story = {
  args: { url: vimeoUrl, muted: true, className: 'story-video' },
  parameters: pausedPlayer,
  play: async ({ canvasElement }) => {
    const player = canvasElement.querySelector('.ef-video-player');
    await expect(player).toHaveClass('story-video');
    await expect(playIcon(canvasElement)).not.toBeNull();
    await expect(affordances(canvasElement)).toEqual(['BUTTON[Play video]']);
  }
};
