import { detectSource, isPermittedSourceUrl } from '@reely/core';

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

// Explicit source objects are validated too, and skip detection: the same
// scheme allowlist runs over their `src` values, so `javascript:` and `data:`
// cannot reach a provider by taking the object path.
export const explicit = detectSource({
  type: 'hls',
  src: '/master.m3u8',
  engine: 'hls.js'
});

// The decision detection consults, should you need to ask it yourself. Pass
// the type of the source the URL belongs to, or `undefined` for a bare string
// no type has been resolved for yet. The type is load-bearing: a `blob:`
// handle is for a video element to read, not for the HLS manifest loader to
// fetch, and never for an undetected string.
const objectUrl = URL.createObjectURL(new Blob([], { type: 'video/mp4' }));
console.log(isPermittedSourceUrl(objectUrl, 'video')); // true
console.log(isPermittedSourceUrl(objectUrl, 'hls')); // false
console.log(isPermittedSourceUrl(objectUrl, undefined)); // false
