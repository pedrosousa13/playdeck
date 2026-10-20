// @vitest-environment happy-dom
//
// `react-dom/server`'s `renderToString` needs no browser APIs of its own, so
// this runs under the same `happy-dom` environment the hydration half needs
// -- the same split `eager-video-hydration.test.tsx` makes from its own
// `-ssr` counterpart.
//
// What this proves: `root.tsx` renders `priority`'s preload hint as a plain
// `<link>` element rather than calling `react-dom`'s own `preload()`, on the
// claim that React 19 hoists a rendered `<link>` on its own, server and
// client alike -- so hydrating the server markup must report no mismatch
// and leave no duplicate link behind, and a plain client render (no server
// markup to reconcile against) must still place the link in
// `document.head` rather than inline where `Root` mounted.
//
// Demonstrated red: this is additive -- there is no prior commit where
// `priority` rendered a `<link>` for this exact claim to regress from. What
// both tests rule out is the one way this file's own code could get it
// wrong: with `root.tsx`'s preload element built with `rel` left off (the
// one attribute distinguishing it from an ordinary, non-hoistable `<link>`),
// both failed -- the first with a reported hydration mismatch (React's own
// diff names the server's hoisted, attribute-reordered `<link>` against the
// client's plain one, found at the position `Root` mounted it rather than
// hoisted), the second with --
//
//   expected null not to be null
//
// (`document.head.querySelector('link[rel="preload"]')` found nothing --
// React has no reason to hoist a `<link>` it does not recognise as a
// resource) -- both restored with `rel="preload"` put back.

import { act } from '@testing-library/react';
import { createRoot, hydrateRoot, type Root } from 'react-dom/client';
import { renderToString } from 'react-dom/server';
import { afterEach, expect, test, vi } from 'vitest';
import * as Player from '../src/index';

const fixture = () => (
  <Player.Root priority poster="/poster.jpg" source="/tracer.mp4">
    <Player.Viewport>
      <Player.Media />
      <Player.Poster />
    </Player.Viewport>
  </Player.Root>
);

let root: Root | undefined;

afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  document.head.innerHTML = '';
  document.body.innerHTML = '';
});

test('hydrating the server markup reports no mismatch and adds no duplicate preload link', () => {
  const markup = renderToString(fixture());
  const container = document.createElement('div');
  container.innerHTML = markup;
  document.body.append(container);
  // The server markup's own count, before any client code runs -- the
  // baseline the post-hydration count is compared against. `renderToString`
  // renders no `<head>` of its own to hoist into, so these sit inline in
  // `container` exactly where `priority-ssr.test.tsx` pins them; a real
  // `<html>`-rooted stream would have the browser's own parser place them in
  // the real `document.head` before any React code runs at all, which this
  // count stands in for.
  const beforeCount = document.querySelectorAll('link[rel="preload"]').length;
  expect(beforeCount).toBeGreaterThan(0);

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

  // Hydration reused the server-rendered links rather than discarding them
  // and inserting fresh ones alongside.
  expect(document.querySelectorAll('link[rel="preload"]')).toHaveLength(
    beforeCount
  );
});

test('a plain client render (no server markup) still hoists the preload link into document.head', () => {
  const container = document.createElement('div');
  document.body.append(container);

  act(() => {
    root = createRoot(container);
    root.render(fixture());
  });

  expect(document.head.querySelector('link[rel="preload"]')).not.toBeNull();
  expect(container.querySelector('link[rel="preload"]')).toBeNull();
});
