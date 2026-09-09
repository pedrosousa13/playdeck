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
// `loading="interaction"` is kept from playdeck.tsx rather than dropped: it
// is what makes `@playdeck/provider-native` load through a dynamic `import()`
// instead of a static one, and that import site lives in `Root`'s own
// `use-activation.ts` dependency (`packages/react/src/use-activation.ts`,
// which imports `provider-loaders.ts`), not in `ActivationButton` -- so it
// stays reachable in this fixture's build graph with no activation element
// present to trigger it, confirmed by reading those two files rather than
// assumed.
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
