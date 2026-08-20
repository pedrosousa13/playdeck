import * as Player from '@playdeck/react';

// A YouTube source is a URL in the `source` prop and nothing else: nothing to
// install, nothing to register. `detectSource` reads the video id out of the
// `v` parameter, and `@playdeck/react` imports the YouTube provider once it has.
export const YouTubeClip = () => (
  <Player.Root
    // `controls`, `loop`, `startTime` and `endTime` are Playdeck's own props on
    // every provider (ADR-0004), never keys in a provider's option bag.
    controls={false}
    // No `providerOptions`: every YouTube default is the one to start from. The
    // embed loads from youtube-nocookie.com unless you move it, and moving it
    // is a decision to make deliberately, not to inherit from an example.
    source="https://www.youtube.com/watch?v=dQw4w9WgXcQ"
  >
    <Player.Viewport>
      <Player.Media />
      <Player.Controls>
        <Player.PlayButton />
        <Player.SeekSlider />
        <Player.Time type="current" />
        <Player.FullscreenButton />
      </Player.Controls>
      {/* A source YouTube's own URL forms do not cover is refused by
          `detectSource`, and the refusal names the URL it turned down. */}
      <Player.ErrorDisplay />
    </Player.Viewport>
  </Player.Root>
);
