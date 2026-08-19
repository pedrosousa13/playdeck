import { readFileSync } from 'node:fs';
import { fileURLToPath, URL } from 'node:url';
import type { Connect, Plugin, PreviewServer, ViteDevServer } from 'vite';

// Deterministic sliding-playlist fixture for ordinary live HLS. A single small
// HTTP endpoint rewrites a media playlist on every request so that the seekable
// window keeps moving: the media sequence advances with wall-clock time, old
// segments fall off the front, and there is never an #EXT-X-ENDLIST tag — which
// is exactly what marks the stream as live to both hls.js and native HLS.
//
// It is intentionally minimal (ordinary live only): fixed 1s segments, a small
// fixed-size window, and one real MPEG-TS segment replayed for every index. It
// is not an LL-HLS or DVR fixture.

const SEGMENT_DURATION_SECONDS = 1;
// A ~20s window: comfortably wider than the provider's 10s at-edge tolerance so
// that a behind-live-edge state is actually reachable. On native HLS the
// seekable range mirrors this playlist window directly, so it must exceed the
// edge threshold for behind-edge seeking to be demonstrable.
const WINDOW_SEGMENTS = 20;

const SEGMENT_PATH = fileURLToPath(
  new URL('../public/hls/v0/seg_000.ts', import.meta.url)
);
const SEGMENT_MATCH = /^\/live\/seg_(\d+)\.ts$/;

const startedAt = Date.now();

// Media sequence derived from elapsed time so the window slides deterministically
// without any mutable server state.
const currentMediaSequence = (): number =>
  Math.floor((Date.now() - startedAt) / (SEGMENT_DURATION_SECONDS * 1000));

const renderPlaylist = (mediaSequence: number): string => {
  const lines = [
    '#EXTM3U',
    '#EXT-X-VERSION:3',
    `#EXT-X-TARGETDURATION:${SEGMENT_DURATION_SECONDS}`,
    `#EXT-X-MEDIA-SEQUENCE:${mediaSequence}`
  ];
  for (let offset = 0; offset < WINDOW_SEGMENTS; offset += 1) {
    lines.push(
      `#EXTINF:${SEGMENT_DURATION_SECONDS.toFixed(6)},`,
      `seg_${mediaSequence + offset}.ts`
    );
  }
  // No #EXT-X-ENDLIST: the absence of it is what keeps the stream live.
  return `${lines.join('\n')}\n`;
};

const handleLive: Connect.NextHandleFunction = (request, response, next) => {
  const path = (request.url ?? '').split('?')[0];
  if (path === '/live/index.m3u8') {
    response.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('Access-Control-Allow-Origin', '*');
    response.end(renderPlaylist(currentMediaSequence()));
    return;
  }
  const segmentMatch = SEGMENT_MATCH.exec(path);
  if (segmentMatch) {
    response.setHeader('Content-Type', 'video/mp2t');
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('Access-Control-Allow-Origin', '*');
    response.end(readFileSync(SEGMENT_PATH));
    return;
  }
  next();
};

// A tiny plugin that mounts the same middleware on the dev server and the
// `vite preview` server, so the fixture is available to Playwright (which drives
// the preview build) and to local `vite dev`.
export const liveHlsFixture = (): Plugin => ({
  name: 'playdeck-live-hls-fixture',
  configureServer(server: ViteDevServer) {
    server.middlewares.use(handleLive);
  },
  configurePreviewServer(server: PreviewServer) {
    server.middlewares.use(handleLive);
  }
});
