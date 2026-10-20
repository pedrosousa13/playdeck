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
