import { createRoot } from 'react-dom/client';
import * as Player from '@playdeck/react';

// The composition this fixture is about: a seek slider with no `thumbnails`
// prop. The slider is rendered straight into the viewport rather than inside
// `Player.Controls`, which auto-hides -- what this fixture drives has to be
// hoverable without first arranging for the control bar to be showing.
const Fixture = () => (
  <Player.Root source="/fixture.mp4">
    <Player.Viewport style={{ width: '480px', height: '270px' }}>
      <Player.Media />
      <Player.SeekSlider
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
