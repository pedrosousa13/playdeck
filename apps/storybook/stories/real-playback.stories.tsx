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

export const NativeMp4: Story = {
  render: () => (
    <Player.Root loading="interaction" source={assetUrl('tracer.mp4')}>
      <Stage>
        <Player.Media />
      </Stage>
    </Player.Root>
  )
};

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

// The only fixture here that a server has to synthesize rather than serve:
// `.storybook/live-playlist-plugin.ts` answers `/live/index.m3u8` from
// `configureServer` and `configurePreviewServer`, so it exists on the dev
// server and under `storybook preview` and is absent from a static build. This
// story therefore cannot load on the published workbench, which is a static
// build (#435). It is left pointing at the same path rather than given a
// stand-in, because a recorded playlist would not be live and the story exists
// to exercise a moving window.
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

export const Vimeo: Story = {
  render: () => (
    <Player.Root loading="interaction" source="https://vimeo.com/76979871">
      <Stage>
        <Player.Media />
      </Stage>
    </Player.Root>
  )
};

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
