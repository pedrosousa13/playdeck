// video.js has no official React wrapper (nor a widely-used community one
// still maintained), so a React reader hand-writes this: a ref to a `<video>`
// element, and `videojs()` called on it once after mount. `controls: true` is
// what turns on the library's default skin -- the big play button and the
// control bar drawn by `dist/video.es.js` itself, with no separate package to
// opt into.
//
// That same import -- read from video.js 8.24.0's own `dist/video.es.js` --
// statically pulls in videojs-http-streaming, mux.js, mpd-parser and
// m3u8-parser, video.js's HLS/DASH engine, regardless of whether this page
// ever plays anything but the MP4 URL below. `docs/comparison/method.md`
// records that as measured at that version, not asserted.
import { createRoot } from 'react-dom/client';
import { useEffect, useRef } from 'react';
import videojs from 'video.js';

const Fixture = () => {
  const videoRef = useRef<HTMLVideoElement | null>(null);

  useEffect(() => {
    if (!videoRef.current) return;
    const player = videojs(videoRef.current, {
      controls: true,
      sources: [{ src: 'https://example.com/video.mp4', type: 'video/mp4' }]
    });
    return () => player.dispose();
  }, []);

  return (
    <div data-vjs-player>
      <video ref={videoRef} className="video-js" />
    </div>
  );
};

createRoot(document.getElementById('root')!).render(<Fixture />);
