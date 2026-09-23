// @vitest-environment happy-dom

import { cleanup, render, waitFor } from '@testing-library/react';
import { Component, createRef, type ReactNode } from 'react';
import { afterEach, expect, test, vi } from 'vitest';
import { captureRethrows } from '@playdeck/test-support/capture-rethrows';
import * as Player from '../src/index';
import {
  INTERNAL_CONTROLLER,
  type InternalControllerAccess
} from '../src/internal-controller';
import { createFakeProvider } from './fixtures/fake-provider';

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
