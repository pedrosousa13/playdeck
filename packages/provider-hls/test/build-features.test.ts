import { expect, test } from 'vitest';
import Hls from 'hls.js';
import HlsLight from 'hls.js/light';
import { hlsBuildSupportsSubtitles } from '../src/adapter-values';

// The one assumption `hlsBuildSupportsSubtitles` rests on, checked against the
// installed hls.js rather than against a fake of it. Everything else about the
// light build is exercised through `FakeHls.DefaultConfig`, which can only
// prove the adapter reads the field correctly -- not that the field still says
// what this package believes it says.
//
// It is the kind of claim that goes stale silently. If hls.js ever moved its
// controller registration off `DefaultConfig`, both builds would read as
// capable, the light build would go back to reporting `unknown` forever, and
// nothing here would have failed. This is what fails instead, on the upgrade
// that did it.

test('the full build registers the subtitle controller on DefaultConfig', () => {
  expect(typeof Hls.DefaultConfig.subtitleTrackController).toBe('function');
  expect(hlsBuildSupportsSubtitles(Hls)).toBe(true);
});

test('the light build ships no subtitle controller, which is what it saves', () => {
  expect(HlsLight.DefaultConfig.subtitleTrackController).toBeUndefined();
  expect(hlsBuildSupportsSubtitles(HlsLight)).toBe(false);
});

// Not read by this package, and asserted anyway: they are the rest of what the
// light build drops, and a capability that comes to depend on any of them wants
// this file to already say whether it is there. Alternate audio is the live one
// -- `PlayerCapabilities` has no audio-track member today, and would need this
// same discrimination on the day it gains one.
test('the light build drops alternate audio and EME alongside subtitles', () => {
  expect(typeof Hls.DefaultConfig.audioTrackController).toBe('function');
  expect(typeof Hls.DefaultConfig.emeController).toBe('function');
  expect(HlsLight.DefaultConfig.audioTrackController).toBeUndefined();
  expect(HlsLight.DefaultConfig.emeController).toBeUndefined();
});
