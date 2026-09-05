// `@videojs/react` 10.0.0-beta.32 is not a React wrapper around the
// `video.js` 8.24.0 this comparison also measures: it is the Video.js 10
// rewrite, published by the same GitHub org (`repository` field:
// github.com/videojs/v10, directory `packages/react`) with its own engine
// packages (`@videojs/core`, `@videojs/media`, `@videojs/spf`,
// `@videojs/store`, `@videojs/utils`) and no dependency on `video.js` at all.
// It is still marked beta by its own README ("Close to stable. Experimental
// adoption in real projects."), and it is measured here as its own row rather
// than folded into the video.js 8 one for that reason -- the two rows are two
// different libraries that happen to share a name and an org.
//
// The composition is the one its own bundled documentation installs, read
// from the installed package rather than a docs site:
// node_modules/@videojs/react/docs/how-to/installation.md's "Create your
// player" step is `<VideoPlayer><VideoSkin><Video src playsInline /></VideoSkin></VideoPlayer>`
// from the `@videojs/react/video` preset subpath -- the packaged default skin,
// which is this library's own answer to "default controls".
//
// That guide also imports `@videojs/react/video/skin.css`, dropped here for
// the same reason no other entry in this directory imports a stylesheet: CSS
// is not counted for any library in this comparison, and importing it for one
// row alone would make that row the only one carrying it. See
// docs/comparison/method.md's "Where each alternative measures smaller, or
// wins on something else" for what excluding CSS costs each row differently.
import { createRoot } from 'react-dom/client';
import { VideoPlayer, VideoSkin, Video } from '@videojs/react/video';

const Fixture = () => (
  <VideoPlayer>
    <VideoSkin>
      <Video src="https://example.com/video.mp4" playsInline />
    </VideoSkin>
  </VideoPlayer>
);

createRoot(document.getElementById('root')!).render(<Fixture />);
