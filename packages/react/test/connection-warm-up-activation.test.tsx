// @vitest-environment happy-dom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { renderToString } from 'react-dom/server';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import * as Player from '../src/index';
import { warmProviderChunk } from '../src/connection-warm-up';

// `preconnectOriginsFor` is left real -- `Root`'s own hint rendering is what
// these tests are checking -- and only `warmProviderChunk` is replaced, the
// same way `activation.test.tsx` replaces `loadProvider` alone and leaves
// `detectSourceWithProviders` real.
vi.mock('../src/connection-warm-up', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/connection-warm-up')>()),
  warmProviderChunk: vi.fn()
}));

// Real attachment is not what any test here is about, including the one
// `loading="eager"` case below -- it is replaced with a promise that never
// settles, the same unresolved shape `activation.test.tsx` already uses
// where a fixture only needs to get past "an attach was asked for" and no
// further.
vi.mock('../src/provider-loaders', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/provider-loaders')>()),
  loadProvider: vi.fn(() => new Promise(() => undefined))
}));

const mockedWarmProviderChunk = vi.mocked(warmProviderChunk);

beforeEach(() => {
  mockedWarmProviderChunk.mockReset();
});

afterEach(() => {
  cleanup();
});

const YOUTUBE_SOURCE = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ';
const VIMEO_SOURCE = 'https://vimeo.com/76979871';

// Resembles a YouTube host closely enough to be a phishing target, but is not
// one `isYouTubeHost` (`@playdeck/core`) recognises -- detection refuses it
// the same way it refuses any other unrecognised host, before `Root`'s own
// hint rendering (`connection-warm-up.ts`'s `preconnectOriginsFor`) is ever
// reached.
const LOOK_ALIKE_SOURCE = 'https://youtube.com.evil.example/watch?v=x';

const fixture = (props: Omit<Player.RootProps, 'children'>) => (
  <Player.Root {...props}>
    <Player.Viewport>
      <Player.Media />
    </Player.Viewport>
  </Player.Root>
);

const interactionFixture = (
  props: Omit<Player.RootProps, 'children' | 'loading'>
) => (
  <Player.Root loading="interaction" {...props}>
    <Player.Viewport>
      <Player.Media />
      <Player.ActivationButton />
    </Player.Viewport>
  </Player.Root>
);

// Every fixture below sets `loading="interaction"` -- nothing about the
// hints depends on when a provider attaches, and `interaction` is what
// keeps each render from ever calling the mocked `loadProvider` at all.
test('warmUp off renders no preconnect hint, server or client, for a hinted provider', () => {
  const markup = renderToString(
    fixture({ loading: 'interaction', source: YOUTUBE_SOURCE })
  );
  expect(markup).not.toContain('rel="preconnect"');

  render(fixture({ loading: 'interaction', source: YOUTUBE_SOURCE }));
  expect(document.querySelector('link[rel="preconnect"]')).toBeNull();
});

test('server-render output is unchanged by warmUp when it is off', () => {
  const withoutProp = renderToString(
    fixture({ loading: 'interaction', source: YOUTUBE_SOURCE })
  );
  const explicitlyOff = renderToString(
    fixture({ loading: 'interaction', source: YOUTUBE_SOURCE, warmUp: false })
  );
  expect(explicitlyOff).toBe(withoutProp);
});

test('warmUp on, no provider poster: renders exactly the two YouTube script/embed origins', () => {
  render(
    fixture({ loading: 'interaction', source: YOUTUBE_SOURCE, warmUp: true })
  );
  const hrefs = [...document.querySelectorAll('link[rel="preconnect"]')].map(
    (link) => link.getAttribute('href')
  );
  expect(hrefs).toEqual([
    'https://www.youtube.com',
    'https://www.youtube-nocookie.com'
  ]);
});

// The poster CDN host is a further opt-in on top of `warmUp` itself --
// `poster="provider"` -- so it joins the hint list only once that is also
// set, never merely because `warmUp` is on.
test('warmUp on with poster="provider": gains the YouTube poster origin', () => {
  render(
    fixture({
      loading: 'interaction',
      poster: 'provider',
      source: YOUTUBE_SOURCE,
      warmUp: true
    })
  );
  const hrefs = [...document.querySelectorAll('link[rel="preconnect"]')].map(
    (link) => link.getAttribute('href')
  );
  expect(hrefs).toEqual([
    'https://www.youtube.com',
    'https://www.youtube-nocookie.com',
    'https://i.ytimg.com'
  ]);
});

test('warmUp on, no provider poster: renders exactly the one Vimeo embed origin', () => {
  render(
    fixture({ loading: 'interaction', source: VIMEO_SOURCE, warmUp: true })
  );
  const hrefs = [...document.querySelectorAll('link[rel="preconnect"]')].map(
    (link) => link.getAttribute('href')
  );
  expect(hrefs).toEqual(['https://player.vimeo.com']);
});

test('warmUp on with poster="provider": gains the Vimeo poster origin', () => {
  render(
    fixture({
      loading: 'interaction',
      poster: 'provider',
      source: VIMEO_SOURCE,
      warmUp: true
    })
  );
  const hrefs = [...document.querySelectorAll('link[rel="preconnect"]')].map(
    (link) => link.getAttribute('href')
  );
  expect(hrefs).toEqual(['https://player.vimeo.com', 'https://i.vimeocdn.com']);
});

test('warmUp on renders no hint for a native source', () => {
  render(
    fixture({ loading: 'interaction', source: '/tracer.mp4', warmUp: true })
  );
  expect(document.querySelector('link[rel="preconnect"]')).toBeNull();
});

// Security acceptance: a look-alike host earns no hint even with warmUp on,
// because the allowlist is read off the detected provider kind rather than
// the consumer's own URL, and this host is never detected as a provider at
// all.
test('warmUp on renders no hint for a look-alike host', () => {
  render(
    fixture({ loading: 'interaction', source: LOOK_ALIKE_SOURCE, warmUp: true })
  );
  expect(document.querySelector('link[rel="preconnect"]')).toBeNull();
});

test('warmUp off: hovering or focusing the activation button never warms the chunk', () => {
  render(interactionFixture({ source: YOUTUBE_SOURCE }));
  const button = screen.getByRole('button', { name: 'Play video' });

  fireEvent.pointerEnter(button, { pointerType: 'mouse' });
  fireEvent.focus(button);

  expect(mockedWarmProviderChunk).not.toHaveBeenCalled();
});

test('warmUp on: the first pointer-enter from a real pointer warms the chunk exactly once', () => {
  render(interactionFixture({ source: YOUTUBE_SOURCE, warmUp: true }));
  const button = screen.getByRole('button', { name: 'Play video' });

  fireEvent.pointerEnter(button, { pointerType: 'mouse' });
  fireEvent.pointerLeave(button);
  fireEvent.pointerEnter(button, { pointerType: 'mouse' });

  expect(mockedWarmProviderChunk).toHaveBeenCalledOnce();
  expect(mockedWarmProviderChunk).toHaveBeenCalledWith('youtube');
});

test('warmUp on: a touch pointer-enter alone never warms the chunk', () => {
  render(interactionFixture({ source: YOUTUBE_SOURCE, warmUp: true }));
  const button = screen.getByRole('button', { name: 'Play video' });

  fireEvent.pointerEnter(button, { pointerType: 'touch' });

  expect(mockedWarmProviderChunk).not.toHaveBeenCalled();
});

test('warmUp on: focus alone warms the chunk exactly once', () => {
  render(interactionFixture({ source: YOUTUBE_SOURCE, warmUp: true }));
  const button = screen.getByRole('button', { name: 'Play video' });

  fireEvent.focus(button);
  fireEvent.blur(button);
  fireEvent.focus(button);

  expect(mockedWarmProviderChunk).toHaveBeenCalledOnce();
  expect(mockedWarmProviderChunk).toHaveBeenCalledWith('youtube');
});

// `fixture` alone renders no `ActivationButton` at all, so a test built on
// it could never exercise this guard regardless of what the component does
// -- the same trap `docs/agents/demonstrated-red.md` warns against. This
// mounts the component directly, under `loading="eager"`, so the assertion
// is actually about `ActivationButton`'s own early return and not about
// whether the fixture happens to render one.
test('warmUp on, loading eager: ActivationButton renders nothing to warm from', () => {
  render(
    <Player.Root loading="eager" source={YOUTUBE_SOURCE} warmUp>
      <Player.Viewport>
        <Player.Media />
        <Player.ActivationButton />
      </Player.Viewport>
    </Player.Root>
  );
  expect(screen.queryByRole('button')).toBeNull();
  expect(mockedWarmProviderChunk).not.toHaveBeenCalled();
});
