// Vidstack's npm `latest` tag (0.6.15) is a stale pre-rewrite line last
// published years ago; `docs/comparison/method.md` explains why this measures
// the `next` tag's 1.x line instead, which is what vidstack.io's current docs
// teach and what a reader installing the library today gets.
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
