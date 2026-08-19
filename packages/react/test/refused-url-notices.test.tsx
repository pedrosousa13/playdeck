// @vitest-environment happy-dom

import { act, cleanup, render } from '@testing-library/react';
import { createRef, type ReactNode } from 'react';
import { afterEach, expect, test } from 'vitest';
import { PlayerController } from '@playdeck/core';
import * as Player from '../src/index';
import { createFakeProvider } from './fixtures/fake-provider';

// #330: #320 routed five consumer-supplied URL props through the shared
// allowlist and reported none of them. These cover the detection half at the
// four React sites -- the fifth, `mediaSession artwork`, is bound in core and
// covered by `packages/core/test/media-session.test.ts`.
//
// Both halves are covered across the file rather than in every test: that the
// notice reaches `PlayerState.error`, and that the rendered output is what an
// absent prop produces. Each refusal test asserts both; the two permitted-value
// tests assert only that nothing is published, and the poster rendered outside
// `Player.Root` asserts only the DOM, because there is no controller to read.
// The notice is detection, never a behaviour change (#345).

afterEach(cleanup);

// `PosterImage` is not on the public `Player` namespace's declared surface;
// `index.test.tsx` and `style-precedence.test.tsx` reach for it the same way.
const posterPrimitives = Player as typeof Player & {
  PosterImage: (props: { src?: string; srcSet?: string }) => React.ReactNode;
};

const renderWithPlayer = (ui: ReactNode) => {
  const handle = createRef<Player.PlayerHandle>();
  // Re-wrapped rather than re-rendered bare, so a `rerender` swaps the props
  // under the SAME `Player.Root` and the same controller -- which is the whole
  // point of the withdrawal tests below.
  const wrap = (inner: ReactNode) => (
    <Player.Root loading="eager" ref={handle} source="/tracer.mp4">
      {inner}
      <Player.ErrorDisplay />
    </Player.Root>
  );
  const utils = render(wrap(ui));
  return {
    ...utils,
    rerender: (next: ReactNode) => utils.rerender(wrap(next)),
    controller: handle.current as unknown as PlayerController,
    notice: () => utils.container.querySelector('[data-playdeck-part="notice"]')
  };
};

test('reports a refused poster src while rendering exactly as an absent prop', () => {
  const { PosterImage } = posterPrimitives;
  const { container, controller, notice } = renderWithPlayer(
    <PosterImage src="javascript:alert(1)" />
  );
  const image = container.querySelector('img')!;

  expect(image.getAttribute('src')).toBeNull();
  expect(image.getAttribute('data-state')).toBe('idle');
  expect(controller.getState().error).toMatchObject({
    category: 'configuration',
    fatal: false,
    recoverable: false
  });
  expect(controller.getState().error?.message).toContain('poster src');
  expect(controller.getState().lifecycle).not.toBe('error');
  expect(notice()?.textContent).toContain('poster src');
});

test('reports a refused poster srcSet candidate and keeps the survivors', () => {
  const { PosterImage } = posterPrimitives;
  const { container, controller } = renderWithPlayer(
    <PosterImage srcSet="javascript:alert(1) 1x, /good-2x.jpg 2x" />
  );

  expect(container.querySelector('img')!.getAttribute('srcset')).toBe(
    '/good-2x.jpg 2x'
  );
  expect(controller.getState().error?.message).toContain('srcSet');
});

test('publishes nothing for a poster whose src and srcSet are permitted', () => {
  const { PosterImage } = posterPrimitives;
  const { controller } = renderWithPlayer(
    <PosterImage src="/poster.jpg" srcSet="/poster-2x.jpg 2x" />
  );

  expect(controller.getState().error).toBeNull();
});

// `PosterImage` renders outside `Player.Root` -- `index.test.tsx` renders it
// bare throughout -- so the report has to be optional, not a `usePlayer()`
// that throws where the component used to work (#330).
test('a poster outside Player.Root still refuses the value without throwing', () => {
  const { PosterImage } = posterPrimitives;
  const { container } = render(<PosterImage src="javascript:alert(1)" />);

  expect(container.querySelector('img')!.getAttribute('src')).toBeNull();
});

test('reports a refused nativePoster while omitting the attribute', () => {
  const { container, controller, notice } = renderWithPlayer(
    <Player.Media nativePoster="javascript:alert(1)" />
  );

  expect(container.querySelector('video')!.hasAttribute('poster')).toBe(false);
  expect(controller.getState().error?.message).toContain('nativePoster');
  expect(controller.getState().lifecycle).not.toBe('error');
  expect(notice()?.textContent).toContain('nativePoster');
});

test('reports a refused textTracks src while keeping the permitted tracks', () => {
  const { container, controller } = renderWithPlayer(
    <Player.Media
      textTracks={[
        { src: 'javascript:alert(1)', srcLang: 'en', label: 'English' },
        { src: '/captions/fr.vtt', srcLang: 'fr', label: 'French' }
      ]}
    />
  );
  const tracks = container.querySelectorAll('track');

  expect(tracks.length).toBe(1);
  expect(tracks[0]?.getAttribute('src')).toBe('/captions/fr.vtt');
  expect(controller.getState().error?.message).toContain('textTracks src');
});

// The probe that found #330's own defect: the <img> updated correctly when a
// refused `src` was replaced with a permitted one, but "The poster src URL was
// rejected" stayed on `PlayerState.error` for the controller's life and was
// re-planted by every later `setProvider`. A security notice that is a
// permanent false positive teaches an operator to ignore notices, which defeats
// the A09 monitoring the issue exists to add.
test('withdraws the poster notice once the refused src is replaced with a permitted one', () => {
  const { PosterImage } = posterPrimitives;
  const { container, controller, notice, rerender } = renderWithPlayer(
    <PosterImage src="javascript:alert(1)" />
  );

  expect(controller.getState().error?.message).toContain('poster src');

  rerender(<PosterImage src="/good-poster.jpg" />);

  expect(container.querySelector('img')!.getAttribute('src')).toBe(
    '/good-poster.jpg'
  );
  expect(controller.getState().error).toBeNull();
  expect(notice()).toBeNull();

  // And it stays withdrawn. `setProvider` rebuilds the state from
  // `createInitialPlayerState()` and re-plants whatever configuration the
  // controller still holds, so a notice cleared from the published slot alone
  // would reappear here.
  act(() => controller.setProvider(createFakeProvider().adapter));

  expect(controller.getState().error).toBeNull();
});

test('withdraws the nativePoster notice once the refused value is replaced', () => {
  const { controller, rerender } = renderWithPlayer(
    <Player.Media nativePoster="javascript:alert(1)" />
  );

  expect(controller.getState().error?.message).toContain('nativePoster');

  rerender(<Player.Media nativePoster="/poster.jpg" />);

  expect(controller.getState().error).toBeNull();
});

test('publishes nothing for a Media whose URL props are all permitted', () => {
  const { controller } = renderWithPlayer(
    <Player.Media
      nativePoster="/poster.jpg"
      textTracks={[{ src: '/captions/fr.vtt', srcLang: 'fr', label: 'French' }]}
    />
  );

  expect(controller.getState().error).toBeNull();
});
