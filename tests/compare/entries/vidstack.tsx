// Checked 2026-09-05: @vidstack/react's `latest` npm dist-tag resolved to
// 0.6.15, which has no `DefaultVideoLayout` export; its `next` dist-tag
// resolved to 1.15.6, which is what vidstack.io's documentation installs and
// what this fixture measures. `docs/comparison/method.md`'s "Vidstack's
// version" section has the detail.
//
// `DefaultVideoLayout` from the `player/layouts/default` subpath is Vidstack's
// own answer to "default controls" for a library that is otherwise a set of
// composable parts around `<MediaProvider>` -- the same role
// `Player.ActivationButton` plays in the Playdeck entry, at a much larger
// scale because it draws a full control bar rather than one button.
import { createRoot } from 'react-dom/client';
import { MediaPlayer, MediaProvider } from '@vidstack/react';
import {
  defaultLayoutIcons,
  DefaultVideoLayout
} from '@vidstack/react/player/layouts/default';

const Fixture = () => (
  <MediaPlayer src="https://example.com/video.mp4">
    <MediaProvider />
    <DefaultVideoLayout icons={defaultLayoutIcons} />
  </MediaPlayer>
);

createRoot(document.getElementById('root')!).render(<Fixture />);
