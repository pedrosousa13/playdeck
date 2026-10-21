// @vitest-environment happy-dom
//
// `react-dom/server`'s `renderToString` needs no browser APIs of its own, so
// this runs under the same `happy-dom` environment the hydration half needs
// -- unlike `eager-video-ssr.test.tsx`, which proves the server markup in
// isolation and so runs with no DOM at all.
//
// Demonstrated red: run against the code as it stood before this commit, the
// very first assertion failed --
//
//   expected null not to be null
//
// (`renderToString` produced no `<video>` at all for `loading="eager"`, so
// there was nothing server-rendered to look for, let alone hydrate.)

import { act } from '@testing-library/react';
import { hydrateRoot, type Root } from 'react-dom/client';
import { renderToString } from 'react-dom/server';
import { afterEach, expect, test, vi } from 'vitest';
import * as Player from '../src/index';

const fixture = () => (
  <Player.Root loading="eager" preload="auto" source="/tracer.mp4">
    <Player.Viewport>
      <Player.Media />
    </Player.Viewport>
  </Player.Root>
);

let root: Root | undefined;

afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  document.body.innerHTML = '';
});

test('hydration reuses the server-rendered video element, with no mismatch and no rewrite', () => {
  const markup = renderToString(fixture());
  const container = document.createElement('div');
  container.innerHTML = markup;
  document.body.append(container);

  const serverVideo = container.querySelector('video');
  expect(serverVideo).not.toBeNull();
  const serverSourceSrcs = Array.from(container.querySelectorAll('source')).map(
    (source) => source.getAttribute('src')
  );
  const serverPreload = serverVideo!.getAttribute('preload');

  const onRecoverableError = vi.fn();
  const consoleError = vi
    .spyOn(console, 'error')
    .mockImplementation(() => undefined);

  act(() => {
    root = hydrateRoot(container, fixture(), { onRecoverableError });
  });

  // No hydration mismatch: React reports one two ways -- the
  // `onRecoverableError` callback this root was given, and a `console.error`
  // naming the mismatch -- and a correct hydration triggers neither.
  expect(onRecoverableError).not.toHaveBeenCalled();
  expect(
    consoleError.mock.calls.some(
      ([message]) =>
        typeof message === 'string' &&
        /hydrat|did not match|switched to client rendering/i.test(message)
    )
  ).toBe(false);
  consoleError.mockRestore();

  const hydratedVideo = container.querySelector('video');
  // The same node, not a remount: hydration attaches React's internals to
  // the element the server sent rather than throwing it away and creating a
  // fresh one.
  expect(hydratedVideo).toBe(serverVideo);
  expect(
    Array.from(container.querySelectorAll('source')).map((source) =>
      source.getAttribute('src')
    )
  ).toEqual(serverSourceSrcs);
  expect(hydratedVideo!.getAttribute('preload')).toBe(serverPreload);
});

// #913: a `video` source whose entries carry `media` renders every one of
// them under `loading="eager"` on both passes, server and client alike --
// `sourceCommittedAtRender` reads the same three inputs (`loading`,
// configuration, detected source) on both, so neither ever disagrees with
// the other about which of the two rendering rules applies. A mismatch here
// would mean the client re-filtered down to a `matchMedia`-matching subset
// while the server rendered every entry, which is exactly the two different
// rules this feature adds for the two different cases.
//
// Demonstrated red by a substitute mutation (docs/agents/demonstrated-red.md):
// there is no prior version of this rule to revert to, so `viewport-media.tsx`'s
// `visibleSources` was temporarily changed to always apply the client-created
// filter, never the committed-at-render one. That filter runs during
// `renderToString` too, in this same happy-dom environment, so the mutation
// corrupts the server markup itself, not only the client pass -- recorded:
//
//   expected [ { src: '/desktop.mp4', … } ] to deeply equal
//   [ { src: '/mobile.mp4', media: '(max-width: 600px)' },
//     { src: '/desktop.mp4', media: '(min-width: 601px)' } ]
//
// (`serverSources` held one entry instead of two -- happy-dom's own
// `matchMedia` read `(min-width: 601px)` as matching and `(max-width: 600px)`
// as not, so the committed-at-render rule dropping out lost the mobile entry
// specifically.)
test('hydrates a video source whose entries carry media with no mismatch', () => {
  const mediaFixture = () => (
    <Player.Root
      loading="eager"
      preload="auto"
      source={{
        type: 'video',
        sources: [
          {
            src: '/mobile.mp4',
            mimeType: 'video/mp4',
            media: '(max-width: 600px)'
          },
          {
            src: '/desktop.mp4',
            mimeType: 'video/mp4',
            media: '(min-width: 601px)'
          }
        ]
      }}
    >
      <Player.Viewport>
        <Player.Media />
      </Player.Viewport>
    </Player.Root>
  );

  const markup = renderToString(mediaFixture());
  const container = document.createElement('div');
  container.innerHTML = markup;
  document.body.append(container);

  const serverSources = Array.from(container.querySelectorAll('source')).map(
    (source) => ({
      src: source.getAttribute('src'),
      media: source.getAttribute('media')
    })
  );

  const onRecoverableError = vi.fn();
  const consoleError = vi
    .spyOn(console, 'error')
    .mockImplementation(() => undefined);

  act(() => {
    root = hydrateRoot(container, mediaFixture(), { onRecoverableError });
  });

  expect(onRecoverableError).not.toHaveBeenCalled();
  expect(
    consoleError.mock.calls.some(
      ([message]) =>
        typeof message === 'string' &&
        /hydrat|did not match|switched to client rendering/i.test(message)
    )
  ).toBe(false);
  consoleError.mockRestore();

  expect(
    Array.from(container.querySelectorAll('source')).map((source) => ({
      src: source.getAttribute('src'),
      media: source.getAttribute('media')
    }))
  ).toEqual(serverSources);
  expect(serverSources).toEqual([
    { src: '/mobile.mp4', media: '(max-width: 600px)' },
    { src: '/desktop.mp4', media: '(min-width: 601px)' }
  ]);
});
