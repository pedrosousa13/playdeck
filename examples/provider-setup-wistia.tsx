import * as Player from '@playdeck/react';

// A Wistia source is a URL in the `source` prop, matched on `wistia.com` /
// `wistia.net` and any of their subdomains. `detectSource` reads the media id
// out of the `/medias/`, `/embed/medias/` and `/embed/iframe/` path forms.
export const WistiaClip = () => (
  <Player.Root
    // For Wistia, `controls` is a key in `providerOptions.wistia` rather than
    // a `Player.Root` prop. That bag also accepts `dnt`, `playerColor`,
    // `swatch`, `poster` and `transparentLetterbox`, each a decision to make
    // deliberately rather than inherit from an example.
    providerOptions={{ wistia: { controls: false } }}
    source="https://home.wistia.com/medias/oifkgmxnkb"
  >
    <Player.Viewport>
      <Player.Media />
      <Player.Controls>
        <Player.PlayButton />
        <Player.SeekSlider />
        <Player.Time type="current" />
        <Player.FullscreenButton />
      </Player.Controls>
      {/* A Wistia URL that is not one of the accepted forms is refused by
          `detectSource`, and the refusal names the URL it turned down. */}
      <Player.ErrorDisplay />
    </Player.Viewport>
  </Player.Root>
);
