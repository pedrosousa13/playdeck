import * as Player from '@playdeck/react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { withCss } from '../.storybook/theme';
// The one consumer rule these stories exist to show, read as text so what is
// mounted here is the same file the Contract docs page prints. `?raw` and not
// `?inline` for the reason spelled out in play-button.stories.tsx: a production
// build minifies `?inline` css, and the printed example has to stay readable.
import aspectRatioCss from '../../../examples/css-media-aspect-ratio.css?raw';

// Both fixtures are local, offline, one second, video-only H.264 — see
// apps/storybook/README.md for how the portrait one was generated. They differ
// only in shape (360x640 against 320x180), which is the whole experiment: one
// rule, and the box follows whichever source is behind it.
const PORTRAIT_SOURCE = '/tracer-portrait.mp4';
const LANDSCAPE_SOURCE = '/tracer.mp4';

/**
 * One player, given a width and nothing else. `loading="eager"` with
 * `preload="metadata"` is what makes the ratio arrive without anyone pressing
 * anything — it is published at `loadedmetadata`, and no frame is played.
 */
const Box = ({
  caption,
  loading = 'eager',
  source
}: {
  readonly caption: string;
  readonly loading?: Player.PlayerLoadingStrategy;
  readonly source: string;
}) => (
  <figure style={{ margin: 0, width: '13rem' }}>
    <Player.Root loading={loading} preload="metadata" source={source}>
      {/*
        No `aspectRatio` in `style`. An inline value beats the stylesheet the
        decorator mounts, so stating one here would hide the entire behaviour —
        which is what `Fixtures/PlayerFixture` does on purpose, having been
        written before there was anything to hide. Only the width is set, and
        that is the consumer's job either way.
      */}
      <Player.Viewport style={{ background: '#0b0e13' }}>
        <Player.Media />
        {loading === 'interaction' ? (
          // Painted only so the default `Play` text is legible over the
          // viewport: headless, the overlay is a UA button and puts white text
          // on the browser's own grey.
          <Player.ActivationButton
            style={{ background: 'transparent', border: 0, color: '#ffffff' }}
          />
        ) : null}
      </Player.Viewport>
    </Player.Root>
    <figcaption
      style={{
        paddingTop: '0.5rem',
        fontFamily: 'system-ui, sans-serif',
        fontSize: '0.8125rem'
      }}
    >
      {caption}
    </figcaption>
  </figure>
);

const meta = {
  title: 'Real playback/AspectRatio',
  tags: ['real-playback', '!test'],
  // Mounted inside each story's own tree, so it is torn down with the story
  // rather than reshaping every other player on the page.
  decorators: [withCss(aspectRatioCss)],
  parameters: {
    docs: {
      description: {
        component:
          'A provider that can measure its media publishes the intrinsic ratio onto the `viewport` part as `--playdeck-media-aspect-ratio`. Every player below mounts the same single rule from `examples/css-media-aspect-ratio.css` — `aspect-ratio: var(--playdeck-media-aspect-ratio, 16 / 9)` — and is given a width and nothing else, so each box is shaped by what its own source measures, or by the fallback where nothing has been measured. Local fixtures, no network, but real media through a real provider — so excluded from the deterministic story test suite (tagged `!test`).'
      }
    }
  }
} satisfies Meta;

export default meta;

type Story = StoryObj;

/**
 * The point of the issue: a 360x640 source, and a box that is 9:16 rather than
 * a 16:9 letterbox with the picture pillarboxed inside it.
 */
export const VerticalSource: Story = {
  render: () => (
    <Box
      caption="360×640 — the box is 9:16 because the media is, not because anything here said so."
      source={PORTRAIT_SOURCE}
    />
  )
};

/**
 * The same rule three times. Two boxes are shaped by a measurement and the
 * third by the fallback, which is also every YouTube player and every source
 * before its metadata lands.
 */
export const AgainstTheFallback: Story = {
  render: () => (
    <div style={{ display: 'flex', gap: '1.5rem', alignItems: 'flex-start' }}>
      <Box caption="Measured: 360×640, so 9:16." source={PORTRAIT_SOURCE} />
      <Box caption="Measured: 320×180, so 16:9." source={LANDSCAPE_SOURCE} />
      <Box
        caption="Nothing loaded, so nothing measured — this is the var() fallback. Press it: the source is the portrait one, and the box reshapes once its metadata lands."
        loading="interaction"
        source={PORTRAIT_SOURCE}
      />
    </div>
  )
};
