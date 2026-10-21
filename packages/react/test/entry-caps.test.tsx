// @vitest-environment happy-dom
//
// #927: neither `VideoFileSource.sources` nor a text-track list had a length
// cap, and under `loading="eager"` (#911, #913) every entry is server-rendered
// -- an oversized array from bad upstream data costs render time and HTML size
// on every request. These cover the two caps' client-rendered half: that an
// entry past the cap is dropped rather than rendered, that the survivors and
// their order are exactly the first `SOURCES_CAP` / `TEXT_TRACKS_CAP`
// entries, and that each cap publishes a `configuration` notice naming it and
// the count dropped. `eager-video-ssr.test.tsx` covers the server-rendered
// half -- that an oversized array still produces bounded HTML.

import { cleanup, render } from '@testing-library/react';
import { createRef } from 'react';
import { afterEach, expect, test } from 'vitest';
import * as Player from '../src/index';

afterEach(cleanup);

const LegacyRoot = ({ loading = 'eager', ...props }: Player.RootProps) => (
  <Player.Root {...props} loading={loading} />
);

const videoSource = (count: number) => ({
  type: 'video' as const,
  sources: Array.from({ length: count }, (_, index) => ({
    src: `/s${index}.mp4`,
    mimeType: 'video/mp4'
  }))
});

const textTrackList = (count: number) =>
  Array.from({ length: count }, (_, index) => ({
    src: `/t${index}.vtt`,
    srcLang: 'en',
    label: `Track ${index}`
  }));

// Demonstrated red: run against the code as it stood before this commit --
// `VideoFileSource.sources` carried no length cap at all -- this failed:
//
//   expected 33 to be 32 // Object.is equality
//
// (every one of the 33 sources rendered, and `error` was `null`.)
test('drops video sources past the 32-entry cap, keeps the first 32 in order, and publishes a notice', () => {
  const handle = createRef<Player.PlayerHandle>();
  const { container } = render(
    <LegacyRoot ref={handle} source={videoSource(33)}>
      <Player.Media />
    </LegacyRoot>
  );

  const sources = container.querySelectorAll('source');
  expect(sources.length).toBe(32);
  expect(Array.from(sources, (source) => source.getAttribute('src'))).toEqual(
    Array.from({ length: 32 }, (_, index) => `/s${index}.mp4`)
  );
  expect(handle.current?.getState().error).toMatchObject({
    category: 'configuration',
    fatal: false,
    message: expect.stringContaining('32-entry cap')
  });
  expect(handle.current?.getState().error?.message).toContain(
    'the last 1 entry was dropped'
  );
});

// Demonstrated red: before this commit, a text-track list carried no length
// cap either -- this failed:
//
//   expected 129 to be 128 // Object.is equality
test('drops text tracks past the 128-entry cap, keeps the first 128 in order, and publishes a notice', () => {
  const handle = createRef<Player.PlayerHandle>();
  const { container } = render(
    <LegacyRoot ref={handle} source="/tracer.mp4">
      <Player.Media textTracks={textTrackList(129)} />
    </LegacyRoot>
  );

  const tracks = container.querySelectorAll('track');
  expect(tracks.length).toBe(128);
  expect(Array.from(tracks, (track) => track.getAttribute('src'))).toEqual(
    Array.from({ length: 128 }, (_, index) => `/t${index}.vtt`)
  );
  expect(handle.current?.getState().error).toMatchObject({
    category: 'configuration',
    fatal: false,
    message: expect.stringContaining('128-entry cap')
  });
  expect(handle.current?.getState().error?.message).toContain(
    'the last 1 entry was dropped'
  );
});

// The cap is inclusive: exactly `SOURCES_CAP` entries is not past it, so
// nothing is dropped and nothing is published -- the same boundary
// `isValidMediaQuery`'s own length check draws for a single value.
test('renders every source and publishes no notice at exactly the 32-entry cap', () => {
  const handle = createRef<Player.PlayerHandle>();
  const { container } = render(
    <LegacyRoot ref={handle} source={videoSource(32)}>
      <Player.Media />
    </LegacyRoot>
  );

  expect(container.querySelectorAll('source').length).toBe(32);
  expect(handle.current?.getState().error).toBeNull();
});

test('renders every text track and publishes no notice at exactly the 128-entry cap', () => {
  const handle = createRef<Player.PlayerHandle>();
  const { container } = render(
    <LegacyRoot ref={handle} source="/tracer.mp4">
      <Player.Media textTracks={textTrackList(128)} />
    </LegacyRoot>
  );

  expect(container.querySelectorAll('track').length).toBe(128);
  expect(handle.current?.getState().error).toBeNull();
});
