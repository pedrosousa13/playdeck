# Lazy Provider Activation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add eager, viewport, and interaction provider activation with SSR-safe primitives, deterministic stale-work invalidation, privacy tests, and a real native-only bundle check.

**Architecture:** `Player.Root` remains the deep public module while a private React activation hook owns observers, source generations, dynamic loading, mount coordination, and queued playback. Core gains one narrow pre-provider state transition; provider loaders remain private; the public visual surface is limited to `ActivationButton` and `LoadingIndicator`.

**Tech Stack:** React 19.2.8, TypeScript 6.0.3, Vite 8.1.5, Vitest 4.1.10, Testing Library 16.3.2, happy-dom 20.8.9, Playwright 1.61.1, pnpm 11.15.1.

## Global Constraints

- React peer range remains `>=19 <20`; use React 19 ref props, never `forwardRef`.
- `loading` defaults to `"viewport"`, `loadMargin` to `"200px 0px"`, and `preload` to `"metadata"`.
- Poster loading, provider activation, and media preload remain independent policies.
- Interaction mode creates no media element, provider import, iframe, SDK, or media/provider request before an explicit click.
- Audible queued playback is never retried as muted.
- Provider loader configuration remains private; do not add a public registry, override prop, or test export.
- Provider and Storybook dependencies remain dev-only or package-internal as applicable; published entry behavior must remain tree-shakeable.
- Do not add HLS, YouTube, or Vimeo implementations in this issue.
- Do not broaden `pnpm-workspace.yaml`'s `allowBuilds`; only `sharp@0.34.5` stays approved.
- Do not add attribution, co-author, generated-by, or reaction-prompt footers.
- Keep implementation commits focused; planning files under `.planning/` remain ignored and uncommitted.

## File map

- `packages/core/src/index.ts` — normalized pre-provider activation state.
- `packages/core/test/activation.test.ts` — core transition contract.
- `packages/react/src/provider-loaders.ts` — private source-to-adapter dynamic loader.
- `packages/react/src/use-activation.ts` — private React activation session and generation guard.
- `packages/react/src/index.tsx` — Root integration, Viewport/Media bindings, and public visual primitives.
- `packages/react/test/activation.test.tsx` — strategy, SSR, interaction, retry, and stale-work tests.
- `packages/react/test/fixtures/fake-provider.ts` — deterministic fake adapter used only by React tests.
- `e2e/activation.spec.ts` — request-before-click privacy assertion.
- `apps/docs/src/main.tsx` — runnable activation fixture and conventions.
- `tests/bundle/native-only/*` — real consumer build, manifest assertion, and request assertion.
- `package.json`, `pnpm-workspace.yaml`, `pnpm-lock.yaml` — root bundle verification wiring.

---

### Task 1: Core pre-provider activation state

**Files:**

- Create: `packages/core/test/activation.test.ts`
- Modify: `packages/core/src/index.ts`

**Interfaces:**

- Consumes: existing `PlayerState`, `PlayerError`, and `PlayerController.setProvider`.
- Produces:

```ts
export type PreProviderActivation =
  | {
      readonly activation: 'dormant' | 'eligible' | 'loading-provider';
    }
  | {
      readonly activation: 'error';
      readonly error: PlayerError;
    };

PlayerController#setActivation(next: PreProviderActivation): void
```

- Invariant: `setActivation` never fabricates `activation: "ready"` and is not included in `PlayerHandle`.

- [ ] **Step 1: Write the failing core contract test**

Create `packages/core/test/activation.test.ts`:

```ts
import { expect, test } from 'vitest';
import {
  PlayerController,
  type PlayerError,
  type PreProviderActivation
} from '../src/index';

const failure: PlayerError = {
  category: 'configuration',
  fatal: false,
  recoverable: true,
  message: 'Viewport activation requires Player.Viewport.'
};

test.each([
  [
    { activation: 'dormant' } satisfies PreProviderActivation,
    { activation: 'dormant', lifecycle: 'idle', error: null }
  ],
  [
    { activation: 'eligible' } satisfies PreProviderActivation,
    { activation: 'eligible', lifecycle: 'idle', error: null }
  ],
  [
    { activation: 'loading-provider' } satisfies PreProviderActivation,
    { activation: 'loading-provider', lifecycle: 'loading', error: null }
  ],
  [
    { activation: 'error', error: failure } satisfies PreProviderActivation,
    { activation: 'error', lifecycle: 'error', error: failure }
  ]
] as const)('publishes pre-provider state %#', (next, expected) => {
  const controller = new PlayerController();

  controller.setActivation(next);

  expect(controller.getState()).toMatchObject(expected);
  expect(Object.isFrozen(controller.getState())).toBe(true);
  if (controller.getState().error) {
    expect(Object.isFrozen(controller.getState().error)).toBe(true);
  }
});

test('clears a pre-provider error when a new attempt becomes eligible', () => {
  const controller = new PlayerController();
  controller.setActivation({ activation: 'error', error: failure });

  controller.setActivation({ activation: 'eligible' });

  expect(controller.getState()).toMatchObject({
    activation: 'eligible',
    lifecycle: 'idle',
    error: null
  });
});

test('does not let a pre-provider transition replace an installed provider', () => {
  const controller = new PlayerController();
  controller.setProvider({
    provider: 'native',
    attach: () => undefined,
    load: () => undefined,
    destroy: () => undefined,
    subscribe: () => () => undefined
  });

  controller.setActivation({ activation: 'eligible' });

  expect(controller.getState()).toMatchObject({
    activation: 'loading-provider',
    lifecycle: 'loading',
    provider: 'native'
  });
});

test('does not accept ready as a pre-provider transition', () => {
  if (false) {
    const controller = new PlayerController();
    // @ts-expect-error Readiness can only come from an installed provider.
    controller.setActivation({ activation: 'ready' });
  }
  expect(true).toBe(true);
});
```

- [ ] **Step 2: Run the new test to verify red**

Run:

```sh
pnpm exec vitest run packages/core/test/activation.test.ts
```

Expected: TypeScript transform or runtime failure because
`PreProviderActivation` and `PlayerController.setActivation` do not exist.

- [ ] **Step 3: Implement the narrow core transition**

Add `PreProviderActivation` immediately after `PlayerState`, and add this
method immediately before `setProvider`:

```ts
export type PreProviderActivation =
  | {
      readonly activation: 'dormant' | 'eligible' | 'loading-provider';
    }
  | {
      readonly activation: 'error';
      readonly error: PlayerError;
    };

setActivation = (next: PreProviderActivation): void => {
  if (this.#provider) return;
  const lifecycle =
    next.activation === 'loading-provider'
      ? 'loading'
      : next.activation === 'error'
        ? 'error'
        : 'idle';
  this.#applyPatch({
    activation: next.activation,
    lifecycle,
    error: next.activation === 'error' ? next.error : null
  });
};
```

Do not add `setActivation` to React's `PlayerHandle` or `PlayerActions`.

- [ ] **Step 4: Run core verification**

Run:

```sh
pnpm exec vitest run packages/core/test/activation.test.ts packages/core/test/source.test.ts packages/core/test/autoplay.test.ts
pnpm --filter @playdeck/core build
```

Expected: all core tests pass and the core package builds.

- [ ] **Step 5: Commit Task 1**

```sh
git add packages/core/src/index.ts packages/core/test/activation.test.ts
git commit -m "feat(core): add pre-provider activation state"
```

---

### Task 2: Private loader and eager/viewport activation engine

**Files:**

- Create: `packages/react/src/provider-loaders.ts`
- Create: `packages/react/src/use-activation.ts`
- Create: `packages/react/test/fixtures/fake-provider.ts`
- Create: `packages/react/test/activation.test.tsx`
- Modify: `packages/react/src/index.tsx`
- Modify: `packages/react/test/index.test.tsx`

**Interfaces:**

- Consumes: `PlayerController.setActivation`, `detectSource`,
  `ProviderAdapter`, `NativePlaybackOptions`.
- Produces these private source interfaces:

```ts
export type ProviderLoaderRequest = {
  readonly source: ResolvedPlayerSource;
  readonly media: HTMLVideoElement | null;
  readonly nativeOptions: NativePlaybackOptions;
};

export const loadProvider = (
  request: ProviderLoaderRequest
): Promise<ProviderAdapter>;

export type ActivationBindings = {
  readonly mediaEligible: boolean;
  readonly preload: PlayerPreload;
  readonly registerMedia: (media: HTMLVideoElement | null) => void;
  readonly registerViewport: (viewport: HTMLDivElement | null) => void;
  readonly activateFromInteraction: () => void;
};
```

- `useActivation` is private to the package and receives the current
  controller, detected source, strategy props, autoplay mode, native options,
  and a `prepareMedia(media)` callback that preserves existing preference and
  poster lifecycle behavior.

- [ ] **Step 1: Add the deterministic fake and failing strategy tests**

Create `packages/react/test/fixtures/fake-provider.ts`:

```ts
import type {
  CommandResult,
  PlayerProvider,
  ProviderAdapter,
  ProviderStateListener,
  ProviderStatePatch
} from '@playdeck/core';

export const deferred = <Value>() => {
  let resolve!: (value: Value | PromiseLike<Value>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<Value>((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });
  return { promise, reject, resolve };
};

export const createFakeProvider = ({
  playResult = { ok: true } as CommandResult,
  provider = 'native' as PlayerProvider
} = {}) => {
  const listeners = new Set<ProviderStateListener>();
  let attachCount = 0;
  let destroyCount = 0;
  let loadCount = 0;
  let playCount = 0;
  const adapter: ProviderAdapter = {
    provider,
    attach: () => {
      attachCount += 1;
    },
    load: () => {
      loadCount += 1;
    },
    destroy: () => {
      destroyCount += 1;
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    play: async () => {
      playCount += 1;
      return playResult;
    }
  };
  return {
    adapter,
    counts: () => ({ attachCount, destroyCount, loadCount, playCount }),
    emit: (patch: ProviderStatePatch) => {
      listeners.forEach((listener) => listener(patch));
    }
  };
};
```

Create the initial `packages/react/test/activation.test.tsx`:

```tsx
// @vitest-environment happy-dom

import { act, cleanup, render, screen } from '@testing-library/react';
import { createRef } from 'react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import type { ProviderAdapter } from '@playdeck/core';
import * as Player from '../src/index';
import { loadProvider } from '../src/provider-loaders';
import { createFakeProvider, deferred } from './fixtures/fake-provider';

vi.mock('../src/provider-loaders', () => ({
  loadProvider: vi.fn()
}));

class ControlledIntersectionObserver implements IntersectionObserver {
  static instances: ControlledIntersectionObserver[] = [];
  readonly root = null;
  readonly thresholds = [0];
  readonly rootMargin: string;
  private readonly callback: IntersectionObserverCallback;
  private target?: Element;

  constructor(
    callback: IntersectionObserverCallback,
    options: IntersectionObserverInit = {}
  ) {
    this.callback = callback;
    this.rootMargin = options.rootMargin ?? '0px';
    ControlledIntersectionObserver.instances.push(this);
  }

  disconnect = vi.fn();
  observe = vi.fn((target: Element) => {
    this.target = target;
  });
  takeRecords = () => [];
  unobserve = vi.fn();

  intersect() {
    const target = this.target!;
    this.callback(
      [
        {
          boundingClientRect: target.getBoundingClientRect(),
          intersectionRatio: 1,
          intersectionRect: target.getBoundingClientRect(),
          isIntersecting: true,
          rootBounds: null,
          target,
          time: 0
        }
      ],
      this
    );
  }
}

const mockedLoadProvider = vi.mocked(loadProvider);

const fixture = (
  props: Omit<Player.RootProps, 'children' | 'source'> & {
    source?: Player.RootProps['source'];
  } = {}
) => (
  <Player.Root source={props.source ?? '/tracer.mp4'} {...props}>
    <Player.Viewport data-testid="viewport">
      <Player.Media />
    </Player.Viewport>
  </Player.Root>
);

beforeEach(() => {
  ControlledIntersectionObserver.instances = [];
  mockedLoadProvider.mockReset();
  vi.stubGlobal('IntersectionObserver', ControlledIntersectionObserver);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

test('eager loads after client mount and forwards preload', async () => {
  const fake = createFakeProvider();
  mockedLoadProvider.mockResolvedValue(fake.adapter);

  render(fixture({ loading: 'eager', preload: 'none' }));

  await vi.waitFor(() => expect(mockedLoadProvider).toHaveBeenCalledOnce());
  expect(screen.getByLabelText('Playdeck media').getAttribute('preload')).toBe(
    'none'
  );
  expect(fake.counts()).toMatchObject({ attachCount: 1, loadCount: 1 });
});

test('viewport uses the default margin and does not load before intersection', async () => {
  const fake = createFakeProvider();
  mockedLoadProvider.mockResolvedValue(fake.adapter);

  render(fixture());

  expect(ControlledIntersectionObserver.instances).toHaveLength(1);
  const observer = ControlledIntersectionObserver.instances[0]!;
  expect(observer.rootMargin).toBe('200px 0px');
  expect(mockedLoadProvider).not.toHaveBeenCalled();

  act(() => observer.intersect());

  await vi.waitFor(() => expect(mockedLoadProvider).toHaveBeenCalledOnce());
  expect(observer.disconnect).toHaveBeenCalledOnce();
});

test('viewport uses a custom margin', () => {
  render(fixture({ loadMargin: '500px 20px' }));

  expect(ControlledIntersectionObserver.instances[0]?.rootMargin).toBe(
    '500px 20px'
  );
});

test('viewport without Viewport reports an error and never imports', async () => {
  const handle = createRef<Player.PlayerHandle>();
  render(
    <Player.Root ref={handle} source="/tracer.mp4">
      <Player.Media />
    </Player.Root>
  );

  await vi.waitFor(() =>
    expect(handle.current?.getState()).toMatchObject({
      activation: 'error',
      lifecycle: 'error',
      error: { category: 'configuration' }
    })
  );
  expect(mockedLoadProvider).not.toHaveBeenCalled();
});

test('source changes invalidate a pending loader', async () => {
  const first = deferred<ProviderAdapter>();
  const stale = createFakeProvider();
  const current = createFakeProvider();
  mockedLoadProvider
    .mockReturnValueOnce(first.promise)
    .mockResolvedValueOnce(current.adapter);
  const { rerender } = render(
    fixture({ loading: 'eager', source: '/first.mp4' })
  );
  await vi.waitFor(() => expect(mockedLoadProvider).toHaveBeenCalledOnce());

  rerender(fixture({ loading: 'eager', source: '/second.mp4' }));
  await vi.waitFor(() => expect(mockedLoadProvider).toHaveBeenCalledTimes(2));
  first.resolve(stale.adapter);

  await vi.waitFor(() => expect(stale.counts().destroyCount).toBe(1));
  expect(current.counts()).toMatchObject({ attachCount: 1, loadCount: 1 });
  expect(stale.counts()).toMatchObject({ attachCount: 0, loadCount: 0 });
});
```

- [ ] **Step 2: Run the strategy tests to verify red**

Run:

```sh
pnpm exec vitest run packages/react/test/activation.test.tsx
```

Expected: failure because `provider-loaders`, activation props, and activation
bindings do not exist.

- [ ] **Step 3: Add the private dynamic loader**

Create `packages/react/src/provider-loaders.ts`:

```ts
import type { ProviderAdapter, ResolvedPlayerSource } from '@playdeck/core';
import type { NativePlaybackOptions } from '@playdeck/provider-native';

export type ProviderLoaderRequest = {
  readonly source: ResolvedPlayerSource;
  readonly media: HTMLVideoElement | null;
  readonly nativeOptions: NativePlaybackOptions;
};

export const loadProvider = async ({
  media,
  nativeOptions,
  source
}: ProviderLoaderRequest): Promise<ProviderAdapter> => {
  if (source.type !== 'video') {
    throw new Error(`No provider adapter is installed for ${source.type}.`);
  }
  if (!media) {
    throw new Error('The native provider requires a media mount.');
  }
  const { createNativeProvider } = await import('@playdeck/provider-native');
  return createNativeProvider(media, nativeOptions);
};
```

Change the import in `packages/react/src/index.tsx` from a runtime
`createNativeProvider` import to a type-only `NativePlaybackOptions` import.
Keep `@playdeck/provider-native` external in the package Vite build so the
consumer build controls chunking.

- [ ] **Step 4: Add the private activation hook**

Create `packages/react/src/use-activation.ts` with these exact exported types
and behavior:

```ts
import type {
  AutoplayMode,
  PlayerController,
  ResolvedPlayerSource,
  SourceDetectionResult
} from '@playdeck/core';
import type { NativePlaybackOptions } from '@playdeck/provider-native';
import { useCallback, useEffect, useRef, useState } from 'react';
import { loadProvider } from './provider-loaders';

export type PlayerLoadingStrategy = 'eager' | 'viewport' | 'interaction';
export type PlayerPreload = 'none' | 'metadata' | 'auto';

export type ActivationBindings = {
  readonly activateFromInteraction: () => void;
  readonly loading: PlayerLoadingStrategy;
  readonly mediaEligible: boolean;
  readonly preload: PlayerPreload;
  readonly registerMedia: (media: HTMLVideoElement | null) => void;
  readonly registerViewport: (viewport: HTMLDivElement | null) => void;
};

export type UseActivationOptions = {
  readonly autoplay: AutoplayMode;
  readonly controller: PlayerController;
  readonly loadMargin: string;
  readonly loading: PlayerLoadingStrategy;
  readonly nativeOptions: NativePlaybackOptions;
  readonly prepareMedia: (media: HTMLVideoElement) => void;
  readonly preload: PlayerPreload;
  readonly source: SourceDetectionResult;
};
```

Implement `useActivation(options): ActivationBindings` with this state
machine:

```ts
type Session = {
  generation: number;
  sourceKey: string;
  started: boolean;
  queuedPlay: boolean;
};

const sourceKey = (source: SourceDetectionResult): string =>
  source.status === 'success'
    ? JSON.stringify(source.source)
    : 'unsupported-source';

const configurationError = (message: string) => ({
  category: 'configuration' as const,
  fatal: false,
  recoverable: true,
  message
});

const unsupportedError = (message: string) => ({
  category: 'unsupported' as const,
  fatal: false,
  recoverable: true,
  message
});
```

The hook must apply the following ordered rules:

1. Initialize `mediaEligible` to `false` so server and first client render
   match.
2. Store media and Viewport nodes in refs.
3. On committed source-key change: increment generation, destroy/detach the
   current provider through `controller.setProvider(undefined)`, reset
   `started` and `queuedPlay`, set `mediaEligible(false)`, and publish
   `dormant`.
4. `eager`: in an effect, publish `eligible`, set media eligible, then start
   loading once `registerMedia` receives the element.
5. `viewport`: after refs commit, report a configuration error if no Viewport
   exists; otherwise create one `IntersectionObserver` with `rootMargin`.
   First intersection disconnects it and follows the eager activation path.
6. Missing `IntersectionObserver` publishes the unsupported-category error
   from the design and performs no import.
7. `interaction`: remain dormant until `activateFromInteraction`; incompatible
   autoplay publishes the configuration error and performs no import.
8. `activateFromInteraction`: set `queuedPlay`, publish `eligible`, and make
   media eligible. It is idempotent per generation.
9. When current media exists and the session is eligible: call
   `prepareMedia(media)`, publish `loading-provider`, call `loadProvider`, and
   compare generation/source before installing.
10. Destroy a stale resolved adapter. Install only the current adapter.
11. For queued play, subscribe until current state reaches `activation:
"ready"`, then call `controller.playWithOrigin("user")` exactly once.
12. On loader rejection, publish a recoverable provider-category activation
    error for the current generation.
13. Cleanup disconnects observers, increments generation, and detaches the
    provider.

Use refs for callbacks and current options so changing `loadMargin` only
restarts a dormant observer; it must not replace a loading or ready provider.

- [ ] **Step 5: Integrate Root, Viewport, and Media**

In `packages/react/src/index.tsx`:

1. Export the activation prop types from the private hook:

```ts
export type { PlayerLoadingStrategy, PlayerPreload } from './use-activation';

export type PlayerActivationProps = {
  readonly loading?: import('./use-activation').PlayerLoadingStrategy;
  readonly loadMargin?: string;
  readonly preload?: import('./use-activation').PlayerPreload;
};
```

2. Change `RootProps` to `NativePlaybackOptions & PlayerActivationProps & { ... }`.
3. Add these defaults in `Root`:

```ts
((loadMargin = '200px 0px'), (loading = 'viewport'), (preload = 'metadata'));
```

4. Extend `PlayerContextValue` with the `ActivationBindings`.
5. Move the existing media preference seeding, autoplay configuration,
   loaded-data poster listener, and preference subscription into a
   `prepareMedia(media)` callback. Remove the direct
   `controller.setProvider(createNativeProvider(...))` call.
6. Call `useActivation` once in Root and merge its bindings into context.
7. Change `ViewportProps` to `ComponentPropsWithRef<'div'>`, merge the consumer
   ref with `registerViewport`, and retain all current fixed geometry styles.
8. Make `Media` return `null` until `mediaEligible` is true. Once eligible,
   render the current `<video>` markup with `preload={preload}` and
   `ref={registerMedia}`.

For merged React 19 refs, add this local helper:

```ts
const assignRef = <Value>(
  ref: Ref<Value> | undefined,
  value: Value | null
): void => {
  if (typeof ref === 'function') {
    ref(value);
  } else if (ref) {
    ref.current = value;
  }
};
```

The Viewport ref callback calls both `assignRef(ref, node)` and
`registerViewport(node)`.

9. In existing `packages/react/test/index.test.tsx`, install an immediate
   observer in `beforeEach` so existing tests exercise the new default
   viewport strategy without changing every Root:

```ts
class ImmediateIntersectionObserver {
  readonly root = null;
  readonly rootMargin = '200px 0px';
  readonly thresholds = [0];
  constructor(private callback: IntersectionObserverCallback) {}
  disconnect = () => undefined;
  observe = (target: Element) =>
    this.callback(
      [
        {
          boundingClientRect: target.getBoundingClientRect(),
          intersectionRatio: 1,
          intersectionRect: target.getBoundingClientRect(),
          isIntersecting: true,
          rootBounds: null,
          target,
          time: 0
        }
      ],
      this as unknown as IntersectionObserver
    );
  takeRecords = () => [];
  unobserve = () => undefined;
}

beforeEach(() => {
  vi.stubGlobal('IntersectionObserver', ImmediateIntersectionObserver);
});
```

Add `vi.unstubAllGlobals()` to the existing `afterEach`.

- [ ] **Step 6: Run strategy and regression tests**

Run serially:

```sh
pnpm exec vitest run packages/react/test/activation.test.tsx
pnpm --filter @playdeck/react test
pnpm --filter @playdeck/react build
```

Expected: eager, viewport, stale-loader, and all existing React tests pass;
the built React entry contains a dynamic, not static, native-provider import.

- [ ] **Step 7: Commit Task 2**

```sh
git add packages/react/src/provider-loaders.ts packages/react/src/use-activation.ts packages/react/src/index.tsx packages/react/test/activation.test.tsx packages/react/test/fixtures/fake-provider.ts packages/react/test/index.test.tsx
git commit -m "feat(react): add lazy provider activation engine"
```

---

### Task 3: Interaction control, loading indicator, SSR, and retry

**Files:**

- Modify: `packages/react/src/index.tsx`
- Modify: `packages/react/src/use-activation.ts`
- Modify: `packages/react/test/activation.test.tsx`
- Modify: `apps/docs/src/main.tsx`

**Interfaces:**

- Consumes: Task 2 `ActivationBindings.activateFromInteraction`.
- Produces:

```ts
export type ActivationButtonProps = ComponentPropsWithRef<'button'>;
export const ActivationButton = (props: ActivationButtonProps) =>
  ReactElement | null;

export type LoadingIndicatorProps = ComponentPropsWithRef<'div'>;
export const LoadingIndicator = (props: LoadingIndicatorProps) =>
  ReactElement | null;
```

- [ ] **Step 1: Add failing interaction and visual-semantic tests**

Append to `packages/react/test/activation.test.tsx`:

```tsx
import { fireEvent } from '@testing-library/react';
import { renderToString } from 'react-dom/server';

const interactionFixture = (
  props: Omit<Player.RootProps, 'children' | 'loading' | 'source'> & {
    source?: Player.RootProps['source'];
  } = {}
) => (
  <Player.Root
    loading="interaction"
    source={props.source ?? '/tracer.mp4'}
    {...props}
  >
    <Player.Viewport>
      <Player.Media />
      <Player.Poster>
        <span>Poster</span>
      </Player.Poster>
      <Player.ActivationButton />
      <Player.LoadingIndicator />
      <Player.PlayButton />
    </Player.Viewport>
  </Player.Root>
);

test('server-renders interaction control without media or loading work', () => {
  const markup = renderToString(interactionFixture());

  expect(markup).toContain('data-playdeck-part="activation"');
  expect(markup).toContain('aria-label="Play video"');
  expect(markup).toContain('data-playdeck-part="poster"');
  expect(markup).not.toContain('<video');
  expect(markup).not.toContain('data-playdeck-part="loading-indicator"');
  expect(mockedLoadProvider).not.toHaveBeenCalled();
});

test('one interaction click loads and queues user-origin playback', async () => {
  const fake = createFakeProvider();
  mockedLoadProvider.mockResolvedValue(fake.adapter);
  const handle = createRef<Player.PlayerHandle>();
  render(interactionFixture({ defaultMuted: true, ref: handle }));

  const activation = screen.getByRole('button', { name: 'Play video' });
  expect(activation.dataset.state).toBe('dormant');
  expect(screen.queryByLabelText('Playdeck media')).toBeNull();
  expect(mockedLoadProvider).not.toHaveBeenCalled();

  fireEvent.click(activation);

  await vi.waitFor(() => expect(mockedLoadProvider).toHaveBeenCalledOnce());
  expect(screen.getByRole('status').dataset.state).toBe('loading-provider');
  act(() =>
    fake.emit({
      activation: 'ready',
      lifecycle: 'ready',
      muted: true
    })
  );
  await vi.waitFor(() => expect(fake.counts().playCount).toBe(1));
  expect(handle.current?.getState().muted).toBe(true);
});

test('audible blocked playback is not silently muted', async () => {
  const fake = createFakeProvider({
    playResult: { ok: false, reason: 'blocked' }
  });
  mockedLoadProvider.mockResolvedValue(fake.adapter);
  render(interactionFixture());

  fireEvent.click(screen.getByRole('button', { name: 'Play video' }));
  await vi.waitFor(() => expect(mockedLoadProvider).toHaveBeenCalledOnce());
  act(() =>
    fake.emit({
      activation: 'ready',
      lifecycle: 'ready',
      muted: false
    })
  );

  await vi.waitFor(() => expect(fake.counts().playCount).toBe(1));
  expect(screen.getByRole('button', { name: 'Play' })).toBeDefined();
  expect(fake.counts().playCount).toBe(1);
});

test.each(['muted', 'audible'] as const)(
  'interaction with %s autoplay is a configuration error',
  async (autoplay) => {
    const handle = createRef<Player.PlayerHandle>();
    render(interactionFixture({ autoplay, ref: handle }));

    await vi.waitFor(() =>
      expect(handle.current?.getState()).toMatchObject({
        activation: 'error',
        error: { category: 'configuration' }
      })
    );
    expect(mockedLoadProvider).not.toHaveBeenCalled();
  }
);

test('keeps focus and retries after loader failure', async () => {
  const current = createFakeProvider();
  mockedLoadProvider
    .mockRejectedValueOnce(new Error('provider import failed'))
    .mockResolvedValueOnce(current.adapter);
  render(interactionFixture());

  const button = screen.getByRole('button', { name: 'Play video' });
  button.focus();
  fireEvent.click(button);
  await screen.findByRole('button', { name: 'Retry loading video' });
  expect(document.activeElement).toBe(button);

  fireEvent.click(button);

  await vi.waitFor(() => expect(mockedLoadProvider).toHaveBeenCalledTimes(2));
  expect(current.counts()).toMatchObject({ attachCount: 1, loadCount: 1 });
});
```

- [ ] **Step 2: Run interaction tests to verify red**

Run:

```sh
pnpm exec vitest run packages/react/test/activation.test.tsx
```

Expected: failures because `ActivationButton`, `LoadingIndicator`, retry, and
queued interaction playback are incomplete.

- [ ] **Step 3: Implement `ActivationButton`**

Add `ActivationButtonProps` and `ActivationButton` to
`packages/react/src/index.tsx`. It must:

```tsx
export type ActivationButtonProps = ComponentPropsWithRef<'button'>;

export const ActivationButton = ({
  'aria-label': ariaLabel,
  children,
  onClick,
  style,
  ...props
}: ActivationButtonProps) => {
  const { activateFromInteraction, loading } = usePlayer();
  const activation = usePlayerState((state) => state.activation);
  if (loading !== 'interaction' || activation === 'ready') {
    return null;
  }
  const isError = activation === 'error';
  const isLoading = activation === 'loading-provider';
  const label = ariaLabel ?? (isError ? 'Retry loading video' : 'Play video');
  return (
    <button
      {...props}
      aria-disabled={isLoading || undefined}
      aria-label={label}
      data-playdeck-part="activation"
      data-state={activation}
      onClick={(event) => {
        onClick?.(event);
        if (!event.defaultPrevented && !isLoading) {
          activateFromInteraction();
        }
      }}
      style={{
        ...style,
        position: 'absolute',
        inset: 0,
        zIndex: 30
      }}
      type="button"
    >
      {children ?? (isError ? 'Retry' : 'Play')}
    </button>
  );
};
```

The package's `usePlayer` context must expose `loading` and
`activateFromInteraction`, but neither becomes a standalone public action.

- [ ] **Step 4: Implement `LoadingIndicator`**

Add:

```tsx
export type LoadingIndicatorProps = ComponentPropsWithRef<'div'>;

export const LoadingIndicator = ({
  children,
  style,
  ...props
}: LoadingIndicatorProps) => {
  const { activation, buffering } = usePlayerState((state) => ({
    activation: state.activation,
    buffering: state.buffering
  }));
  const state =
    activation === 'loading-provider'
      ? 'loading-provider'
      : buffering
        ? 'buffering'
        : null;
  if (!state) return null;
  return (
    <div
      {...props}
      aria-live="polite"
      data-playdeck-part="loading-indicator"
      data-state={state}
      role="status"
      style={{
        ...style,
        position: 'absolute',
        inset: 0,
        zIndex: 30,
        pointerEvents: 'none'
      }}
    >
      {children ??
        (state === 'loading-provider' ? 'Loading video' : 'Buffering')}
    </div>
  );
};
```

Do not add animation or package CSS in this issue.

- [ ] **Step 5: Complete retry and queued-play behavior in `useActivation`**

Implement these exact interaction invariants:

- `activateFromInteraction` accepts both dormant and error sessions.
- Error retry increments generation, clears the old error through
  `setActivation({ activation: "eligible" })`, and starts one new loader.
- The activation button DOM node is not replaced between dormant, loading, and
  error; state changes only alter its attributes/content.
- After `controller.setProvider(adapter)`, subscribe to controller state.
- On current `activation: "ready"`, unsubscribe before calling
  `controller.playWithOrigin("user")`.
- On current `activation: "error"` or generation change, unsubscribe without
  playing.
- Never call `mute()` as a fallback. Existing media preference seeding applies
  `defaultMuted` or controlled `muted` before provider installation.

- [ ] **Step 6: Add runnable docs composition**

In `apps/docs/src/main.tsx`, parse:

```ts
const parameters = new URLSearchParams(window.location.search);
const loadingParameter = parameters.get('loading');
const loading: Player.PlayerLoadingStrategy =
  loadingParameter === 'eager' ||
  loadingParameter === 'interaction' ||
  loadingParameter === 'viewport'
    ? loadingParameter
    : 'viewport';
const activationSource =
  parameters.get('activationSource') === 'external'
    ? 'https://provider.invalid/tracer.mp4'
    : '/tracer.mp4';
```

Use `activationSource`, `loading`, and `preload="metadata"` on the runnable
Root. Add `data-testid="viewport"` to that runnable Viewport. Inside Viewport,
after Poster, add:

```tsx
<Player.ActivationButton />
<Player.LoadingIndicator />
```

Add a documentation section containing this exact three-policy example:

```tsx
<Player.Root source={source} loading="interaction" preload="metadata">
  <Player.Viewport>
    <Player.Media />
    <Player.Poster>{poster}</Player.Poster>
    <Player.ActivationButton />
    <Player.LoadingIndicator />
  </Player.Viewport>
</Player.Root>
```

The prose must state:

- poster `loading`/`fetchPriority` controls only the image;
- Root `loading` controls provider activation;
- Root `preload` controls native media only after activation;
- viewport defaults and margin;
- interaction/autoplay incompatibility;
- no provider contact before click;
- muted queued playback and audible blocked behavior;
- source changes and Retry invalidate stale attempts.

- [ ] **Step 7: Run Task 3 verification**

Run serially:

```sh
pnpm exec vitest run packages/react/test/activation.test.tsx
pnpm --filter @playdeck/react test
pnpm --filter @playdeck/docs build
pnpm --filter @playdeck/react build
```

Expected: interaction, SSR, retry, existing React tests, docs build, and React
build all pass.

- [ ] **Step 8: Commit Task 3**

```sh
git add packages/react/src/index.tsx packages/react/src/use-activation.ts packages/react/test/activation.test.tsx apps/docs/src/main.tsx
git commit -m "feat(react): add interaction activation primitives"
```

---

### Task 4: Browser privacy guarantee

**Files:**

- Create: `e2e/activation.spec.ts`

**Interfaces:**

- Consumes: docs query parameters from Task 3.
- Produces: deterministic proof that an external-looking media/provider
  request occurs only after the activation click.

- [ ] **Step 1: Write the failing browser privacy test**

Create `e2e/activation.spec.ts`:

```ts
import { expect, test } from '@playwright/test';

test('interaction activation makes no provider request before click', async ({
  page
}) => {
  const providerRequests: string[] = [];
  await page.route('https://provider.invalid/**', async (route) => {
    providerRequests.push(route.request().url());
    await route.fulfill({
      body: '',
      contentType: 'video/mp4',
      status: 200
    });
  });

  await page.goto('/?loading=interaction&activationSource=external');
  await expect(page.getByRole('button', { name: 'Play video' })).toBeVisible();
  await expect(page.getByTestId('viewport')).toBeVisible();
  expect(providerRequests).toEqual([]);

  await page.getByRole('button', { name: 'Play video' }).click();

  await expect.poll(() => providerRequests.length).toBeGreaterThan(0);
  expect(
    providerRequests.every(
      (url) => url === 'https://provider.invalid/tracer.mp4'
    )
  ).toBe(true);
});
```

- [ ] **Step 2: Run the browser test to verify red**

Run:

```sh
pnpm --filter @playdeck/docs build
pnpm exec playwright test e2e/activation.spec.ts --project=chromium
```

Expected: failure until the interaction fixture and media-mount timing enforce
the no-request guarantee.

- [ ] **Step 3: Enforce the production timing guard**

Confirm `Media` begins with this exact activation guard before source-type
handling:

```tsx
const { mediaEligible, preload, registerMedia, source } = usePlayer();
if (!mediaEligible) return null;
if (source.status === 'failure' || source.source.type !== 'video') return null;
```

Confirm `activateFromInteraction` begins with this idempotence guard:

```ts
const session = sessionRef.current;
if (
  loadingRef.current !== 'interaction' ||
  session.started ||
  session.sourceKey !== currentSourceKeyRef.current
) {
  return;
}
session.started = true;
session.queuedPlay = true;
```

The browser test must pass with these production guards. Do not add request
filtering, delays, or test-only production branches.

- [ ] **Step 4: Run the cross-browser activation check**

Run:

```sh
pnpm --filter @playdeck/docs build
pnpm exec playwright test e2e/activation.spec.ts
```

Expected: the activation privacy test passes in Chromium, Firefox, and WebKit.

- [ ] **Step 5: Commit Task 4**

```sh
git add e2e/activation.spec.ts apps/docs/src/main.tsx packages/react/src/index.tsx packages/react/src/use-activation.ts
git commit -m "test: enforce interaction activation privacy"
```

---

### Task 5: Real native-only bundle verification and full gate

**Files:**

- Create: `tests/bundle/native-only/package.json`
- Create: `tests/bundle/native-only/index.html`
- Create: `tests/bundle/native-only/src/main.tsx`
- Create: `tests/bundle/native-only/vite.config.ts`
- Create: `tests/bundle/native-only/test.mjs`
- Modify: `package.json`
- Modify: `pnpm-workspace.yaml`
- Modify: `pnpm-lock.yaml`

**Interfaces:**

- Consumes: built workspace packages and Task 2's dynamic native provider
  import.
- Produces: root `pnpm test:bundle` that verifies both the initial manifest
  graph and browser request graph.

- [ ] **Step 1: Add the consumer fixture**

Create `tests/bundle/native-only/package.json`:

```json
{
  "name": "@playdeck/bundle-native-only",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "build": "vite build",
    "test": "node test.mjs"
  },
  "dependencies": {
    "@playdeck/react": "workspace:*",
    "react": "19.2.8",
    "react-dom": "19.2.8"
  },
  "devDependencies": {
    "@playwright/test": "1.61.1",
    "@vitejs/plugin-react": "6.0.4",
    "vite": "8.1.5"
  }
}
```

Create `tests/bundle/native-only/index.html`:

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Playdeck native-only bundle fixture</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

Create `tests/bundle/native-only/src/main.tsx`:

```tsx
import { createRoot } from 'react-dom/client';
import * as Player from '@playdeck/react';

const Fixture = () => (
  <Player.Root loading="interaction" source="/fixture.mp4">
    <Player.Viewport>
      <Player.Media />
      <Player.ActivationButton />
    </Player.Viewport>
  </Player.Root>
);

createRoot(document.getElementById('root')!).render(<Fixture />);
```

Create `tests/bundle/native-only/vite.config.ts`:

```ts
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  build: {
    manifest: true
  }
});
```

- [ ] **Step 2: Add the failing manifest/request verifier**

Create `tests/bundle/native-only/test.mjs`:

```js
import { chromium } from '@playwright/test';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, normalize } from 'node:path';

const root = new URL('./dist/', import.meta.url);
const manifest = JSON.parse(
  await readFile(new URL('.vite/manifest.json', root), 'utf8')
);
const entryKey = Object.keys(manifest).find((key) => manifest[key].isEntry);
if (!entryKey) throw new Error('The Vite manifest has no entry.');

const staticKeys = new Set();
const visitStatic = (key) => {
  if (staticKeys.has(key)) return;
  staticKeys.add(key);
  for (const imported of manifest[key]?.imports ?? []) visitStatic(imported);
};
visitStatic(entryKey);

const isProviderEntry = (key) => {
  const name = manifest[key]?.name ?? '';
  return (
    /(?:packages|@playdeck)\/provider-(?:native|hls|youtube|vimeo)/.test(key) ||
    /(?:packages|@playdeck)\/provider-(?:native|hls|youtube|vimeo)/.test(name)
  );
};
const providerKeys = Object.keys(manifest).filter(isProviderEntry);
const nativeProviderKey = providerKeys.find((key) =>
  key.includes('provider-native')
);
if (!nativeProviderKey) {
  throw new Error('The consumer build did not emit a native provider chunk.');
}
for (const key of providerKeys) {
  if (staticKeys.has(key)) {
    throw new Error(`Provider adapter leaked into the initial graph: ${key}`);
  }
}

const mime = {
  '.css': 'text/css',
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.json': 'application/json',
  '.mp4': 'video/mp4'
};
const server = createServer(async (request, response) => {
  const pathname = request.url === '/' ? '/index.html' : (request.url ?? '/');
  const safePath = normalize(pathname).replace(/^(\.\.(\/|\\|$))+/, '');
  try {
    const body = await readFile(new URL(`.${safePath}`, root));
    response.writeHead(200, {
      'content-type': mime[extname(safePath)] ?? 'application/octet-stream'
    });
    response.end(body);
  } catch {
    response.writeHead(404);
    response.end();
  }
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const address = server.address();
if (!address || typeof address === 'string') {
  throw new Error('Could not resolve fixture server address.');
}

const nativeFile = `/${manifest[nativeProviderKey].file}`;
const requestedScripts = [];
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage();
  page.on('request', (request) => {
    if (request.resourceType() === 'script') {
      requestedScripts.push(new URL(request.url()).pathname);
    }
  });
  await page.goto(`http://127.0.0.1:${address.port}`);
  await page.getByRole('button', { name: 'Play video' }).waitFor();
  if (requestedScripts.includes(nativeFile)) {
    throw new Error('Native provider loaded before interaction.');
  }
  const nativeRequest = page.waitForRequest((request) => {
    return new URL(request.url()).pathname === nativeFile;
  });
  await page.getByRole('button', { name: 'Play video' }).click();
  await nativeRequest;
} finally {
  await browser.close();
  await new Promise((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve()))
  );
}
```

- [ ] **Step 3: Wire workspace and root script**

Add this workspace glob:

```yaml
- tests/bundle/*
```

Replace the root `test:bundle` placeholder with:

```json
"test:bundle": "pnpm --filter @playdeck/core build && pnpm --filter @playdeck/provider-native build && pnpm --filter @playdeck/react build && pnpm --filter @playdeck/bundle-native-only build && pnpm --filter @playdeck/bundle-native-only test"
```

Run:

```sh
pnpm install
```

Expected: only workspace fixture entries change in the lockfile; no new build
approval appears.

- [ ] **Step 4: Run the bundle test to verify and correct graph assertions**

Run:

```sh
pnpm test:bundle
```

Expected: consumer build succeeds; manifest traversal proves provider adapters
are outside the initial static graph; Chromium proves the native chunk is
requested only after interaction.

The verifier already matches both normalized manifest keys and entry `name`
fields. Do not replace that graph check with a scan of every emitted
JavaScript file or forbid lazy chunks on disk.

- [ ] **Step 5: Run the full issue and repository gates**

Run serially:

```sh
pnpm format
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm test:e2e
pnpm build
pnpm test:packages
pnpm test:bundle
pnpm test:integrations
```

Expected: every command exits zero. `pnpm format` may change only files touched
by this issue; inspect the diff and revert no user-owned changes.

- [ ] **Step 6: Confirm dependency and bundle invariants**

Run:

```sh
git diff -- package.json packages/react/package.json pnpm-workspace.yaml pnpm-lock.yaml
rg -n '"@storybook/|"storybook"|"hls.js"|"@vimeo/player"' package.json packages/*/package.json apps/*/package.json tests/*/*/package.json
git status --short
```

Expected:

- no Storybook, HLS, YouTube, or Vimeo runtime dependency was added;
- `allowBuilds` still contains only `sharp@0.34.5`;
- Storybook remains deferred to issue #19 and will be pinned to `10.5.3`;
- status contains only issue #7 product/test changes.

- [ ] **Step 7: Commit Task 5**

```sh
git add package.json pnpm-workspace.yaml pnpm-lock.yaml tests/bundle/native-only
git commit -m "test: verify lazy provider bundle loading"
```

---

## Execution protocol

1. Use `superpowers:using-git-worktrees` to create
   `.worktrees/issue-7-activation` on branch `issue-7-activation`.
2. Run `pnpm install --frozen-lockfile` and the baseline repository tests before
   Task 1.
3. Use `superpowers:subagent-driven-development`.
4. Dispatch one fresh `fork_turns: none` implementer per task using a brief
   file under `.planning/briefs/`.
5. After each task, dispatch a fresh spec reviewer for the exact task commit,
   then a fresh code-quality reviewer for the same delta.
6. Keep pnpm install, build, typecheck, Vitest browser, and Playwright commands
   serial within the worktree.
7. Do not start Task N+1 until Task N's two review gates pass and corrections
   are committed.
8. After Task 5, use `superpowers:verification-before-completion`, then
   `superpowers:requesting-code-review`.
9. Push and create a PR only after all verification and review gates pass.
10. Close issue #7 from the merged PR evidence, unblock #19, and begin #19 in a
    new worktree with Storybook packages pinned to stable `10.5.3`.
