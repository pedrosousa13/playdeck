import {
  createInitialPlayerState,
  type Availability,
  type ProviderStatePatch
} from '@playdeck/core';
import * as Player from '@playdeck/react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect } from 'storybook/test';
import {
  StreamingServicePlayer,
  StreamingServiceSurface,
  type StreamingServicePlayerProps
} from '../../../examples/archetype-streaming-service';
import { assetUrl } from './asset-url';

/*
 * The workbench half of the streaming-service archetype. The site mounts the
 * same file — there is no second copy of this composition anywhere, and the
 * import above reaches into `examples/` rather than into a story-local rebuild
 * of it.
 *
 * Two shapes of story, and the split is forced by the mock decorator. It wraps
 * a story in its own `Player.Root` so capabilities can be dialed in with no
 * media and no network, which means a story that wants that has to mount the
 * archetype's SURFACE and let the decorator supply the root. `RealClip` mounts
 * the whole archetype instead — its own root, its own clip — and is tagged
 * `real-playback` so the decorator hands it back undecorated, and `!test` so
 * the deterministic story run never reaches for the network.
 */

const available: Availability = { status: 'available' };

/*
 * A player mid-title: activated, seekable, with the capabilities this
 * archetype's chrome is built around dialed on. Spread from the real core
 * contract, exactly as `stories/support.tsx` does, so a capability added to core
 * shows up here rather than going silently missing.
 *
 * `selectQuality` is available and a ladder is staged, which is the one thing
 * the real clip cannot show: the native provider cannot switch renditions of a
 * progressive MP4, so against the Blender file the settings menu is correctly
 * absent altogether. Staging it here is how that menu is seen at all.
 *
 * `setPlaybackRate` is deliberately NOT staged. The archetype offers no rate
 * control — that is the course layout's — so dialing the capability on would
 * assert nothing, and a reader comparing the two patches should be able to see
 * the difference in the fixture rather than only in the assertions.
 */
const watching: ProviderStatePatch = {
  lifecycle: 'ready',
  activation: 'ready',
  provider: 'native',
  duration: 52,
  currentTime: 20,
  volume: 0.8,
  playbackRate: 1,
  capabilities: {
    ...createInitialPlayerState().capabilities,
    seek: available,
    setVolume: available,
    selectQuality: available,
    selectTextTrack: available,
    fullscreen: available,
    pictureInPicture: available,
    airPlay: available
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
  selectedTextTrackId: 'en',
  qualities: [
    { id: 'q1080', height: 1080, width: 1920, bitrate: 6e6 },
    { id: 'q720', height: 720, width: 1280, bitrate: 3e6 },
    { id: 'q360', height: 360, width: 640, bitrate: 8e5 }
  ],
  selectedQualityId: null,
  quality: { id: 'q720', height: 720, width: 1280, bitrate: 3e6 }
};

const meta = {
  title: 'Archetypes/Streaming service',
  component: StreamingServiceSurface,
  args: { captionsSrc: assetUrl('archetype-captions.vtt') },
  parameters: {
    player: { state: watching },
    docs: {
      description: {
        component:
          'The long-form viewing archetype from `examples/archetype-streaming-service.tsx`, mounted from that file rather than rebuilt here. Named for the job it does; no company appears in it.'
      }
    }
  }
} satisfies Meta<typeof StreamingServiceSurface>;

export default meta;

type Story = StoryObj<typeof meta>;

/**
 * The bar as a viewer meets it: transport, captions with the effective
 * rendering mode printed beside the toggle, and the display controls the
 * staged capabilities admit.
 */
export const Composition: Story = {
  play: async ({ canvas }) => {
    for (const name of [
      'Play',
      'Mute',
      'Disable captions',
      'Settings',
      'Enter picture-in-picture',
      'AirPlay',
      'Enter fullscreen'
    ]) {
      await expect(canvas.getByRole('button', { name })).toBeInTheDocument();
    }
    await expect(
      canvas.getByRole('slider', { name: 'Seek' })
    ).toBeInTheDocument();
    await expect(
      canvas.getByRole('slider', { name: 'Volume' })
    ).toBeInTheDocument();

    // The effective caption mode, read from state rather than assumed by the
    // layout: the staged patch says `custom`, so that is the word on screen.
    await expect(canvas.getByText('custom')).toBeInTheDocument();
  }
};

/**
 * The two archetypes have to be tellable apart by shape, and this asserts that
 * from the viewing side. What this layout does NOT have is the study layout's
 * outline, its notes and its speed row — rate is not offered here at all, and
 * chapters are ticks on the scrubber rather than a way to get around. What it
 * has instead is a settings menu holding the choice a viewer does make.
 */
export const ViewingRatherThanStudying: Story = {
  play: async ({ canvas, userEvent }) => {
    await expect(
      canvas.queryByRole('navigation', { name: 'Lesson outline' })
    ).toBeNull();
    // No speed control, before or after the menu is opened.
    await expect(
      canvas.queryByRole('group', { name: 'Playback speed' })
    ).toBeNull();

    await userEvent.click(canvas.getByRole('button', { name: 'Settings' }));
    await expect(
      canvas.getByRole('group', { name: 'Quality' })
    ).toBeInTheDocument();
    await expect(
      canvas.queryByRole('group', { name: 'Playback speed' })
    ).toBeNull();
    // The ladder is the provider's, labelled by height, with auto naming the
    // level actually playing.
    await expect(
      canvas.getByRole('menuitemradio', { name: 'Auto (720p)' })
    ).toBeInTheDocument();
  }
};

/**
 * The archetype's central rule, seen from the losing side. With no ladder on
 * offer the settings trigger is not drawn at all — the menu is absent rather
 * than present and empty — and the display controls whose capabilities were
 * withdrawn go with it.
 */
export const CapabilitiesWithdrawn: Story = {
  parameters: {
    player: {
      state: {
        ...watching,
        capabilities: {
          ...createInitialPlayerState().capabilities,
          seek: available,
          setVolume: available,
          selectTextTrack: available
        }
      } satisfies ProviderStatePatch
    }
  },
  play: async ({ canvas }) => {
    for (const name of [
      'Settings',
      'Enter picture-in-picture',
      'AirPlay',
      'Enter fullscreen'
    ]) {
      await expect(canvas.queryByRole('button', { name })).toBeNull();
    }
    // The commands that survived are still operable, so the withdrawal is a
    // gate on capabilities and not a bar that failed to render.
    await expect(
      canvas.getByRole('button', { name: 'Play' })
    ).toBeInTheDocument();
    await expect(
      canvas.getByRole('slider', { name: 'Seek' })
    ).toBeInTheDocument();
  }
};

/**
 * The whole archetype against its real clip, with a resume position staged.
 *
 * `real-playback` is what makes the mock decorator step aside so the file's own
 * `Player.Root` is the only one in the tree; `!test` keeps it out of the
 * deterministic story run, because the clip is fetched from a third party.
 * Nothing is fetched until one of the two affordances on the title card is
 * pressed — `loading="interaction"` is the archetype's own, not a story knob.
 */
export const RealClip: StoryObj = {
  tags: ['real-playback', '!test'],
  render: () => (
    <StreamingServicePlayer
      captionsSrc={assetUrl('archetype-captions.vtt')}
      resumeAt={18}
    />
  )
};

/*
 * The local clip this file resumes against, in place of the trailer `RealClip`
 * fetches from Blender's own host. `tracer-10s.mp4` is served by this
 * workbench itself, so mounting it makes no third-party request — which is
 * what keeps this story out of `!test` below.
 */
const localMedia = {
  source: {
    type: 'video',
    sources: [{ src: assetUrl('tracer-10s.mp4'), mimeType: 'video/mp4' }]
  },
  kicker: 'Local fixture',
  title: 'Tracer clip',
  blurb: 'A ten-second local clip used to exercise the resume affordance.',
  credit: 'Playdeck test fixture.'
} as const satisfies StreamingServicePlayerProps['media'];

/**
 * #551: the resume affordance mounted against a local clip, with its own
 * `Player.Root` in place of `StreamingServicePlayer`'s so a ref reaches the
 * handle `e2e/archetype-resume.spec.ts` reads. This renders exactly the tree
 * `StreamingServicePlayer` renders — the same root props, the same surface,
 * the same `media` and `resumeAt` — plus that ref.
 *
 * Tagged `real-playback` only, with no `!test`: the clip is local and
 * same-origin, and `loading="interaction"` means nothing is fetched until the
 * resume button is pressed, so the deterministic story run reaching this
 * story costs it nothing.
 */
export const ResumeLocalClip: StoryObj = {
  tags: ['real-playback'],
  render: () => (
    <Player.Root
      loading="interaction"
      ref={(handle) => {
        window.playdeckHandle = handle ?? undefined;
      }}
      source={localMedia.source}
    >
      <StreamingServiceSurface
        captionsSrc={assetUrl('archetype-captions.vtt')}
        media={localMedia}
        resumeAt={5}
      />
    </Player.Root>
  )
};
