import {
  createInitialPlayerState,
  type Availability,
  type ProviderStatePatch,
  type TextTrack
} from '@reely/core';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect } from 'storybook/test';
import { ReferencePlayer } from './reference-player';

const available: Availability = { status: 'available' };

const englishTrack: TextTrack = {
  id: 'en',
  label: 'English',
  language: 'en',
  kind: 'captions',
  readiness: 'loaded'
};

// `stories/support.ts`'s `ready()` lives outside this directory, so the same
// shape is rebuilt from the core contract here. The property that matters is
// preserved: the capability base is spread from
// `createInitialPlayerState().capabilities`, so a new core capability shows up
// automatically instead of silently missing.
const stagedState: ProviderStatePatch = {
  lifecycle: 'ready',
  activation: 'ready',
  provider: 'native',
  duration: 120,
  currentTime: 12,
  volume: 0.8,
  playbackRate: 1,
  capabilities: {
    // Spread from the real core contract, exactly as `stories/support.ts`'s
    // `ready()` does, so a new core capability surfaces here automatically
    // instead of silently missing.
    ...createInitialPlayerState().capabilities,
    seek: available,
    setVolume: available,
    setPlaybackRate: available,
    selectQuality: available,
    selectTextTrack: available,
    fullscreen: available,
    pictureInPicture: available,
    airPlay: available
  },
  captionRendering: 'custom',
  textTracks: [englishTrack],
  selectedTextTrackId: englishTrack.id,
  qualities: [
    { id: 'hls:1080x1920@6000000', height: 1080, width: 1920, bitrate: 6e6 },
    { id: 'hls:720x1280@3000000', height: 720, width: 1280, bitrate: 3e6 },
    { id: 'hls:360x640@800000', height: 360, width: 640, bitrate: 8e5 }
  ],
  selectedQualityId: null,
  quality: {
    id: 'hls:720x1280@3000000',
    height: 720,
    width: 1280,
    bitrate: 3e6
  }
};

const meta = {
  title: 'Reference/Player',
  component: ReferencePlayer,
  parameters: {
    player: {
      state: stagedState,
      cues: [{ id: '1', startTime: 0, endTime: 30, text: 'Reference caption' }]
    },
    docs: {
      description: {
        component:
          'One composed player, assembled only from public `@reely/react` exports — the runnable proof behind criterion 8 of #1. See the Reference docs page for what it does and does not prove.'
      }
    }
  }
} satisfies Meta<typeof ReferencePlayer>;

export default meta;

type Story = StoryObj<typeof meta>;

/**
 * Under the mock decorator, so every capability is dialed available and the
 * whole control surface renders with no media and no network. `Player.Media`
 * renders nothing here on purpose: making it mount requires activating, and
 * activation loads a real provider that replaces the mock. Story `RealSources`
 * plus `e2e/reference.spec.ts` are what prove the media layer.
 */
export const Composition: Story = {
  play: async ({ canvas }) => {
    // Every control the example composes, located by accessible name — the
    // names come from the primitives' aria-label, never from the icon child.
    for (const name of [
      'Play',
      'Mute',
      'Volume',
      'Seek',
      // 'Disable captions', not 'Enable': the staged state selects the English
      // track, so the toggle is already on.
      'Disable captions',
      'Captions',
      'Settings',
      'Enter picture-in-picture',
      'AirPlay',
      'Enter fullscreen'
    ]) {
      await expect(
        canvas.getByRole(
          name === 'Volume' || name === 'Seek' ? 'slider' : 'button',
          {
            name
          }
        )
      ).toBeInTheDocument();
    }

    // Icons, not text fallbacks: every button's only child is an <svg>.
    for (const name of ['Play', 'Mute', 'Enter fullscreen', 'AirPlay']) {
      const button = canvas.getByRole('button', { name });
      await expect(button.querySelector('svg')).not.toBeNull();
      await expect(button.textContent).toBe('');
    }

    // The two rows, and the parts contract consumers style against.
    const controls = canvas.getByRole('group', {
      name: 'Video player controls'
    });
    await expect(controls.querySelectorAll('.reely-example-row')).toHaveLength(
      2
    );
  }
};
