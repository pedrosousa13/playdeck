import * as Player from '@playdeck/react';

// An HLS source is an `.m3u8` URL in the `source` prop. `providerOptions.hls`
// takes a `build` name, never the loader function `createHlsProvider` itself
// accepts: a provider option bag is compared with `Object.is`, and a function
// passed inline would never reach a stable identity across renders. `'light'`
// is smaller and drops subtitles, alternate audio, CMCD, EME and Variable
// Substitution — see `@playdeck/provider-hls`'s README for the size and
// before choosing it over the default `'full'` build.
export const HlsClip = () => (
  <Player.Root
    providerOptions={{ hls: { build: 'light' } }}
    source="https://example.com/master.m3u8"
  >
    <Player.Viewport>
      <Player.Media />
      <Player.Controls>
        <Player.PlayButton />
        <Player.SeekSlider />
        <Player.Time type="current" />
        <Player.FullscreenButton />
      </Player.Controls>
      {/* A source `detectSource` refuses, or — when an engine is pinned
          through an explicit `{ type: 'hls', src, engine }` source — one the
          browser cannot provide, is reported here with an explained error
          rather than a silent fallback. */}
      <Player.ErrorDisplay />
    </Player.Viewport>
  </Player.Root>
);
