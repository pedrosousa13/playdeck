import * as Player from '@playdeck/react';

// `warmUp` is off by default, which changes nothing about this player's
// server-render output. On, as here, it opens a connection to the detected
// provider's own origins ahead of activation: a `preconnect` hint for
// YouTube's script and embed hosts in the server-rendered output (the poster
// CDN host joins only with `poster="provider"`, not set here), and --
// because this player loads `interaction`ally -- the YouTube chunk's own
// dynamic import starting on the first hover or keyboard focus
// `Player.ActivationButton` receives, well before the click that actually
// activates it.
const source = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ';

export const WarmedYouTubeClip = () => (
  <Player.Root loading="interaction" source={source} warmUp>
    <Player.Viewport>
      <Player.Media />
      <Player.ActivationButton aria-label="Play" />
    </Player.Viewport>
  </Player.Root>
);
