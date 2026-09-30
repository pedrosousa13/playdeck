// react-player 3.4.0's default export renders the native `<video>` element
// for an MP4 URL (its `html` player, the last entry in that version's
// `players.js` and the only one imported eagerly -- every other provider is
// `React.lazy`-loaded from its own package). Read from react-player 3.4.0's
// own source, so the claim carries the version it was read from rather than
// describing "react-player" as if the shape were guaranteed to hold across
// one. `controls` is the prop that turns on the browser's native control
// set, which is the closest this library has to "default controls" for a
// plain file: it ships no UI of its own for the file player.
import { createRoot } from 'react-dom/client';
import ReactPlayer from 'react-player';

const Fixture = () => (
  <ReactPlayer
    src="https://example.com/video.mp4"
    controls
    width="320px"
    height="180px"
  />
);

createRoot(document.getElementById('root')!).render(<Fixture />);
