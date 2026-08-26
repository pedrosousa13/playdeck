import { createRoot } from 'react-dom/client';
import * as Player from '@playdeck/react';
// The stylesheet subpath the README tells consumers to import, resolved the way
// they resolve it: through the installed package's export map. The type-check
// runs cannot see this one -- `./vite-env.d.ts` pulls in `vite/client`, which
// declares `*.css` as a wildcard module, so this import satisfies the compiler
// whether or not the subpath exists. The bundler resolving it is what proves
// the subpath is reachable, and the smoke test reads a token back off the page
// to prove what arrived was the theme.
import '@playdeck/react/theme.css';

const Fixture = () => (
  <Player.Root loading="eager" source="/fixture.mp4">
    <Player.Viewport style={{ aspectRatio: '16 / 9', width: '320px' }}>
      <Player.Media />
      <Player.ActivationButton />
    </Player.Viewport>
  </Player.Root>
);

createRoot(document.getElementById('root')!).render(<Fixture />);
