import { createRoot } from 'react-dom/client';
import * as Player from '@playdeck/react';

// The composition every page in this fixture shares, differing only in
// `loading` -- see viewport.tsx and interaction.tsx. `Player.ActivationButton`
// is the one thing `interaction.tsx`'s own half of test.mjs clicks; it is
// rendered here too so all three pages bundle from the same shape.
const Fixture = () => (
  <Player.Root loading="eager" source="/fixture.mp4">
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
