// Media Chrome ships no single "default player" component -- like Playdeck,
// it is a set of custom elements a consumer arranges, so there is no one
// composition its own docs call the default. This is the control bar its
// README's own usage example builds: a play button, seek buttons, mute with a
// volume range, a time range and a fullscreen button around a native
// `<video>` wired in through the `slot="media"` convention.
//
// `media-chrome/react` re-exports a React wrapper for every custom element in
// the library from one module (`import * as Modules from '../index.js'`,
// read from media-chrome 4.19.2's own `dist/react/index.js`), so importing
// any one of these pulls in the whole registry rather than only the controls
// this file names -- `docs/comparison/method.md` records that as a measured
// property of the library at that version, not an artifact of this fixture.
import { createRoot } from 'react-dom/client';
import {
  MediaController,
  MediaControlBar,
  MediaPlayButton,
  MediaSeekBackwardButton,
  MediaSeekForwardButton,
  MediaMuteButton,
  MediaVolumeRange,
  MediaTimeRange,
  MediaFullscreenButton
} from 'media-chrome/react';

const Fixture = () => (
  <MediaController>
    <video slot="media" src="https://example.com/video.mp4" />
    <MediaControlBar>
      <MediaPlayButton />
      <MediaSeekBackwardButton />
      <MediaSeekForwardButton />
      <MediaMuteButton />
      <MediaVolumeRange />
      <MediaTimeRange />
      <MediaFullscreenButton />
    </MediaControlBar>
  </MediaController>
);

createRoot(document.getElementById('root')!).render(<Fixture />);
