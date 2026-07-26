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

/** The settings menu is two radio groups, each gated on its own capability. */
export const SettingsMenuSelection: Story = {
  play: async ({ canvas, userEvent }) => {
    const trigger = canvas.getByRole('button', { name: 'Settings' });
    await userEvent.click(trigger);

    const menu = await canvas.findByRole('menu');
    await expect(menu).toHaveAttribute('data-reely-menu', 'open');
    // Named groups rather than text headings: role="menu" only admits
    // menuitem/menuitemradio/group children.
    await expect(
      canvas.getByRole('group', { name: 'Playback speed' })
    ).toBeInTheDocument();
    await expect(
      canvas.getByRole('group', { name: 'Quality' })
    ).toBeInTheDocument();

    // Auto plus the three staged rungs, labelled by height.
    await expect(
      canvas.getByRole('menuitemradio', { name: '1080p' })
    ).toBeInTheDocument();
    await expect(
      canvas.getByRole('menuitemradio', { name: 'Auto (720p)' })
    ).toBeInTheDocument();

    // 1x is checked because the group reads state.playbackRate, not local state.
    await expect(
      canvas.getByRole('menuitemradio', { name: '1×' })
    ).toHaveAttribute('aria-checked', 'true');

    await userEvent.click(canvas.getByRole('menuitemradio', { name: '1.5×' }));
    // Selecting closes and returns focus to the trigger (never <body>).
    await expect(canvas.queryByRole('menu')).toBeNull();
    await expect(trigger).toHaveFocus();
  }
};

/**
 * The rate the menu shows follows player state, so a menu driven by a provider
 * that rejected the command cannot show a selection that never took effect.
 * The mock adapter's setPlaybackRate resolves ok but emits nothing, so 1x stays
 * checked — asserted deliberately, so nobody "fixes" this into local state.
 */
export const SettingsMenuFollowsState: Story = {
  play: async ({ canvas, userEvent }) => {
    const trigger = canvas.getByRole('button', { name: 'Settings' });
    await userEvent.click(trigger);
    await userEvent.click(canvas.getByRole('menuitemradio', { name: '2×' }));
    await userEvent.click(trigger);
    await expect(
      canvas.getByRole('menuitemradio', { name: '1×' })
    ).toHaveAttribute('aria-checked', 'true');
    // Close before the story ends: `.reely-example-menu` is a scrollable,
    // arrow-key-only region (every item is `tabIndex={-1}`), so an open menu
    // trips axe's scrollable-region-focusable rule. Left open only by this
    // reopen-to-inspect step, not by anything a real user flow leaves behind.
    await userEvent.keyboard('{Escape}');
    await expect(canvas.queryByRole('menu')).toBeNull();
  }
};

/**
 * The captions toggle follows player state, not a local click flag: the mock
 * adapter has no `selectTextTrack`, so `controller.selectTextTrack` resolves
 * `{ ok: false, reason: 'unsupported' }`, nothing is emitted, and the button
 * stays reflecting `selectedTextTrackId` — observed by running this story,
 * not assumed.
 */
export const CaptionsToggle: Story = {
  play: async ({ canvas, userEvent }) => {
    const button = canvas.getByRole('button', { name: 'Disable captions' });
    await expect(button).toHaveAttribute('data-state', 'on');
    await userEvent.click(button);
    await expect(
      canvas.getByRole('button', { name: 'Disable captions' })
    ).toHaveAttribute('data-state', 'on');
  }
};

/**
 * Keyboard flow #32 will extend: every control in the row is reachable by Tab
 * in visual order, and the menu takes focus on open and gives it back.
 */
export const KeyboardFlow: Story = {
  play: async ({ canvas, userEvent }) => {
    canvas.getByRole('button', { name: 'Play' }).focus();
    await expect(canvas.getByRole('button', { name: 'Play' })).toHaveFocus();

    await userEvent.tab();
    await expect(canvas.getByRole('button', { name: 'Mute' })).toHaveFocus();
    await userEvent.tab();
    await expect(canvas.getByRole('slider', { name: 'Volume' })).toHaveFocus();
    await userEvent.tab();
    await expect(
      canvas.getByRole('button', { name: 'Disable captions' })
    ).toHaveFocus();

    // Arrow-opening the settings menu lands on its first item, and Escape
    // returns focus to the trigger.
    const trigger = canvas.getByRole('button', { name: 'Settings' });
    trigger.focus();
    await userEvent.keyboard('{ArrowDown}');
    await expect(
      canvas.getByRole('menuitemradio', { name: '0.5×' })
    ).toHaveFocus();
    await userEvent.keyboard('{Escape}');
    await expect(trigger).toHaveFocus();
  }
};
