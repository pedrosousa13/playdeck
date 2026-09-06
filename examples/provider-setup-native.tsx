import * as Player from '@playdeck/react';

// A native source is an `.mp4`/`.webm` URL in the `source` prop.
// `loop`, `startTime` and `endTime` are `Player.Root`'s own props on every
// provider (ADR-0004), never keys in a provider's option bag — native takes no
// `providerOptions` key of its own at all.
export const ClipWithCaptions = () => (
  <Player.Root
    loop
    startTime={30}
    endTime={45}
    source="https://example.com/clip.mp4"
  >
    <Player.Viewport>
      {/* `textTracks` reaches native playback directly, unlike the embed
          providers, where only captions a provider discovers for itself are
          available. */}
      <Player.Media
        textTracks={[
          { src: '/captions.en.vtt', srcLang: 'en', label: 'English' }
        ]}
      />
      <Player.Captions />
      <Player.Controls>
        <Player.PlayButton />
        <Player.SeekSlider />
        <Player.Time type="current" />
        <Player.CaptionsButton />
        <Player.PipButton />
        {/* Renders only where there is a receiver to cast to. */}
        <Player.AirPlayButton />
        <Player.FullscreenButton />
      </Player.Controls>
      <Player.ErrorDisplay />
    </Player.Viewport>
  </Player.Root>
);
