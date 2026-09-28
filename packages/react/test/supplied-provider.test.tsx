// @vitest-environment happy-dom

import { act, cleanup, render, waitFor } from '@testing-library/react';
import { Component, createRef, type ReactNode } from 'react';
import { afterEach, expect, test, vi } from 'vitest';
import type {
  CommandResult,
  ProviderAdapter,
  ProviderEvent,
  ProviderStateListener,
  ProviderStatePatch
} from '@playdeck/core';
import { captureRethrows } from '@playdeck/test-support/capture-rethrows';
import * as Player from '../src/index';
import {
  INTERNAL_CONTROLLER,
  type InternalControllerAccess
} from '../src/internal-controller';
import { createFakeProvider } from './fixtures/fake-provider';

// A supplied kind's factory can return a class instance -- `ProviderAdapter`
// is structural, so nothing forbids it (#799). `#playCount` is a genuine
// private instance field, readable only through `this` inside `play()`, so
// this class stands in for the shape the issue is about: a method that
// throws unless it runs with the exact instance that declared the field as
// its receiver, whether or not the object reaching it still has that method
// at all.
class ClassAdapter {
  readonly provider = 'native' as const;
  attachCount = 0;
  loadCount = 0;
  #listeners = new Set<ProviderStateListener>();
  #playCount = 0;
  #destroyCount = 0;
  #muted = false;
  #volume = 1;
  #playbackRate = 1;

  attach(): void {
    this.attachCount += 1;
  }

  load(): void {
    this.loadCount += 1;
  }

  destroy(): void {
    this.#destroyCount += 1;
  }

  subscribe(listener: ProviderStateListener): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  async play(): Promise<CommandResult> {
    this.#playCount += 1;
    return { ok: true };
  }

  async mute(): Promise<CommandResult> {
    this.#muted = true;
    return { ok: true };
  }

  async unmute(): Promise<CommandResult> {
    this.#muted = false;
    return { ok: true };
  }

  async setVolume(volume: number): Promise<CommandResult> {
    this.#volume = volume;
    return { ok: true };
  }

  async setPlaybackRate(rate: number): Promise<CommandResult> {
    this.#playbackRate = rate;
    return { ok: true };
  }

  get playCount(): number {
    return this.#playCount;
  }

  get destroyCount(): number {
    return this.#destroyCount;
  }

  get muted(): boolean {
    return this.#muted;
  }

  get volume(): number {
    return this.#volume;
  }

  get playbackRate(): number {
    return this.#playbackRate;
  }

  emit(patch: ProviderStatePatch, event?: ProviderEvent): void {
    this.#listeners.forEach((listener) => listener(patch, event));
  }
}

// A frozen adapter is a plausible consumer pattern -- `Object.freeze` over
// the returned object literal, the way a factory guarding against a caller
// mutating its adapter after the fact would write it. Every own property of
// a frozen object is non-configurable and non-writable, which is a
// different constraint than `ClassAdapter`'s prototype methods above: a
// `Proxy` whose target is the frozen adapter itself is bound by the spec to
// report exactly that property's own value back, and a bound function is
// never that same value, however faithfully it behaves.
const createFrozenAdapter = () => {
  let attachCount = 0;
  let loadCount = 0;
  let playCount = 0;
  const listeners = new Set<ProviderStateListener>();
  const adapter: ProviderAdapter = Object.freeze({
    provider: 'native' as const,
    attach: () => {
      attachCount += 1;
    },
    load: () => {
      loadCount += 1;
    },
    destroy: () => undefined,
    subscribe: (listener: ProviderStateListener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    play: async (): Promise<CommandResult> => {
      playCount += 1;
      return { ok: true };
    }
  });
  return {
    adapter,
    counts: () => ({ attachCount, loadCount, playCount }),
    emit: (patch: ProviderStatePatch, event?: ProviderEvent): void => {
      listeners.forEach((listener) => listener(patch, event));
    }
  };
};

// Drives a fresh `ClassAdapter` instance through attach, load, ready, every
// optional command the brief names (play, mute, unmute, setVolume,
// setPlaybackRate) and unmount, under either loading strategy -- so the two
// tests that call this differ only in how each reaches `ready` and issues
// `play`, and share every other assertion, which is what proves parity
// between the queued-play branch (`loading="interaction"`) and the
// unwrapped one (`loading="eager"`) rather than merely asserting each in
// isolation.
const driveClassAdapterLifecycle = async (
  loading: 'eager' | 'interaction'
): Promise<void> => {
  const instance = new ClassAdapter();
  const load = vi.fn(async () => () => instance);
  const handle = createRef<Player.PlayerHandle>();

  const { unmount } = render(
    <Player.Root
      loading={loading}
      providers={{ acme: { detect: vi.fn(), load } }}
      ref={handle}
      source={{ type: 'acme', videoId: '1' }}
    >
      <Player.Viewport>
        <Player.Media />
      </Player.Viewport>
    </Player.Root>
  );

  if (loading === 'interaction') {
    act(() => handle.current?.activateFromInteraction());
  }

  await waitFor(() => expect(instance.attachCount).toBe(1));
  await waitFor(() => expect(instance.loadCount).toBe(1));

  act(() => instance.emit({ activation: 'ready', lifecycle: 'ready' }));

  if (loading === 'interaction') {
    // The queued play `activateFromInteraction` armed fires on its own once
    // `load()` and readiness both land, so `play` is proven by that alone --
    // an explicit call here would double it up.
    await waitFor(() => expect(instance.playCount).toBe(1));
  } else {
    await act(async () => {
      await handle.current?.play();
    });
    await waitFor(() => expect(instance.playCount).toBe(1));
  }

  await act(async () => {
    await handle.current?.mute();
  });
  await waitFor(() => expect(instance.muted).toBe(true));

  await act(async () => {
    await handle.current?.unmute();
  });
  await waitFor(() => expect(instance.muted).toBe(false));

  await act(async () => {
    await handle.current?.setVolume(0.4);
  });
  await waitFor(() => expect(instance.volume).toBe(0.4));

  await act(async () => {
    await handle.current?.setPlaybackRate(1.5);
  });
  await waitFor(() => expect(instance.playbackRate).toBe(1.5));

  act(() => unmount());
  expect(instance.destroyCount).toBe(1);
};

// A minimal boundary for the one test below that needs to prove no error
// reaches it: `getDerivedStateFromError` is the only way to observe that
// React actually caught something, and rendering `null` once it has is what
// keeps a caught error from also failing the test through an unrelated
// console assertion.
class RecordingErrorBoundary extends Component<
  { children: ReactNode },
  { caught: boolean }
> {
  state: { caught: boolean } = { caught: false };
  static getDerivedStateFromError(): { caught: boolean } {
    return { caught: true };
  }
  render(): ReactNode {
    return this.state.caught ? null : this.props.children;
  }
}

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
//
// Demonstrated red (docs/agents/demonstrated-red.md's fallback: the feature
// is additive, so a substitute mutation stands in for reverting it).
// `detectSourceWithProviders` (`provider-loaders.ts`) short-circuited to
// `return builtin;` before ever consulting `providers`, run with
// `pnpm vitest run packages/react/test/supplied-provider.test.tsx`: all
// three tests below failed -- the first two on a `waitFor` timeout (no
// `[data-playdeck-part="media"]` node ever appears, `detectSourceWithProviders`
// never resolving the supplied kind), the third on `expect(node).not.toBeNull()`
// finding only the viewport, no media mount underneath it. Reverted
// afterwards.
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

// The render-level counterpart of `provider-loaders.test.ts`'s "refuses a
// source object whose own toJSON would throw" -- proven here through
// `Player.Root` itself, which is where #754's defect 4 actually bit:
// `use-activation.ts`'s `sourceKey` calls `JSON.stringify(source.source)`
// during render, inside `Root`'s own `useMemo`. Before the copy in
// `detectSourceWithProviders`'s explicit-object branch, a `toJSON` that
// throws passed `everyStringPermitted` untouched -- a function value matches
// neither of its two branches and falls through to its default `true` -- so
// the unchanged source reached `sourceKey` and `JSON.stringify` threw
// synchronously out of render. The copy now refuses the whole source before
// `sourceKey` ever sees it, so this source is reported as an ordinary
// refused source instead.
//
// Demonstrated red (docs/agents/demonstrated-red.md): against the unfixed
// code, this test's own `waitFor` timed out -- `handle.current?.getState()`
// never reached `activation: 'error'` -- because the render itself threw
// inside `useActivation` (`TypeError: toJSON blew up` reached
// `RecordingErrorBoundary`, and `getState()` kept reading the boundary's own
// fallback `null` render instead), run with
// `pnpm vitest run packages/react/test/supplied-provider.test.tsx -t "toJSON"`.
test('a throwing toJSON on an explicit supplied-kind source object refuses the source instead of throwing out of render', async () => {
  const handle = createRef<Player.PlayerHandle>();
  const load = vi.fn();

  render(
    <RecordingErrorBoundary>
      <Player.Root
        loading="eager"
        providers={{ acme: { detect: vi.fn(), load } }}
        ref={handle}
        source={
          {
            type: 'acme',
            videoId: '1',
            toJSON() {
              throw new Error('toJSON blew up');
            }
          } as never
        }
      >
        <Player.Viewport>
          <Player.Media />
        </Player.Viewport>
      </Player.Root>
    </RecordingErrorBoundary>
  );

  await waitFor(() =>
    expect(handle.current?.getState()).toMatchObject({
      activation: 'error',
      error: { category: 'unsupported' }
    })
  );
  expect(load).not.toHaveBeenCalled();
  expect(document.querySelector('[data-playdeck-part="media"]')).toBeNull();
});

// The render-level counterpart of `provider-loaders.test.ts`'s own
// throwing-getter test, and the reason #754's review asked for one: `Root`'s
// `useMemo` reads fields off `source` during render (core's own
// `detectSource`, then `detectSourceWithProviders`'s explicit-object
// branch), so a getter that throws on an ordinary data property used to
// throw synchronously out of render, before `copySuppliedSourceObject`'s own
// `try`/`catch` (`provider-loaders.ts`) existed to catch it.
//
// Demonstrated red (docs/agents/demonstrated-red.md): against the unfixed
// code, this test's own `waitFor` timed out -- `RecordingErrorBoundary`
// caught the throw and `handle.current?.getState()` kept reading the
// boundary's own fallback `null` render instead of ever reaching
// `activation: 'error'` -- run with
// `pnpm vitest run packages/react/test/supplied-provider.test.tsx -t "throwing getter"`.
test('a throwing getter on an explicit supplied-kind source object refuses the source instead of throwing out of render', async () => {
  const handle = createRef<Player.PlayerHandle>();
  const load = vi.fn();
  const source: Record<string, unknown> = { type: 'acme', videoId: '1' };
  Object.defineProperty(source, 'url', {
    enumerable: true,
    get(): never {
      throw new Error('getter blew up');
    }
  });

  render(
    <RecordingErrorBoundary>
      <Player.Root
        loading="eager"
        providers={{ acme: { detect: vi.fn(), load } }}
        ref={handle}
        source={source as never}
      >
        <Player.Viewport>
          <Player.Media />
        </Player.Viewport>
      </Player.Root>
    </RecordingErrorBoundary>
  );

  await waitFor(() =>
    expect(handle.current?.getState()).toMatchObject({
      activation: 'error',
      error: { category: 'unsupported' }
    })
  );
  expect(load).not.toHaveBeenCalled();
  expect(document.querySelector('[data-playdeck-part="media"]')).toBeNull();
});

// The render-level counterpart of `provider-loaders.test.ts`'s own
// Map/Set/symbol/bigint sweep, proving the issue's own acceptance criterion
// "including from sourceKey" against the real function rather than by
// inspection: `use-activation.ts`'s `sourceKey` runs on whatever
// `detectSourceWithProviders` returns on every real `Root` render, and a
// refused result never reaches its `JSON.stringify` branch at all -- this is
// what actually proves that, rather than reasoning about it.
test('an explicit supplied-kind source object carrying a bigint refuses the source instead of throwing out of render', async () => {
  const handle = createRef<Player.PlayerHandle>();
  const load = vi.fn();

  render(
    <Player.Root
      loading="eager"
      providers={{ acme: { detect: vi.fn(), load } }}
      ref={handle}
      source={{ type: 'acme', videoId: '1', count: 1n } as never}
    >
      <Player.Viewport>
        <Player.Media />
      </Player.Viewport>
    </Player.Root>
  );

  await waitFor(() =>
    expect(handle.current?.getState()).toMatchObject({
      activation: 'error',
      error: { category: 'unsupported' }
    })
  );
  expect(load).not.toHaveBeenCalled();
  expect(document.querySelector('[data-playdeck-part="media"]')).toBeNull();
});

// The render-level counterpart of `provider-loaders.test.ts`'s own diamond
// tests, and the reason the copy itself bounding its own total size (rather
// than memoising a diamond's shared object) matters beyond the copy: a copy
// that preserved a diamond's sharing would still reach `use-activation.ts`'s
// `sourceKey`, which calls `JSON.stringify(source.source)` on every render,
// and `JSON.stringify` does not deduplicate a shared reference -- it
// serialises every path to it -- so the exponential cost the copy's own node
// budget exists to avoid would simply move one call downstream, into render,
// rather than disappear. A chain this deep is past that budget
// (`MAX_SUPPLIED_SOURCE_NODES`, `provider-loaders.ts`), so it is refused --
// the assertion here is that refusing it is prompt, not that it mounts.
//
// Demonstrated red (docs/agents/demonstrated-red.md): against f43c79b, whose
// copy memoised a diamond's shared object instead of bounding total size,
// this test hung for the entire run -- `Error: Test timed out in 5000ms.`,
// reported only once the render's own synchronous work (inside
// `JSON.stringify`, over the memoised, shared-reference copy) actually
// finished and returned control, 32391ms in, run with
// `pnpm vitest run packages/react/test/supplied-provider.test.tsx -t "diamond chain"`.
// A second red, once the node budget alone had replaced the memo: this same
// test failed with `RangeError: Invalid array length` thrown from
// `echoSource` (`use-activation.ts`) -- the copy now correctly refused the
// chain, but building the refusal's own message called `JSON.stringify` on
// the caller's original, still fully shared, object, and the resulting
// string was too long for `Array.from` to index by code point. Fixed by
// bounding `echoSource`'s own `JSON.stringify` call with a node-counting
// replacer, the same technique `copySuppliedSourceValue`'s budget uses.
test('refuses an explicit source object whose nested object is a diamond chain past the node budget, promptly rather than after exponential blowup', async () => {
  const handle = createRef<Player.PlayerHandle>();
  const load = vi.fn();
  const detect = vi.fn();

  let next: Record<string, unknown> = { leaf: true };
  for (let level = 0; level < 24; level++) {
    next = { l: next, r: next };
  }
  const source = { type: 'acme', videoId: '1', chain: next };

  render(
    <Player.Root
      loading="eager"
      providers={{ acme: { detect, load } }}
      ref={handle}
      source={source as never}
    >
      <Player.Viewport>
        <Player.Media />
      </Player.Viewport>
    </Player.Root>
  );

  await waitFor(() =>
    expect(handle.current?.getState()).toMatchObject({
      activation: 'error',
      error: { category: 'unsupported' }
    })
  );
  expect(detect).not.toHaveBeenCalled();
  expect(load).not.toHaveBeenCalled();
  expect(document.querySelector('[data-playdeck-part="media"]')).toBeNull();
}, 2000);

// The render-level counterpart of `provider-loaders.test.ts`'s
// `refuses a detect return carrying a forbidden scheme nested inside it, and
// continues to a later registration` -- proven here through `Player.Root`
// itself rather than against `detectSourceWithProviders` directly, so it is a
// claim about what a consumer of the real `providers` prop actually sees: a
// registration whose `detect` returns a value with a forbidden scheme nested
// inside it never gets that value acted on, and a later registration that
// would have matched the same URL honestly still mounts and loads.
test('skips a registration whose detect returns a forbidden nested scheme and mounts the next one that matches honestly', async () => {
  const fake = createFakeProvider({ provider: 'native' });
  const dishonest = vi.fn(() => ({
    type: 'acme',
    config: { url: 'javascript:alert(1)' }
  }));
  const honestLoad = vi.fn(async () => () => fake.adapter);
  const honest = vi.fn(() => ({ type: 'other', videoId: '1' }) as const);

  render(
    <Player.Root
      loading="eager"
      providers={{
        acme: { detect: dishonest, load: vi.fn() },
        other: { detect: honest, load: honestLoad }
      }}
      source="https://example.com/media/1"
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

  expect(dishonest).toHaveBeenCalledWith('https://example.com/media/1');
  expect(honest).toHaveBeenCalledWith('https://example.com/media/1');
  await waitFor(() => expect(honestLoad).toHaveBeenCalledOnce());
  await waitFor(() =>
    expect(fake.counts()).toMatchObject({ attachCount: 1, loadCount: 1 })
  );
});

// The render-level counterpart of `provider-loaders.test.ts`'s
// `treats a detect that throws as a decline and continues to the next
// registration`: `detectSourceWithProviders` runs inside `root.tsx`'s own
// `useMemo`, so an uncontained throw there would escape render and reach the
// nearest error boundary, or unmount the whole root, on every keystroke of a
// URL an attacker can put in `source` (#753). `RecordingErrorBoundary` proves
// the boundary is never even reached: the player still mounts and loads
// through the second, honest registration.
test('treats a supplied detect that throws as a decline: the player renders and no error reaches an error boundary', async () => {
  const rethrows = captureRethrows();
  const fake = createFakeProvider({ provider: 'native' });
  const boom = new Error('detect blew up');
  const thrower = vi.fn(() => {
    throw boom;
  });
  const honestLoad = vi.fn(async () => () => fake.adapter);
  const honest = vi.fn(() => ({ type: 'other', videoId: '1' }) as const);

  render(
    <RecordingErrorBoundary>
      <Player.Root
        loading="eager"
        providers={{
          acme: { detect: thrower, load: vi.fn() },
          other: { detect: honest, load: honestLoad }
        }}
        source="https://example.com/media/1"
      >
        <Player.Viewport>
          <Player.Media />
        </Player.Viewport>
      </Player.Root>
    </RecordingErrorBoundary>
  );

  await waitFor(() => {
    const node = document.querySelector('[data-playdeck-part="media"]');
    expect(node).not.toBeNull();
  });

  expect(thrower).toHaveBeenCalledWith('https://example.com/media/1');
  expect(honest).toHaveBeenCalledWith('https://example.com/media/1');
  await waitFor(() => expect(honestLoad).toHaveBeenCalledOnce());
  await waitFor(() =>
    expect(fake.counts()).toMatchObject({ attachCount: 1, loadCount: 1 })
  );
  expect(document.querySelector('[data-playdeck-part="media"]')).not.toBeNull();

  // Not silently lost even here, end to end through `Player.Root`.
  await Promise.resolve();
  expect(rethrows).toEqual([boom]);
});

// A supplied kind's own providerOptions bag is compared the same way the
// four built-in bags are, the equivalent of `hls.test.tsx`'s and
// `vimeo.test.tsx`'s dedicated remount regression for a supplied kind's own
// bag: `providerOptionsEqual` (`use-activation.ts`) compares every bag it
// knows about generically, keyed by name, so a supplied kind's own key gets
// the same by-value comparison the four built-in bags do -- proven here
// through a `Player.Root` rerender rather than only at
// `provider-loaders.test.ts`'s unit level. Confirmed by adding
// `if (key === 'acme') continue;` at the top of `providerOptionsEqual`'s own
// key loop and running
// `pnpm vitest run packages/react/test/supplied-provider.test.tsx`: this test
// failed, because the second render was then judged equal to the first and
// the factory was never called again -- reverted afterwards.
test('re-attaches a supplied kind when its own providerOptions key changes', async () => {
  const fakes: ReturnType<typeof createFakeProvider>[] = [];
  const factory = vi.fn(
    (
      mount: HTMLVideoElement | HTMLDivElement | null,
      source: { type: 'acme'; videoId: string },
      options?: { quality?: 'sd' | 'hd' }
    ) => {
      void mount;
      void source;
      void options;
      const fake = createFakeProvider({ provider: 'native' });
      fakes.push(fake);
      return fake.adapter;
    }
  );
  const load = vi.fn(async () => factory);

  const { rerender } = render(
    <Player.Root
      loading="eager"
      providerOptions={{ acme: { quality: 'sd' } }}
      providers={{ acme: { detect: vi.fn(), load } }}
      source={{ type: 'acme', videoId: '1' }}
    >
      <Player.Viewport>
        <Player.Media />
      </Player.Viewport>
    </Player.Root>
  );

  await waitFor(() => expect(factory).toHaveBeenCalledTimes(1));
  expect(factory.mock.calls[0]![2]).toMatchObject({ quality: 'sd' });

  rerender(
    <Player.Root
      loading="eager"
      providerOptions={{ acme: { quality: 'hd' } }}
      providers={{ acme: { detect: vi.fn(), load } }}
      source={{ type: 'acme', videoId: '1' }}
    >
      <Player.Viewport>
        <Player.Media />
      </Player.Viewport>
    </Player.Root>
  );

  await waitFor(() => expect(factory).toHaveBeenCalledTimes(2));
  expect(factory.mock.calls[1]![2]).toMatchObject({ quality: 'hd' });
  await waitFor(() => expect(fakes[0]!.counts().destroyCount).toBe(1));
});

// #752, end to end: a supplied kind's own `providerOptions` bag used to reach
// the registration's factory unfiltered, so a `javascript:` value written
// there -- exactly where `docs/provider-setup.md`'s worked example carries a
// playback URL -- had no gate between an attacker-controlled field and
// whatever the adapter does with it (an `iframe.src` write, for one, executes
// in the embedding origin). Proven here through `Player.Root` itself, not
// only at `provider-loaders.test.ts`'s unit level, so this is a claim about
// what a consumer's own `providerOptions` prop actually reaches and what
// `PlayerState.error` actually reports.
test('reports a refused supplied-kind provider option through PlayerState.error while the factory still loads without it', async () => {
  const fake = createFakeProvider({ provider: 'native' });
  const factory = vi.fn(
    (
      mount: HTMLVideoElement | HTMLDivElement | null,
      source: { type: 'acme'; videoId: string },
      options?: { src?: string }
    ) => {
      void mount;
      void source;
      void options;
      return fake.adapter;
    }
  );
  const load = vi.fn(async () => factory);
  const handle = createRef<Player.PlayerHandle>();

  render(
    <Player.Root
      loading="eager"
      providerOptions={{ acme: { src: 'javascript:alert(1)' } }}
      providers={{ acme: { detect: vi.fn(), load } }}
      ref={handle}
      source={{ type: 'acme', videoId: '1' }}
    >
      <Player.Viewport>
        <Player.Media />
      </Player.Viewport>
    </Player.Root>
  );

  await waitFor(() => expect(factory).toHaveBeenCalledOnce());
  expect(factory.mock.calls[0]![2]).toEqual({});

  const controller = (handle.current as unknown as InternalControllerAccess)[
    INTERNAL_CONTROLLER
  ];
  await waitFor(() =>
    expect(controller.getState().error?.message).toContain('providerOptions')
  );
});

// #752's own notice-lifecycle guarantee: a `providerOptions` refusal is
// withdrawn the way every other refused-URL notice is, not carried forever
// (`useRefusedUrlReport`'s own doc comment, `player-context.ts`) -- fixing
// the option a consumer set has to clear the operator-facing error. This
// hook has no per-render boolean to key a `useRefusedUrlReport` call on (the
// bag is only read inside the async load itself), so `use-activation.ts`
// disposes its own registration by hand at the start of every load; this is
// what proves that bookkeeping actually withdraws rather than leaking a
// notice for a fixed value forever.
test('clears the providerOptions notice once a refused option is replaced with a permitted one, on a later load', async () => {
  const fakes: ReturnType<typeof createFakeProvider>[] = [];
  const factory = vi.fn(
    (
      mount: HTMLVideoElement | HTMLDivElement | null,
      source: { type: 'acme'; videoId: string },
      options?: { src?: string }
    ) => {
      void mount;
      void source;
      void options;
      const fake = createFakeProvider({ provider: 'native' });
      fakes.push(fake);
      return fake.adapter;
    }
  );
  const load = vi.fn(async () => factory);
  const handle = createRef<Player.PlayerHandle>();

  const { rerender } = render(
    <Player.Root
      loading="eager"
      providerOptions={{ acme: { src: 'javascript:alert(1)' } }}
      providers={{ acme: { detect: vi.fn(), load } }}
      ref={handle}
      source={{ type: 'acme', videoId: '1' }}
    >
      <Player.Viewport>
        <Player.Media />
      </Player.Viewport>
    </Player.Root>
  );

  const controller = (handle.current as unknown as InternalControllerAccess)[
    INTERNAL_CONTROLLER
  ];
  await waitFor(() => expect(factory).toHaveBeenCalledOnce());
  await waitFor(() =>
    expect(controller.getState().error?.message).toContain('providerOptions')
  );

  rerender(
    <Player.Root
      loading="eager"
      providerOptions={{ acme: { src: 'https://good.example/clip.mp4' } }}
      providers={{ acme: { detect: vi.fn(), load } }}
      ref={handle}
      source={{ type: 'acme', videoId: '1' }}
    >
      <Player.Viewport>
        <Player.Media />
      </Player.Viewport>
    </Player.Root>
  );

  await waitFor(() => expect(factory).toHaveBeenCalledTimes(2));
  expect(factory.mock.calls[1]![2]).toEqual({
    src: 'https://good.example/clip.mp4'
  });
  await waitFor(() => expect(controller.getState().error).toBeNull());
});

// The other direction the same bookkeeping has to answer: a source change
// away from the refusing supplied kind entirely, onto one of the five
// built-in kinds, still starts a fresh load -- and every load disposes the
// previous `providerOptions` registration unconditionally before deciding
// whether to make a new one (`use-activation.ts`). A built-in kind's own
// `loadProvider` branch never calls back into that registration at all, so
// the notice has to come back to null rather than survive the switch.
test('clears the providerOptions notice when the source changes to a built-in kind', async () => {
  const factory = vi.fn(
    () => createFakeProvider({ provider: 'native' }).adapter
  );
  const load = vi.fn(async () => factory);
  const handle = createRef<Player.PlayerHandle>();

  const { rerender } = render(
    <Player.Root
      loading="eager"
      providerOptions={{ acme: { src: 'javascript:alert(1)' } }}
      providers={{ acme: { detect: vi.fn(), load } }}
      ref={handle}
      source={{ type: 'acme', videoId: '1' }}
    >
      <Player.Viewport>
        <Player.Media />
      </Player.Viewport>
    </Player.Root>
  );

  const controller = (handle.current as unknown as InternalControllerAccess)[
    INTERNAL_CONTROLLER
  ];
  await waitFor(() => expect(factory).toHaveBeenCalledOnce());
  await waitFor(() =>
    expect(controller.getState().error?.message).toContain('providerOptions')
  );

  rerender(
    <Player.Root loading="eager" ref={handle} source="/tracer.mp4">
      <Player.Viewport>
        <Player.Media />
      </Player.Viewport>
    </Player.Root>
  );

  await waitFor(() => expect(controller.getState().error).toBeNull());
});

// #799: the queued-play branch -- taken here because `activateFromInteraction`
// queues a play the way a click on `Player.ActivationButton` does -- used to
// hand `setProvider` `{ ...adapter, load: ... }`. A class instance's own
// methods live on its prototype, which a spread never copies, so `attach`,
// `destroy`, `subscribe` and every optional command were silently absent
// from the copy whenever a supplied kind's factory returned an instance of
// `ClassAdapter` instead of an object literal. `instance.playCount`,
// `.muted`, `.volume` and `.playbackRate` only change if their method ran
// with `instance` itself as `this`, which is what a fix has to preserve to
// read or write a `#private` field at all -- not merely reattach a
// same-named method, which throws on that read from any other receiver.
//
// Demonstrated red (docs/agents/demonstrated-red.md): against the unfixed
// `{ ...adapter, load: ... }`, this test's first `waitFor` timed out --
// `instance.attachCount` stayed `0` -- because `PlayerController.setProvider`
// (`player-controller.ts`) calls `provider.subscribe(...)` before it ever
// calls `attach()`, and the copy's missing `subscribe` threw
// `TypeError: provider.subscribe is not a function` there first, caught by
// `setProvider`'s own `try`/`catch` and turned into
// `activation: 'error'` without `attach` ever being reached. Run with
// `pnpm vitest run packages/react/test/supplied-provider.test.tsx -t "class-based"`.
//
// The per-method claim -- that each one has to run with `adapter` itself as
// `this`, not merely with some receiver that has the same method -- is
// proven by a named mutation on the fix rather than by this red, which
// cannot tell a correctly-bound method from an incorrectly-bound one: with
// the proxy's `get` trap changed to skip binding just `play` (returning
// `Reflect.get(adapter, property, adapter)` unbound instead of
// `.bind(adapter)`), this test's `attachCount`/`loadCount` waits still
// passed, but the `playCount` wait that follows timed out. Confirmed why by
// spying on `playWithOrigin` (`INTERNAL_CONTROLLER`, the way
// `activation.test.tsx` does) and awaiting its resolved `CommandResult`,
// since neither `getState().error` nor `getState().refusedPlay` carries a
// provider's own message: `player-controller.ts`'s `#providerCommand` calls
// the unbound `play` with `.call(provider, value)`, `provider` being the
// proxy itself, and reading `this.#playCount` inside `play()` against that
// receiver resolved `{ ok: false, reason: 'provider-error', error: {
// message: "Cannot read private member #playCount from an object whose
// class did not declare it", ... } }` rather than settling the command.
// Reverted afterward.
test("keeps a class-based supplied adapter's prototype methods and private state working on the queued-play path", async () => {
  await driveClassAdapterLifecycle('interaction');
});

// The eager counterpart of the test above, proving parity rather than a
// regression: the non-queued branch passes `adapter` to `setProvider`
// unchanged, so it was never touched by the copy this issue is about, and
// every assertion below is the same set the queued-play test makes.
//
// This path has no unfixed state of its own to run red against -- it
// already passes on main. Substitute mutation instead (demonstrated-red.md's
// fallback): with the non-queued branch's `controller.setProvider(adapter as
// ProviderAdapter)` changed to spread `adapter` the same way the queued-play
// branch used to (`controller.setProvider({ ...adapter } as
// ProviderAdapter)`), this test's first `waitFor` timed out the same way the
// queued-play test's unfixed red did -- `instance.attachCount` stayed `0`,
// `provider.subscribe is not a function` -- confirming this test would have
// caught the same defect had it reached the eager branch instead. Reverted
// afterward.
test("keeps the same class-based supplied adapter's methods and private state working under eager loading", async () => {
  await driveClassAdapterLifecycle('eager');
});

// #799's brief also names the interaction-activation retry path: an error,
// then `activateFromInteraction` retrying, which re-enters
// `activateFromInteraction`'s own `activation === 'error'` branch rather
// than its `dormant` one -- a second, independent way this hook arrives at
// the same queued-play branch, on a fresh generation and a freshly loaded
// instance of the same adapter.
//
// Demonstrated red (docs/agents/demonstrated-red.md): against the unfixed
// `{ ...adapter, load: ... }`, this test's first `waitFor` timed out the
// same way the queued-play test's did -- `instance.attachCount` stayed `0`
// on the very first attempt, before the retry this test is actually about
// was ever reached, because every queued-play attempt (a first activation or
// a retry alike) took the same broken branch. Run with `pnpm vitest run
// packages/react/test/supplied-provider.test.tsx -t "retries"`.
test("retries a class-based supplied adapter's load after an error, still keeping its methods on the queued-play path", async () => {
  const instance = new ClassAdapter();
  const load = vi.fn(async () => () => instance);
  const handle = createRef<Player.PlayerHandle>();

  render(
    <Player.Root
      loading="interaction"
      providers={{ acme: { detect: vi.fn(), load } }}
      ref={handle}
      source={{ type: 'acme', videoId: '1' }}
    >
      <Player.Viewport>
        <Player.Media />
      </Player.Viewport>
    </Player.Root>
  );

  act(() => handle.current?.activateFromInteraction());

  await waitFor(() => expect(instance.attachCount).toBe(1));
  await waitFor(() => expect(instance.loadCount).toBe(1));

  act(() => instance.emit({ activation: 'error', lifecycle: 'error' }));
  await waitFor(() =>
    expect(handle.current?.getState().activation).toBe('error')
  );

  act(() => handle.current?.activateFromInteraction());

  await waitFor(() => expect(instance.attachCount).toBe(2));
  await waitFor(() => expect(instance.loadCount).toBe(2));

  act(() => instance.emit({ activation: 'ready', lifecycle: 'ready' }));

  await waitFor(() => expect(instance.playCount).toBe(1));
});

// Demonstrated red (docs/agents/demonstrated-red.md): with the proxy's
// target still `adapter` itself, this test's first `waitFor` timed out --
// `frozen.counts().attachCount` stayed `0` -- because reading
// `provider.subscribe` inside `PlayerController.setProvider`
// (`player-controller.ts`) tripped the proxy invariant for a frozen
// target's own property: `TypeError: 'get' on proxy: property 'subscribe'
// is a read-only and non-configurable data property on the proxy target
// but the proxy did not return its actual value`. Caught by
// `setProvider`'s own `try`/`catch` and turned into `activation: 'error'`,
// the same way the class-based test's red was, confirmed the same way
// (a diagnostic read of `getState().error`). Run with
// `pnpm vitest run packages/react/test/supplied-provider.test.tsx -t "frozen"`.
test('keeps a frozen object-literal adapter callable on the queued-play path', async () => {
  const frozen = createFrozenAdapter();
  const load = vi.fn(async () => () => frozen.adapter);
  const handle = createRef<Player.PlayerHandle>();

  render(
    <Player.Root
      loading="interaction"
      providers={{ acme: { detect: vi.fn(), load } }}
      ref={handle}
      source={{ type: 'acme', videoId: '1' }}
    >
      <Player.Viewport>
        <Player.Media />
      </Player.Viewport>
    </Player.Root>
  );

  act(() => handle.current?.activateFromInteraction());

  await waitFor(() => expect(frozen.counts().attachCount).toBe(1));
  await waitFor(() => expect(frozen.counts().loadCount).toBe(1));

  act(() => frozen.emit({ activation: 'ready', lifecycle: 'ready' }));

  await waitFor(() => expect(frozen.counts().playCount).toBe(1));
});
