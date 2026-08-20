import * as Player from '@playdeck/react';

// A Vimeo source is a URL in the `source` prop, the same as every other
// provider. `?h=` carries the privacy hash of an unlisted video, which
// `detectSource` keeps and hands to the embed.
export const VimeoClip = () => (
  <Player.Root
    controls={false}
    // Everything Vimeo alone has lives here. `dnt` asks Vimeo not to track the
    // session; `suppressSeoMetadata` stops the SDK sending the page's own URL
    // to the embed, and is page-wide rather than per-player.
    providerOptions={{ vimeo: { dnt: true, suppressSeoMetadata: true } }}
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
