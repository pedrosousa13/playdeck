import { createRoot } from 'react-dom/client';
import * as Player from '@playdeck/react';

// The same composition as eager.tsx, differing only in `loading`.
const Fixture = () => (
  <Player.Root loading="viewport" source="/fixture.mp4">
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
