import { createRoot } from 'react-dom/client';
import * as Player from '@playdeck/react';
// The second stylesheet subpath, resolved the way src/main.tsx resolves the
// first: through the installed package's export map, with the same blind spot
// -- `./vite-env.d.ts` declares `*.css` as a wildcard module, so the
// type-check runs cannot see this import at all. The bundler resolving it is
// what proves the subpath is reachable, and the smoke test reads a token back
// off the page to prove what arrived was the docked theme.
import '@playdeck/react/docked.css';

const Fixture = () => (
  <Player.Root loading="eager" source="/fixture.mp4">
    <Player.Viewport style={{ aspectRatio: '16 / 9', width: '320px' }}>
      <Player.Media />
      <Player.ActivationButton />
    </Player.Viewport>
  </Player.Root>
);

createRoot(document.getElementById('root')!).render(<Fixture />);
