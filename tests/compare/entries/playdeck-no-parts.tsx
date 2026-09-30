// Neither playdeck.tsx nor playdeck-control-bar.tsx measures Playdeck with no
// control parts at all: playdeck.tsx already adds `Player.ActivationButton`
// and `Player.PlayIcon` on top of core, the native provider and the
// primitives, so it draws one button. This entry drops both and renders
// `Player.Root`, `Player.Viewport` and `Player.Media` alone -- core plus the
// native provider, nothing else -- because that is the only Playdeck
// composition that compares honestly against react-player's row: react-player
// renders no UI of its own for a plain MP4 either (see
// `entries/react-player.tsx` and `docs/comparison/method.md`'s "Equivalent
// composition per library"), and charging Playdeck for a button react-player
// never draws would not be a fact about either library's cost for the same
// thing.
//
// `loading="interaction"` is kept from playdeck.tsx rather than dropped, so
// the two rows differ only by the parts they draw. It is not what makes
// `@playdeck/provider-native` load dynamically: `loadProvider`
// (`packages/react/src/provider-loaders.ts`) takes no `loading` argument at
// all and branches on `source.type`, so a `video` source reaches
// `await import('@playdeck/provider-native')` at every loading strategy.
// `loading` decides when `loadProvider` is called, not whether the import is
// static. What matters here is where that import site sits: in `Root`'s own
// `use-activation.ts` dependency, which imports `provider-loaders.ts`, and
// not in `ActivationButton` -- so the provider stays reachable in this
// fixture's build graph with no activation element present. Confirmed by
// reading those two files rather than assumed.
import { createRoot } from 'react-dom/client';
import * as Player from '@playdeck/react';

const Fixture = () => (
  <Player.Root loading="interaction" source="https://example.com/video.mp4">
    <Player.Viewport style={{ aspectRatio: '16 / 9', width: '320px' }}>
      <Player.Media />
    </Player.Viewport>
  </Player.Root>
);

createRoot(document.getElementById('root')!).render(<Fixture />);
