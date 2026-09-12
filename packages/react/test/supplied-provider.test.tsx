// @vitest-environment happy-dom

import { cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import * as Player from '../src/index';
import { createFakeProvider } from './fixtures/fake-provider';

afterEach(() => cleanup());

// No module is mocked here, deliberately, unlike `hls.test.tsx` and its
// siblings: those mock the built-in provider PACKAGE `loadProvider`
// dispatches to, so this file's equivalent is the `providers` prop itself --
// `detect` and `load` below stand in for a real registration the same way an
// inline `providers={{ acme: { detect, load } }}` would in a consumer's own
// app. `Root`, `detectSourceWithProviders`, `loadProvider` and `Media` all run
// for real, so this is the one test in the suite that proves the seam's own
// wiring end to end rather than proving `loadProvider`'s dispatch in
// isolation (`provider-loaders.test.ts`) or an individual link in it.
test('mounts a media div and reaches attach/load for a supplied kind, end to end through Player.Root', async () => {
  const fake = createFakeProvider({ provider: 'native' });
  const detect = vi.fn((url: string) => {
    const match = /^https:\/\/acme\.example\/videos\/([\w-]+)$/.exec(url);
    return match
      ? ({ type: 'acme' as const, videoId: match[1]! } as const)
      : undefined;
  });
  const load = vi.fn(async () => () => fake.adapter);

  render(
    <Player.Root
      loading="eager"
      providers={{ acme: { detect, load } }}
      source="https://acme.example/videos/1"
    >
      <Player.Viewport>
        <Player.Media />
      </Player.Viewport>
    </Player.Root>
  );

  // Neither of the five built-in kinds renders a `<div>` for `Media`'s own
  // sake -- video/hls get a `<video>`, youtube/vimeo/wistia already existed
  // before this feature. This is the mount `viewport-media.tsx`'s new
  // fallback branch adds: a supplied kind's own factory is handed exactly
  // this element as its mount point.
  const mount = await waitFor(() => {
    const node = document.querySelector('[data-playdeck-part="media"]');
    expect(node).not.toBeNull();
    return node as HTMLDivElement;
  });
  expect(mount.tagName).toBe('DIV');

  expect(detect).toHaveBeenCalledWith('https://acme.example/videos/1');
  await waitFor(() => expect(load).toHaveBeenCalledOnce());
  await waitFor(() =>
    expect(fake.counts()).toMatchObject({ attachCount: 1, loadCount: 1 })
  );
});

// The explicit-object counterpart to the test above: `source` is an object of
// the registered `acme` kind rather than a URL, so resolution goes through
// `detectSourceWithProviders`'s object path instead of `detect` -- `detect` is
// still supplied here and is asserted never called, which is what proves this
// end to end rather than merely at the unit level (`provider-loaders.test.ts`
// proves the same claim against `detectSourceWithProviders` directly).
test('mounts and loads a supplied kind from an explicit source object, end to end through Player.Root, without calling detect', async () => {
  const fake = createFakeProvider({ provider: 'native' });
  const detect = vi.fn<
    (url: string) => { type: 'acme'; videoId: string } | undefined
  >(() => undefined);
  const load = vi.fn(async () => () => fake.adapter);

  render(
    <Player.Root
      loading="eager"
      providers={{ acme: { detect, load } }}
      source={{ type: 'acme', videoId: '1' }}
    >
      <Player.Viewport>
        <Player.Media />
      </Player.Viewport>
    </Player.Root>
  );

  await waitFor(() => {
    const node = document.querySelector('[data-playdeck-part="media"]');
    expect(node).not.toBeNull();
  });

  expect(detect).not.toHaveBeenCalled();
  await waitFor(() => expect(load).toHaveBeenCalledOnce());
  await waitFor(() =>
    expect(fake.counts()).toMatchObject({ attachCount: 1, loadCount: 1 })
  );
});
