import {
  createInitialPlayerState,
  type Availability,
  type ProviderStatePatch
} from '@playdeck/core';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect } from 'storybook/test';
import {
  CoursePlatformPlayer,
  CoursePlatformSurface
} from '../../../examples/archetype-course-platform';
import { assetUrl } from './asset-url';

/*
 * The workbench half of the course-platform archetype, mounting
 * `examples/archetype-course-platform.tsx` itself — the site mounts the same
 * file and there is no second copy.
 *
 * The story split is the mock decorator's: a story that dials capabilities in
 * has to mount the archetype's surface and let the decorator supply the root,
 * while `RealRecording` mounts the whole archetype and is tagged
 * `real-playback` so the decorator steps aside.
 */

const available: Availability = { status: 'available' };

/*
 * A learner mid-lesson. Spread from the real core contract so a capability
 * added to core surfaces here rather than going silently missing.
 *
 * `setPlaybackRate` and `seek` are the two this archetype is built on: the
 * first draws the speed row, the second turns the outline into buttons. Both
 * are deliberately withdrawn by the stories below.
 *
 * The duration matches the recording the archetype is pointed at, so the staged
 * playhead falls where it would against the real thing and the outline's marks
 * are all reachable. A round number instead would put sections past the end and
 * the assertions below would be checking a lesson nobody can play.
 */
const studying: ProviderStatePatch = {
  lifecycle: 'ready',
  activation: 'ready',
  provider: 'native',
  duration: 33,
  currentTime: 16,
  volume: 0.8,
  playbackRate: 1,
  capabilities: {
    ...createInitialPlayerState().capabilities,
    seek: available,
    setVolume: available,
    setPlaybackRate: available,
    selectTextTrack: available,
    fullscreen: available
  },
  captionRendering: 'custom',
  textTracks: [
    {
      id: 'en',
      label: 'English',
      language: 'en',
      kind: 'captions',
      readiness: 'loaded'
    }
  ],
  selectedTextTrackId: 'en'
};

const meta = {
  title: 'Archetypes/Course platform',
  component: CoursePlatformSurface,
  args: { captionsSrc: assetUrl('archetype-captions.vtt') },
  parameters: {
    player: { state: studying },
    docs: {
      description: {
        component:
          'The study archetype from `examples/archetype-course-platform.tsx`, mounted from that file rather than rebuilt here. Deliberately unlike the streaming layout: the picture shares the page with the lesson, the transport is docked rather than overlaid, speed is a first-class control and navigation is by outline.'
      }
    }
  }
} satisfies Meta<typeof CoursePlatformSurface>;

export default meta;

type Story = StoryObj<typeof meta>;

/** The lesson as a learner meets it. */
export const Composition: Story = {
  play: async ({ canvas }) => {
    for (const name of [
      'Play',
      'Mute',
      'Disable captions',
      'Enter fullscreen'
    ]) {
      await expect(canvas.getByRole('button', { name })).toBeInTheDocument();
    }
    await expect(
      canvas.getByRole('slider', { name: 'Seek' })
    ).toBeInTheDocument();
  }
};

/**
 * The pair's one requirement, asserted from the study side: a reader can say
 * what each archetype is for without being told. Three things this one has that
 * the viewing layout does not, and one it deliberately lacks.
 */
export const StudyingRatherThanViewing: Story = {
  play: async ({ canvas }) => {
    // Speed is out in the open, not behind a trigger, and there is no trigger.
    const speed = canvas.getByRole('group', { name: 'Playback speed' });
    await expect(speed).toBeInTheDocument();
    await expect(canvas.queryByRole('button', { name: 'Settings' })).toBeNull();

    // The checked rung follows `PlayerState.playbackRate`, which the staged
    // patch sets to 1 — never a local copy this component kept.
    await expect(canvas.getByRole('button', { name: '1×' })).toHaveAttribute(
      'aria-pressed',
      'true'
    );

    // Navigation is an outline of real buttons, and the section holding the
    // staged `currentTime` is the current one.
    const outline = canvas.getByRole('navigation', { name: 'Lesson outline' });
    await expect(outline).toBeInTheDocument();
    await expect(
      canvas.getByRole('button', { name: '3 Part two 0:14' })
    ).toHaveAttribute('aria-current', 'true');

    // The video is not the only thing on screen.
    await expect(
      canvas.getByRole('heading', { name: 'Notes' })
    ).toBeInTheDocument();
  }
};

/**
 * Speed refused. The row is not drawn — not drawn and disabled — and the rest
 * of the lesson is untouched.
 */
export const SpeedRefused: Story = {
  parameters: {
    player: {
      state: {
        ...studying,
        capabilities: {
          ...createInitialPlayerState().capabilities,
          seek: available,
          setVolume: available,
          selectTextTrack: available,
          fullscreen: available
        }
      } satisfies ProviderStatePatch
    }
  },
  play: async ({ canvas }) => {
    await expect(
      canvas.queryByRole('group', { name: 'Playback speed' })
    ).toBeNull();
    await expect(
      canvas.getByRole('navigation', { name: 'Lesson outline' })
    ).toBeInTheDocument();
  }
};

/**
 * Seeking refused, which is the case worth composing for: the outline still
 * reads, because a learner needs the structure whether or not they can jump
 * into it, and it stops being buttons because nothing may offer an action the
 * player will not take. `Player.SeekSlider` gates itself on the same
 * capability and goes with it.
 */
export const SeekRefused: Story = {
  parameters: {
    player: {
      state: {
        ...studying,
        capabilities: {
          ...createInitialPlayerState().capabilities,
          setVolume: available,
          setPlaybackRate: available,
          selectTextTrack: available,
          fullscreen: available
        }
      } satisfies ProviderStatePatch
    }
  },
  play: async ({ canvas }) => {
    await expect(canvas.queryByRole('slider', { name: 'Seek' })).toBeNull();
    await expect(
      canvas.queryByRole('button', { name: '3 Part two 0:14' })
    ).toBeNull();
    // The structure survives the withdrawal; only the action goes.
    await expect(canvas.getByText('Part two')).toBeInTheDocument();
  }
};

/**
 * The whole archetype against its real recording, with a resume position
 * staged so the banner above the picture is on screen.
 *
 * `real-playback` makes the mock decorator step aside; `!test` keeps a
 * third-party fetch out of the deterministic story run. Nothing is fetched
 * until the learner presses Resume or the picture itself.
 */
export const RealRecording: StoryObj = {
  tags: ['real-playback', '!test'],
  render: () => (
    <CoursePlatformPlayer
      captionsSrc={assetUrl('archetype-captions.vtt')}
      resumeAt={14}
    />
  )
};
