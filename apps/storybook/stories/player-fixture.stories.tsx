import { useState } from 'react';
import * as Player from '@reely/react';
import type { Meta, StoryObj } from '@storybook/react-vite';

declare global {
  interface Window {
    reelyHandle?: Player.PlayerHandle;
  }
}

const youtubeExampleUrl = 'https://www.youtube.com/watch?v=M7lc1UVf-VE';
const vimeoExampleUrl = 'https://vimeo.com/76979871';

type PlayerFixtureProps = {
  readonly source?: string;
  readonly engine?: 'auto' | 'native' | 'hls.js';
  readonly activationSource?: 'youtube' | 'external';
  readonly autoplay?: Player.RootProps['autoplay'];
  readonly loading?: Player.PlayerLoadingStrategy;
  readonly preload?: Player.PlayerPreload;
  readonly defaultMuted?: boolean;
  readonly airplay?: 'demo';
  readonly sourceChange?: 'external';
  readonly captionRenderer?: Player.RootProps['captionRenderer'];
};

const PresentationControls = ({
  airplayDemo
}: {
  readonly airplayDemo: boolean;
}) => {
  const presentation = Player.usePlayerState((state) => ({
    fullscreen: state.fullscreen,
    fullscreenStatus: state.capabilities.fullscreen.status,
    fullscreenReason:
      'reason' in state.capabilities.fullscreen
        ? state.capabilities.fullscreen.reason
        : undefined,
    pictureInPicture: state.pictureInPicture,
    pictureInPictureStatus: state.capabilities.pictureInPicture.status,
    pictureInPictureReason:
      'reason' in state.capabilities.pictureInPicture
        ? state.capabilities.pictureInPicture.reason
        : undefined,
    airPlayStatus: state.capabilities.airPlay.status,
    airPlayReason:
      'reason' in state.capabilities.airPlay
        ? state.capabilities.airPlay.reason
        : undefined
  }));
  const actions = Player.usePlayerActions();

  return (
    <p
      data-testid="presentation-capabilities"
      data-fullscreen-status={presentation.fullscreenStatus}
      data-fullscreen-reason={presentation.fullscreenReason}
      data-fullscreen-state={presentation.fullscreen ? 'active' : 'inline'}
      data-pip-status={presentation.pictureInPictureStatus}
      data-pip-reason={presentation.pictureInPictureReason}
      data-pip-state={presentation.pictureInPicture ? 'active' : 'inline'}
      data-airplay-status={presentation.airPlayStatus}
      data-airplay-reason={presentation.airPlayReason}
    >
      {presentation.fullscreenStatus === 'available' ? (
        <button
          data-testid="fullscreen-toggle"
          onClick={() =>
            void (presentation.fullscreen
              ? actions.exitFullscreen()
              : actions.requestFullscreen())
          }
          type="button"
        >
          {presentation.fullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}
        </button>
      ) : null}{' '}
      {presentation.pictureInPictureStatus === 'available' ? (
        <button
          data-testid="pip-toggle"
          onClick={() =>
            void (presentation.pictureInPicture
              ? actions.exitPictureInPicture()
              : actions.requestPictureInPicture())
          }
          type="button"
        >
          {presentation.pictureInPicture
            ? 'Exit picture-in-picture'
            : 'Enter picture-in-picture'}
        </button>
      ) : null}{' '}
      {airplayDemo && presentation.airPlayStatus === 'available' ? (
        <button
          data-testid="airplay-picker"
          onClick={() => void actions.showAirPlayPicker()}
          type="button"
        >
          AirPlay
        </button>
      ) : null}{' '}
      Fullscreen: {presentation.fullscreenStatus}
      {presentation.fullscreenReason
        ? ` (${presentation.fullscreenReason})`
        : ''}{' '}
      · Picture-in-picture: {presentation.pictureInPictureStatus}
      {presentation.pictureInPictureReason
        ? ` (${presentation.pictureInPictureReason})`
        : ''}
    </p>
  );
};

const StateProbes = () => {
  const { engine, errorCategory } = Player.usePlayerState((state) => ({
    engine: state.hlsEngine,
    errorCategory: state.error?.category ?? null
  }));
  return (
    <p>
      Engine: <span data-testid="hls-engine">{engine ?? 'none'}</span> · Error:{' '}
      <span data-testid="error-category">{errorCategory ?? 'none'}</span>
    </p>
  );
};

const formatClock = (seconds: number): string => {
  // Never renders NaN or a negative value: unusable inputs collapse to 0:00.
  const safe = Number.isFinite(seconds) && seconds > 0 ? seconds : 0;
  const whole = Math.floor(safe);
  const minutes = Math.floor(whole / 60);
  const secs = whole % 60;
  return `${minutes}:${secs.toString().padStart(2, '0')}`;
};

const LiveControls = () => {
  const live = Player.usePlayerState((state) => ({
    isLive: state.live?.isLive ?? false,
    atLiveEdge: state.live?.atLiveEdge ?? false,
    known: state.live !== null,
    currentTime: state.currentTime,
    duration: state.duration,
    seekableEnd:
      state.seekable.length > 0
        ? Math.max(...state.seekable.map((range) => range.end))
        : null,
    seekableStart:
      state.seekable.length > 0
        ? Math.min(...state.seekable.map((range) => range.start))
        : null,
    seekStatus: state.capabilities.seek.status
  }));
  const actions = Player.usePlayerActions();

  // While live the seek slider maps the moving window; the time display shows
  // how far behind the live edge the position is, never a fixed duration.
  const behindEdgeSeconds =
    live.isLive && live.seekableEnd !== null
      ? Math.max(0, live.seekableEnd - live.currentTime)
      : 0;
  const timeLabel = live.isLive
    ? live.atLiveEdge
      ? 'LIVE'
      : `-${formatClock(behindEdgeSeconds)}`
    : `${formatClock(live.currentTime)} / ${formatClock(live.duration ?? 0)}`;

  return (
    <p
      data-testid="live-panel"
      data-live-known={live.known ? 'true' : 'false'}
      data-live-status={live.isLive ? 'live' : 'vod'}
      data-live-edge={
        live.isLive ? (live.atLiveEdge ? 'at-edge' : 'behind-edge') : 'none'
      }
      data-seek-status={live.seekStatus}
    >
      <span data-testid="live-indicator">
        {live.isLive ? (live.atLiveEdge ? 'LIVE' : 'BEHIND LIVE') : 'VOD'}
      </span>{' '}
      · <span data-testid="live-time">{timeLabel}</span>{' '}
      {live.isLive && live.seekStatus === 'available' ? (
        <>
          <button
            data-testid="live-seek-back"
            onClick={() =>
              void (
                live.seekableStart !== null &&
                actions.seekTo(live.seekableStart)
              )
            }
            type="button"
          >
            Jump to start
          </button>{' '}
          <button
            data-testid="live-seek-edge"
            onClick={() =>
              void (
                live.seekableEnd !== null && actions.seekTo(live.seekableEnd)
              )
            }
            type="button"
          >
            Jump to live
          </button>
        </>
      ) : null}
    </p>
  );
};

const captionTextTracks: Player.MediaProps['textTracks'] = [
  {
    src: '/captions-en.vtt',
    srcLang: 'en',
    label: 'English',
    kind: 'captions',
    default: true
  }
];

const PlayerFixture = ({
  source: sourceKey,
  engine,
  activationSource,
  autoplay: autoplayInput,
  loading: loadingInput,
  preload: preloadInput,
  defaultMuted: defaultMutedInput,
  airplay,
  sourceChange: sourceChangeInput,
  captionRenderer
}: PlayerFixtureProps) => {
  const autoplay: Player.RootProps['autoplay'] = autoplayInput ?? false;
  const loading: Player.PlayerLoadingStrategy = loadingInput ?? 'viewport';
  const preload: Player.PlayerPreload = preloadInput ?? 'metadata';
  const defaultMuted = defaultMutedInput ?? false;
  // The demo control drives `showAirPlayPicker()` directly, which the shipped
  // `AirPlayButton` primitive below also does. It stays behind the arg so it
  // does not shadow the primitive in every story; `platform.spec` reaches it by
  // testid, so the gating is a tidiness choice, not a constraint on locators.
  const airplayDemo = airplay === 'demo';
  const sourceChange = sourceChangeInput === 'external';
  const hlsEngine: 'auto' | 'native' | 'hls.js' = engine ?? 'auto';

  const vimeoSource: Player.RootProps['source'] | null =
    sourceKey === 'vimeo'
      ? vimeoExampleUrl
      : sourceKey === 'vimeo-unlisted'
        ? 'https://player.vimeo.com/video/76979871/abc123hash'
        : sourceKey?.startsWith('https://')
          ? sourceKey
          : null;

  const initialSource: Player.RootProps['source'] =
    sourceKey === 'hls'
      ? { type: 'hls', src: '/hls/master.m3u8', engine: hlsEngine }
      : sourceKey === 'live'
        ? { type: 'hls', src: '/live/index.m3u8', engine: hlsEngine }
        : (vimeoSource ??
          (sourceChange
            ? 'https://provider.invalid/source-a.mp4'
            : activationSource === 'external'
              ? 'https://provider.invalid/tracer.mp4'
              : activationSource === 'youtube'
                ? youtubeExampleUrl
                : '/tracer.mp4'));

  const replacementSource = sourceChange
    ? 'https://provider.invalid/source-b.mp4'
    : null;

  const [source, setSource] = useState(initialSource);
  // Only the captions fixture (a story arg sets `captionRenderer`) attaches a
  // real <track>; every other story keeps the plain <video> it had before.
  const textTracks = captionRenderer ? captionTextTracks : undefined;

  return (
    <>
      <Player.Root
        autoplay={autoplay}
        captionRenderer={captionRenderer}
        defaultMuted={defaultMuted}
        loading={loading}
        mediaMetadata={{
          title: 'Reely tracer',
          artist: 'Reely',
          artwork: [
            { src: '/poster.svg', sizes: '1280x720', type: 'image/svg+xml' }
          ]
        }}
        preload={preload}
        ref={(handle) => {
          window.reelyHandle = handle ?? undefined;
        }}
        source={source}
      >
        <Player.Viewport
          data-testid="viewport"
          style={{ aspectRatio: '16 / 9', maxWidth: '48rem', width: '100%' }}
        >
          <Player.Poster>
            <Player.PosterImage
              alt=""
              decoding="async"
              fetchPriority="high"
              height={720}
              loading="eager"
              objectPosition="30% 40%"
              sizes="(max-width: 48rem) 100vw, 48rem"
              src="/poster.svg"
              srcSet="/poster.svg 640w, /poster.svg 1280w"
              width={1280}
            />
          </Player.Poster>
          <Player.ActivationButton />
          <Player.LoadingIndicator />
          <Player.Media textTracks={textTracks} />
          <Player.Captions />
        </Player.Viewport>
        <Player.PlayButton />
        <Player.CaptionsButton />
        {/*
          Mounted everywhere on purpose: "AirPlay" contains "Play", so a
          name-based Playwright lookup collides here (#73). It is a partial
          guard — the primitive only renders where the airPlay capability
          exists (WebKit, and not for iframe providers), and ActivationButton's
          "Play video" only collides on every engine until it is activated
          away. The eslint rule over e2e/ is what actually enforces this.
        */}
        <Player.AirPlayButton />
        <PresentationControls airplayDemo={airplayDemo} />
        <LiveControls />
        <StateProbes />
      </Player.Root>
      {replacementSource && source !== replacementSource ? (
        <button onClick={() => setSource(replacementSource)} type="button">
          Switch to source B
        </button>
      ) : null}
    </>
  );
};

const YouTubeExample = () => (
  <Player.Root loading="interaction" source={youtubeExampleUrl}>
    <Player.Viewport
      data-testid="youtube-example"
      style={{ aspectRatio: '16 / 9', maxWidth: '48rem', width: '100%' }}
    >
      <Player.ActivationButton aria-label="Watch YouTube example" />
      <Player.LoadingIndicator />
      <Player.Media />
    </Player.Viewport>
  </Player.Root>
);

const meta: Meta<PlayerFixtureProps> = {
  title: 'Fixtures/PlayerFixture',
  tags: ['real-playback', '!test'],
  argTypes: {
    source: {
      control: 'text',
      description:
        "'hls' | 'live' | 'vimeo' | 'vimeo-unlisted' | an https:// URL | undefined (defaults to the native tracer)."
    },
    engine: {
      control: 'radio',
      options: ['auto', 'native', 'hls.js']
    },
    activationSource: {
      control: 'radio',
      options: ['youtube', 'external']
    },
    autoplay: {
      control: 'radio',
      options: [false, 'muted', 'audible']
    },
    loading: {
      control: 'radio',
      options: ['viewport', 'eager', 'interaction']
    },
    preload: {
      control: 'radio',
      options: ['metadata', 'none', 'auto']
    },
    defaultMuted: { control: 'boolean' },
    airplay: {
      control: 'radio',
      options: ['demo']
    },
    sourceChange: {
      control: 'radio',
      options: ['external']
    },
    captionRenderer: {
      control: 'radio',
      options: ['custom', 'native']
    }
  },
  parameters: {
    docs: {
      description: {
        component:
          'Reproduces the original `PlayerFixture` e2e contract as one named Storybook story per scenario: same testids, same `data-*` state attributes, same `window.reelyHandle`, and the same source-selection branching, driven by static story args instead of URL query parameters. Real providers, real media, real network — excluded from the deterministic story test suite (tagged `!test`).'
      }
    }
  },
  render: (args) => <PlayerFixture {...args} />
};

export default meta;

type Story = StoryObj<typeof meta>;

export const NativeMp4: Story = {
  args: {
    engine: 'auto',
    autoplay: false,
    loading: 'viewport',
    preload: 'metadata',
    defaultMuted: false
  },
  render: (args) => (
    <>
      <PlayerFixture {...args} />
      <YouTubeExample />
    </>
  )
};

export const CaptionsCustom: Story = {
  args: { captionRenderer: 'custom' }
};

export const CaptionsNative: Story = {
  args: { captionRenderer: 'native' }
};

export const HlsHlsJs: Story = {
  args: { source: 'hls', engine: 'hls.js' }
};

export const HlsNative: Story = {
  args: { source: 'hls', engine: 'native' }
};

export const LiveHlsJs: Story = {
  args: { source: 'live', engine: 'hls.js' }
};

export const LiveNative: Story = {
  args: { source: 'live', engine: 'native' }
};

export const AutoplayMuted: Story = {
  args: { autoplay: 'muted' }
};

export const AutoplayAudible: Story = {
  args: { autoplay: 'audible' }
};

export const AirplayDemo: Story = {
  args: { airplay: 'demo' }
};

export const InteractionExternal: Story = {
  args: { loading: 'interaction', activationSource: 'external' }
};

export const InteractionSourceChangeMuted: Story = {
  args: {
    loading: 'interaction',
    sourceChange: 'external',
    defaultMuted: true
  }
};

export const InteractionPreloadNoneExternalMuted: Story = {
  args: {
    loading: 'interaction',
    preload: 'none',
    activationSource: 'external',
    defaultMuted: true
  }
};

export const InteractionYoutube: Story = {
  args: { loading: 'interaction', activationSource: 'youtube' }
};

export const VimeoInteraction: Story = {
  args: { source: 'vimeo', loading: 'interaction' }
};

export const VimeoViewport: Story = {
  args: { source: 'vimeo' }
};

export const VimeoUnlistedInteraction: Story = {
  args: { source: 'vimeo-unlisted', loading: 'interaction' }
};

export const VimeoInteractionMuted: Story = {
  args: { source: 'vimeo', loading: 'interaction', defaultMuted: true }
};

export const VimeoFreePlan: Story = {
  args: { source: 'https://vimeo.com/22439234', loading: 'interaction' }
};

export const VimeoPaidPlan: Story = {
  args: { source: 'https://vimeo.com/1123898957', loading: 'interaction' }
};

// Reaches the Wistia provider through the plain `https://` branch above, so no
// source key of its own. Muted by default because `wistia-smoke.spec.ts` needs
// confirmed playback from one click, which an audible embed cannot promise.
export const WistiaInteractionMuted: Story = {
  args: {
    source: 'https://wesleyluyten.wistia.com/medias/oifkgmxnkb',
    loading: 'interaction',
    defaultMuted: true
  }
};
