import * as Player from '@playdeck/react';

// A Vimeo source is a URL in the `source` prop, the same as every other
// provider. `?h=` carries the privacy hash of an unlisted video, which
// `detectSource` keeps and hands to the embed.
export const VimeoClip = () => (
  <Player.Root
    controls={false}
    // No `providerOptions`: `dnt` is already on by default, and
    // `suppressSeoMetadata` silences the SDK handshake for every Vimeo embed on
    // the page, not just this one. That blast radius is a decision to make
    // deliberately, not to inherit from an example.
    source="https://vimeo.com/76979871?h=8272103f6e"
  >
    <Player.Viewport>
      <Player.Media />
      <Player.Controls>
        <Player.PlayButton />
        <Player.SeekSlider />
        <Player.Time type="current" />
        <Player.FullscreenButton />
      </Player.Controls>
      {/* Vimeo has more URL forms than Playdeck reads. A form it does not read
          is refused by `detectSource`, and the refusal names the URL. */}
      <Player.ErrorDisplay />
    </Player.Viewport>
  </Player.Root>
);
