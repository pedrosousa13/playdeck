import { createRef } from 'react';
import { cleanup, render } from '@testing-library/react';
import { afterEach, expect, test } from 'vitest';
import type { MediaSessionLike } from '@playdeck/core';
import {
  INTERNAL_CONTROLLER,
  type InternalControllerAccess
} from '../src/internal-controller';
import * as Player from '../src/index';
import { createFakeProvider } from './fixtures/fake-provider';

// `Root`'s media-session effect reaches `bindMediaSession` through a dynamic
// `import()` of `@playdeck/core/media-session`, which these two tests exercise
// against the real module (aliased to source by `vitest.config.ts`, exactly
// as `@playdeck/core/thumbnails` already is) -- not a mock. Binding itself is
// `packages/core/test/media-session.test.ts`'s own, unchanged.

afterEach(() => {
  delete (navigator as unknown as { mediaSession?: unknown }).mediaSession;
  cleanup();
});

type Handlers = Record<
  string,
  ((details: { seekTime?: number; seekOffset?: number }) => void) | null
>;

const createFakeMediaSession = (): {
  session: MediaSessionLike;
  handlers: Handlers;
} => {
  const handlers: Handlers = {};
  const session: MediaSessionLike = {
    metadata: null,
    playbackState: 'none',
    setActionHandler: (action, handler) => {
      handlers[action] = handler;
    }
  };
  return { session, handlers };
};

const controllerOf = (handle: Player.PlayerHandle | null) =>
  (handle as unknown as InternalControllerAccess)[INTERNAL_CONTROLLER];

// A source the shared allowlist refuses outright, so `Root` never attempts a
// real provider load and the controller stays free for this file's own
// `setProvider` calls -- the same isolation `packages/core/test/media-session.test.ts`
// gets for free by never going through `Root` at all.
const REFUSED_SOURCE = 'javascript:alert(1)';

test('binds the media session once the lazy import resolves after mount', async () => {
  const { session, handlers } = createFakeMediaSession();
  Object.defineProperty(navigator, 'mediaSession', {
    configurable: true,
    value: session
  });
  const handle = createRef<Player.PlayerHandle>();
  render(
    <Player.Root loading="eager" ref={handle} source={REFUSED_SOURCE}>
      <Player.Media />
    </Player.Root>
  );
  const controller = controllerOf(handle.current);

  // Lets the dynamic import `Root`'s mount effect started settle: awaiting
  // the same specifier here resolves to the identical cached module, so by
  // the time this resumes, the effect's own `.then()` -- registered first --
  // has already run.
  await import('@playdeck/core/media-session');
  await Promise.resolve();

  const { adapter, emit } = createFakeProvider();
  controller.setProvider(adapter);
  emit({ playback: 'playing' });

  expect(typeof handlers.play).toBe('function');
  expect(session.playbackState).toBe('playing');
});

test('releasing before the media-session import resolves never binds, and leaks nothing', async () => {
  const { session, handlers } = createFakeMediaSession();
  Object.defineProperty(navigator, 'mediaSession', {
    configurable: true,
    value: session
  });
  const handle = createRef<Player.PlayerHandle>();
  const { unmount } = render(
    <Player.Root loading="eager" ref={handle} source={REFUSED_SOURCE}>
      <Player.Media />
    </Player.Root>
  );
  const controller = controllerOf(handle.current);

  // Unmounts synchronously, before the import `Root`'s effect started has
  // had a chance to resolve -- the effect's own cleanup runs here, well
  // before the `await` below ever lets that import settle.
  unmount();

  await import('@playdeck/core/media-session');
  await Promise.resolve();

  // Drives the now-orphaned controller directly, as `media-session.test.ts`
  // drives a bare one: if the resolved import had bound anyway, this is what
  // would reach the stubbed session.
  const { adapter, emit } = createFakeProvider();
  controller.setProvider(adapter);
  emit({ playback: 'playing' });

  expect(handlers.play).toBeUndefined();
  expect(session.playbackState).toBe('none');
  expect(session.metadata).toBeNull();
});
