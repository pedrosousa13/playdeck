// The composition `README.md`'s byte table calls "MP4 or WebM": core +
// primitives + the native provider, which `@playdeck/react` imports
// dynamically on interaction rather than statically. It is the same
// composition `tests/bundle/native-only/src/main.tsx` bundles for the budget
// gate, reused here rather than re-invented so this harness cannot describe
// Playdeck's own minimal player any differently than that fixture already
// does.
import { createRoot } from 'react-dom/client';
import * as Player from '@playdeck/react';

const Fixture = () => (
  <Player.Root loading="interaction" source="https://example.com/video.mp4">
    <Player.Viewport style={{ aspectRatio: '16 / 9', width: '320px' }}>
      <Player.Media />
      <Player.ActivationButton>
        <Player.PlayIcon />
      </Player.ActivationButton>
    </Player.Viewport>
  </Player.Root>
);

createRoot(document.getElementById('root')!).render(<Fixture />);
