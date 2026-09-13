import { expect, test } from 'vitest';
import Hls from 'hls.js';
import HlsLight from 'hls.js/light';
import {
  hlsBuildSupportsAudioTracks,
  hlsBuildSupportsSubtitles
} from '../src/adapter-values';

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

test('the full build registers the audio-track controller on DefaultConfig', () => {
  expect(typeof Hls.DefaultConfig.audioTrackController).toBe('function');
  expect(hlsBuildSupportsAudioTracks(Hls)).toBe(true);
});

test('the light build ships no audio-track controller, which is what it saves', () => {
  expect(HlsLight.DefaultConfig.audioTrackController).toBeUndefined();
  expect(hlsBuildSupportsAudioTracks(HlsLight)).toBe(false);
});

// Not read by this package, and asserted anyway: EME is the rest of what the
// light build drops alongside subtitles and alternate audio, and a
// capability that comes to depend on it wants this file to already say
// whether it is there.
test('the light build also drops EME alongside subtitles and alternate audio', () => {
  expect(typeof Hls.DefaultConfig.emeController).toBe('function');
  expect(HlsLight.DefaultConfig.emeController).toBeUndefined();
});
