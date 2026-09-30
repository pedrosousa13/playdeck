import { parseThumbnailCues, thumbnailCueAt } from '@playdeck/core';

// The seek-preview flavour of WebVTT Vidstack, Media Chrome and Video.js all
// read: each cue's payload is an image URL, optionally carrying a `#xywh=`
// sprite-region fragment.
const vtt = [
  'WEBVTT',
  '',
  '00:00:00.000 --> 00:00:05.000',
  'sprite.jpg#xywh=0,0,160,90',
  '',
  '00:00:05.000 --> 00:00:10.000',
  'sprite.jpg#xywh=160,0,160,90'
].join('\n');

export const cues = parseThumbnailCues(vtt);

// -> { x: 0, y: 0, width: 160, height: 90 } — the fragment resolved to sprite
// pixels, not left as a CSS background-position, and stripped from `url`.
export const firstRegion = cues[0]?.region;

// Cues are matched half-open, `[startTime, endTime)`: 3 lands on the first
// tile, and 5 — the boundary between the two — already lands on the second.
export const atThree = thumbnailCueAt(cues, 3);
export const atFive = thumbnailCueAt(cues, 5);

// A time past every cue matches nothing.
export const none = thumbnailCueAt(cues, 99); // null
