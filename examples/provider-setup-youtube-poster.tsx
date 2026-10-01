import * as Player from '@playdeck/react';
import { resolveYouTubePosterUrl } from '@playdeck/provider-youtube';

// `poster="provider"` resolves once a provider has attached, so it never
// resolves for a `loading="interaction"` root: the provider stays dormant
// until the viewer's first click, by design (the same guarantee `Player.Root`
// gives every dormant source -- nothing fetched, no embed mounted). A still
// for that window has to come from somewhere that does not need the
// provider. `resolveYouTubePosterUrl` is exactly that: synchronous, makes no
// request, and reads the same `source` a running YouTube adapter would.
const source = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ';

// `null` for anything that is not a YouTube source `resolveYouTubePosterUrl`
// recognises -- `?? undefined` is what hands `Player.Root` "no poster" rather
// than the string `"null"`.
export const YouTubeClipDormantUntilInteraction = () => (
  <Player.Root
    loading="interaction"
    poster={resolveYouTubePosterUrl(source) ?? undefined}
    source={source}
  >
    <Player.Viewport>
      {/* No children: `Player.Poster` falls back to `Root`'s own `poster`
          prop, the same default image a resolved `poster="provider"` would
          render. */}
      <Player.Poster />
      <Player.Media />
      <Player.ActivationButton aria-label="Play" />
    </Player.Viewport>
  </Player.Root>
);
