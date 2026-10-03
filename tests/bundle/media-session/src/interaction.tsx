import { createRoot } from 'react-dom/client';
import * as Player from '@playdeck/react';

// The same composition as eager.tsx, differing only in `loading`. This is
// the page test.mjs drives a click on: `interaction` loading defers the
// native provider's own import until the first gesture, which is what makes
// this page the one that can tell "the Media Session chunk waits for a
// gesture too" apart from "it does not". The click lands on
// `Player.ActivationButton`, not `Player.PlayButton` -- under `interaction`
// loading, only `activateFromInteraction`
// (packages/react/src/use-activation.ts), which `ActivationButton` alone
// calls, commits the source; `PlayButton` toggles playback once a source is
// already committed.
const Fixture = () => (
  <Player.Root loading="interaction" source="/fixture.mp4">
    <Player.Viewport style={{ width: '320px', aspectRatio: '16 / 9' }}>
      <Player.Media />
      <Player.ActivationButton>
        <Player.PlayIcon />
      </Player.ActivationButton>
      <Player.Controls>
        <Player.PlayButton />
      </Player.Controls>
    </Player.Viewport>
  </Player.Root>
);

createRoot(document.getElementById('root')!).render(<Fixture />);
