import { createRoot } from 'react-dom/client';
import * as Player from '@playdeck/react';

// The same composition as plain.tsx, differing in the `thumbnails` prop and
// nothing else -- so whatever the two builds do not share is this feature's.
const Fixture = () => (
  <Player.Root source="/fixture.mp4">
    <Player.Viewport style={{ width: '480px', height: '270px' }}>
      <Player.Media />
      <Player.SeekSlider
        thumbnails="/thumbnails.vtt"
        style={{
          position: 'absolute',
          bottom: '1rem',
          left: '5%',
          width: '90%'
        }}
      />
    </Player.Viewport>
  </Player.Root>
);

createRoot(document.getElementById('root')!).render(<Fixture />);
