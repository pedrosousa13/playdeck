import * as Player from '@playdeck/react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import type { ReactNode } from 'react';
import { assetUrl } from './asset-url';

const Stage = ({ children }: { readonly children: ReactNode }) => (
  <Player.Viewport style={{ width: 640, height: 360, background: '#0b0e13' }}>
    <Player.Poster>
      <Player.PosterImage src={assetUrl('poster.svg')} />
    </Player.Poster>
    {children}
    <Player.ActivationButton aria-label="Load and play" />
  </Player.Viewport>
);

const meta = {
  title: 'Real playback/Providers',
  tags: ['real-playback', '!test'],
  parameters: {
    docs: {
      description: {
        component:
          'Real providers, real media, real network — excluded from the deterministic story test suite (tagged `!test`). Click the activation overlay to load. HLS/live/native are local fixtures; YouTube, Vimeo and Wistia hit the network. **Live HLS is the exception on the published workbench:** its playlist is synthesized by a dev-server plugin rather than served as a file, so that story loads only when you run the workbench yourself.'
      }
    }
  }
} satisfies Meta;

export default meta;

type Story = StoryObj;

/**
 * A plain MP4 played by the browser's own `<video>` — no provider SDK, no
 * adaptive engine. The baseline the rest of this page is worth comparing
 * against: everything the primitives do here they do with nothing loaded.
 */
export const NativeMp4: Story = {
  render: () => (
    <Player.Root loading="interaction" source={assetUrl('tracer.mp4')}>
      <Stage>
        <Player.Media />
      </Stage>
    </Player.Root>
  )
};

/**
 * The same on-demand HLS playlist as the story below, with `engine: 'native'`
 * pinned — the browser's own HLS support, which in practice means Safari.
 * Nothing is downloaded to play it. In a browser with no native HLS this
 * fails to load, and that is the story working: the pin is a pin, not a
 * preference the library quietly overrides.
 */
export const HlsVodNative: Story = {
  render: () => (
    <Player.Root
      loading="interaction"
      source={{
        type: 'hls',
        src: assetUrl('hls/master.m3u8'),
        engine: 'native'
      }}
    >
      <Stage>
        <Player.Media />
      </Stage>
    </Player.Root>
  )
};

/**
 * The same playlist through hls.js, pinned. The engine is loaded on demand at
 * activation rather than bundled, which is what the delay after pressing the
 * overlay is. Pinned rather than left on `auto` so the two engines can be
 * compared side by side in one browser — on `auto`, Safari would pick native
 * and this story would be a duplicate of the one above.
 */
export const HlsVodHlsJs: Story = {
  render: () => (
    <Player.Root
      loading="interaction"
      source={{
        type: 'hls',
        src: assetUrl('hls/master.m3u8'),
        engine: 'hls.js'
      }}
    >
      <Stage>
        <Player.Media />
      </Stage>
    </Player.Root>
  )
};

/**
 * A live playlist — a moving window with no duration, where seeking is bounded
 * by what the playlist still lists rather than by a fixed end.
 *
 * The only fixture here that a server has to synthesize rather than serve:
 * `.storybook/live-playlist-plugin.ts` answers `/live/index.m3u8` from
 * `configureServer` and `configurePreviewServer`, so it exists on the dev
 * server and under `storybook preview` and is absent from a static build. This
 * story therefore cannot load on the published workbench, which is a static
 * build (#435). It is left pointing at the same path rather than given a
 * stand-in, because a recorded playlist would not be live and the story exists
 * to exercise a moving window.
 */
export const LiveHls: Story = {
  render: () => (
    <Player.Root
      loading="interaction"
      source={{
        type: 'hls',
        src: assetUrl('live/index.m3u8'),
        engine: 'hls.js'
      }}
    >
      <Stage>
        <Player.Media />
      </Stage>
    </Player.Root>
  )
};

/**
 * A YouTube watch URL handed to `Player.Root` as a bare string — source
 * detection recognises the host and loads the YouTube provider. Playback runs
 * inside YouTube's iframe, so the primitives above it are driving an embed API
 * rather than a `<video>`, and the capability set narrows accordingly. Hits
 * the network.
 */
export const YouTube: Story = {
  render: () => (
    <Player.Root
      loading="interaction"
      source="https://www.youtube.com/watch?v=M7lc1UVf-VE"
    >
      <Stage>
        <Player.Media />
      </Stage>
    </Player.Root>
  )
};

/**
 * The same, for Vimeo: a public video URL, detected from the host and played
 * through Vimeo's own embed. The three embed stories stage the same tree as
 * the local-file ones — poster, media, activation overlay — so what differs
 * between them is entirely the provider underneath. Hits the network.
 */
export const Vimeo: Story = {
  render: () => (
    <Player.Root loading="interaction" source="https://vimeo.com/76979871">
      <Stage>
        <Player.Media />
      </Stage>
    </Player.Root>
  )
};

/**
 * The third embed provider, from a Wistia media URL. The media belongs to a
 * third-party account this project does not control, so a failure here can be
 * the video going away rather than anything in Playdeck — check that before
 * chasing it. Hits the network.
 */
export const Wistia: Story = {
  render: () => (
    <Player.Root
      loading="interaction"
      source="https://wesleyluyten.wistia.com/medias/oifkgmxnkb"
    >
      <Stage>
        <Player.Media />
      </Stage>
    </Player.Root>
  )
};
