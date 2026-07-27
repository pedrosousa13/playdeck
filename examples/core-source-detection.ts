import { detectSource } from '@reely/core';

// A URL only resolves if the host, path shape and id are all recognised.
const vimeo = detectSource('https://vimeo.com/76979871?h=8272103f6e');
if (vimeo.status === 'success' && vimeo.source.type === 'vimeo') {
  console.log(vimeo.source.videoId, vimeo.source.hash); // privacy hash kept
}

// Two `v` parameters: ambiguous, so it fails here rather than in a provider.
const ambiguous = detectSource(
  'https://www.youtube.com/watch?v=dQw4w9WgXcQ&v=other'
);
if (ambiguous.status === 'failure') {
  console.log(ambiguous.reason, ambiguous.guidance);
}

// Explicit source objects are validated too, and skip detection.
export const explicit = detectSource({
  type: 'hls',
  src: '/master.m3u8',
  engine: 'hls.js'
});
