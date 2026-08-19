// @vitest-environment happy-dom

import {
  act,
  cleanup,
  fireEvent,
  render,
  screen
} from '@testing-library/react';
import { createRef, useLayoutEffect, type ReactNode, type Ref } from 'react';
import { renderToString } from 'react-dom/server';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import {
  detectSource,
  PlayerController,
  type CommandResult,
  type ProviderAdapter,
  type ProviderStateListener
} from '@playdeck/core';
import type { NativePlaybackOptions } from '@playdeck/provider-native';
import {
  INTERNAL_CONTROLLER,
  type InternalControllerAccess
} from '../src/internal-controller';
import * as Player from '../src/index';
import { loadProvider } from '../src/provider-loaders';
import { useActivation } from '../src/use-activation';
import { createFakeProvider, deferred } from './fixtures/fake-provider';

vi.mock('../src/provider-loaders', () => ({
  loadProvider: vi.fn()
}));

class ControlledIntersectionObserver implements IntersectionObserver {
  static instances: ControlledIntersectionObserver[] = [];
  readonly root = null;
  readonly thresholds: number[];
  readonly rootMargin: string;
  readonly scrollMargin = '0px';
  private readonly callback: IntersectionObserverCallback;
  private target?: Element;

  constructor(
    callback: IntersectionObserverCallback,
    options: IntersectionObserverInit = {}
  ) {
    this.callback = callback;
    this.rootMargin = options.rootMargin ?? '0px';
    this.thresholds = Array.isArray(options.threshold)
      ? options.threshold
      : [options.threshold ?? 0];
    ControlledIntersectionObserver.instances.push(this);
  }

  disconnect = vi.fn();
  observe = vi.fn((target: Element) => {
    this.target = target;
  });
  takeRecords = () => [];
  unobserve = vi.fn();

  /**
   * Reports an entry for the observed target, as a scroll would. Defaults to
   * a full, unobstructed intersection; a test pinning `loadThreshold`
   * behaviour overrides `intersectionRatio`, `rootBounds` and
   * `boundingClientRect` to describe a partial or an oversized one instead.
   */
  intersect(entry: Partial<IntersectionObserverEntry> = {}) {
    const target = this.target!;
    const rect = target.getBoundingClientRect();
    this.callback(
      [
        {
          boundingClientRect: rect,
          intersectionRatio: 1,
          intersectionRect: rect,
          isIntersecting: true,
          rootBounds: null,
          target,
          time: 0,
          ...entry
        }
      ],
      this
    );
  }
}

const mockedLoadProvider = vi.mocked(loadProvider);

const firstRequestedVideo = (): HTMLVideoElement | undefined => {
  const media = mockedLoadProvider.mock.calls[0]?.[0].media;
  return media instanceof HTMLVideoElement ? media : undefined;
};

type ActivationProbeProps = {
  readonly autoplay?: Player.RootProps['autoplay'];
  readonly controller: PlayerController;
  readonly loading?: Player.PlayerLoadingStrategy;
  readonly loadMargin?: string;
  readonly loadThreshold?: number;
  readonly mediaKey?: string;
  readonly nativeOptions?: NativePlaybackOptions;
  readonly onActivate?: (activate: () => void) => void;
  readonly onLayout?: () => void;
  readonly preload?: Player.PlayerPreload;
  readonly providerOptions?: Player.PlayerProviderOptions;
  readonly showMedia?: boolean;
  readonly showViewport?: boolean;
  readonly source?: Player.RootProps['source'];
  readonly viewportKey?: string;
};

const ActivationProbe = ({
  autoplay = false,
  controller,
  loading = 'eager',
  loadMargin = '200px 0px',
  loadThreshold = 0,
  mediaKey = 'media',
  nativeOptions = {},
  onActivate,
  onLayout,
  preload = 'metadata',
  providerOptions,
  showMedia = true,
  showViewport = true,
  source = '/tracer.mp4',
  viewportKey = 'viewport'
}: ActivationProbeProps) => {
  const {
    activateFromInteraction,
    registerMedia,
    registerViewport,
    sourceCommitted
  } = useActivation({
    autoplay,
    controller,
    loadMargin,
    loadThreshold,
    loading,
    nativeOptions,
    prepareMedia: () => undefined,
    preload,
    providerOptions,
    source: detectSource(source)
  });
  useLayoutEffect(() => {
    onActivate?.(activateFromInteraction);
    onLayout?.();
  }, [activateFromInteraction, onActivate, onLayout]);
  return (
    <>
      {showViewport ? (
        <div
          data-testid="activation-viewport"
          key={viewportKey}
          ref={registerViewport}
        />
      ) : null}
      {sourceCommitted && showMedia ? (
        <video
          data-source={source}
          data-testid="activation-media"
          key={mediaKey}
          ref={registerMedia}
        />
      ) : null}
    </>
  );
};

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

beforeEach(() => {
  ControlledIntersectionObserver.instances = [];
  mockedLoadProvider.mockReset();
  vi.stubGlobal('IntersectionObserver', ControlledIntersectionObserver);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.useRealTimers();
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
  await vi.waitFor(() =>
    expect(fake.counts()).toMatchObject({ attachCount: 1, loadCount: 1 })
  );
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

test('the default load threshold activates at the first visible pixel', async () => {
  const fake = createFakeProvider();
  mockedLoadProvider.mockResolvedValue(fake.adapter);

  render(fixture());

  const observer = ControlledIntersectionObserver.instances[0]!;
  expect(observer.thresholds).toEqual([0]);

  act(() =>
    observer.intersect({
      boundingClientRect: new DOMRectReadOnly(0, 0, 400, 800),
      intersectionRatio: 0.01,
      rootBounds: new DOMRectReadOnly(0, 0, 400, 800)
    })
  );

  await vi.waitFor(() => expect(mockedLoadProvider).toHaveBeenCalledOnce());
});

test('viewport uses a custom load threshold', () => {
  render(fixture({ loadThreshold: 0.75 }));

  expect(ControlledIntersectionObserver.instances[0]?.thresholds).toEqual([
    0, 0.75
  ]);
});

test('viewport activation waits for the configured load threshold', async () => {
  const fake = createFakeProvider();
  mockedLoadProvider.mockResolvedValue(fake.adapter);

  render(fixture({ loadThreshold: 1 }));
  const observer = ControlledIntersectionObserver.instances[0]!;
  const rootBounds = new DOMRectReadOnly(0, 0, 400, 800);

  act(() =>
    observer.intersect({
      boundingClientRect: new DOMRectReadOnly(0, 0, 400, 800),
      intersectionRatio: 0.5,
      rootBounds
    })
  );
  await Promise.resolve();
  expect(mockedLoadProvider).not.toHaveBeenCalled();

  act(() =>
    observer.intersect({
      boundingClientRect: new DOMRectReadOnly(0, 0, 400, 800),
      intersectionRatio: 1,
      rootBounds
    })
  );
  await vi.waitFor(() => expect(mockedLoadProvider).toHaveBeenCalledOnce());
});

// The brief's own example: a `9/16` Shorts player on a window shorter than it
// is tall can never reach `intersectionRatio: 1` -- the target is taller than
// the root at every scroll position -- so an unreachable `loadThreshold` must
// not leave it dormant forever.
test('an oversized target activates despite an unreachable load threshold', async () => {
  const fake = createFakeProvider();
  mockedLoadProvider.mockResolvedValue(fake.adapter);

  render(fixture({ loadThreshold: 1 }));
  const observer = ControlledIntersectionObserver.instances[0]!;

  act(() =>
    observer.intersect({
      // Taller than the 800px root: 100% coverage is not a position that
      // exists, at any scroll offset.
      boundingClientRect: new DOMRectReadOnly(0, 0, 400, 2000),
      intersectionRatio: 0.4,
      rootBounds: new DOMRectReadOnly(0, 0, 400, 800)
    })
  );

  await vi.waitFor(() => expect(mockedLoadProvider).toHaveBeenCalledOnce());
});

test('viewport observer rebuilds when loadThreshold changes', async () => {
  const controller = new PlayerController();
  const { rerender } = render(
    <ActivationProbe
      controller={controller}
      loading="viewport"
      loadThreshold={0}
      showMedia={false}
    />
  );
  expect(ControlledIntersectionObserver.instances).toHaveLength(1);
  const firstObserver = ControlledIntersectionObserver.instances[0]!;

  rerender(
    <ActivationProbe
      controller={controller}
      loading="viewport"
      loadThreshold={1}
      showMedia={false}
    />
  );

  await vi.waitFor(() =>
    expect(ControlledIntersectionObserver.instances).toHaveLength(2)
  );
  expect(firstObserver.disconnect).toHaveBeenCalled();
  expect(
    ControlledIntersectionObserver.instances[1]?.observe
  ).toHaveBeenCalledWith(screen.getByTestId('activation-viewport'));
  expect(ControlledIntersectionObserver.instances[1]?.thresholds).toEqual([
    0, 1
  ]);
});

test('dormant viewport activation uses native options changed before intersection', async () => {
  const fake = createFakeProvider();
  mockedLoadProvider.mockResolvedValue(fake.adapter);
  const controller = new PlayerController();
  const { rerender } = render(
    <ActivationProbe
      controller={controller}
      loading="viewport"
      nativeOptions={{ startTime: 1 }}
    />
  );
  const observer = ControlledIntersectionObserver.instances[0]!;

  rerender(
    <ActivationProbe
      controller={controller}
      loading="viewport"
      nativeOptions={{ startTime: 2 }}
    />
  );
  act(() => observer.intersect());

  await vi.waitFor(() => expect(mockedLoadProvider).toHaveBeenCalledOnce());
  expect(mockedLoadProvider.mock.calls[0]?.[0].nativeOptions).toEqual({
    startTime: 2
  });
});

test('invalid viewport margin construction reports a non-recoverable configuration error', async () => {
  class ThrowingConstructorObserver extends ControlledIntersectionObserver {
    constructor(
      callback: IntersectionObserverCallback,
      options?: IntersectionObserverInit
    ) {
      super(callback, options);
      throw new DOMException('Invalid root margin.', 'SyntaxError');
    }
  }
  vi.stubGlobal('IntersectionObserver', ThrowingConstructorObserver);
  const handle = createRef<Player.PlayerHandle>();

  render(fixture({ ref: handle }));

  await vi.waitFor(() =>
    expect(handle.current?.getState()).toMatchObject({
      activation: 'error',
      error: {
        category: 'configuration',
        fatal: false,
        recoverable: false
      },
      lifecycle: 'error'
    })
  );
  expect(mockedLoadProvider).not.toHaveBeenCalled();
});

test('viewport observation failures report a non-recoverable configuration error', async () => {
  class ThrowingObserveObserver extends ControlledIntersectionObserver {
    override observe = vi.fn(() => {
      throw new Error('Target cannot be observed.');
    });
  }
  vi.stubGlobal('IntersectionObserver', ThrowingObserveObserver);
  const handle = createRef<Player.PlayerHandle>();

  render(fixture({ ref: handle }));

  await vi.waitFor(() =>
    expect(handle.current?.getState()).toMatchObject({
      activation: 'error',
      error: {
        category: 'configuration',
        fatal: false,
        recoverable: false
      },
      lifecycle: 'error'
    })
  );
  expect(
    ControlledIntersectionObserver.instances[0]?.disconnect
  ).toHaveBeenCalled();
  expect(mockedLoadProvider).not.toHaveBeenCalled();
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
      error: { category: 'configuration', fatal: false, recoverable: false }
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

test('a new source is not committed on the render that introduces it', async () => {
  const pending = deferred<ProviderAdapter>();
  const controller = new PlayerController();
  let activateFromInteraction!: () => void;
  let secondSourceCommitted: boolean | undefined;
  mockedLoadProvider.mockReturnValue(pending.promise);
  const onActivate = (activate: () => void) => {
    activateFromInteraction = activate;
  };
  const { rerender } = render(
    <ActivationProbe
      controller={controller}
      loading="interaction"
      onActivate={onActivate}
      source="/first.mp4"
    />
  );
  act(() => activateFromInteraction());
  await vi.waitFor(() => expect(mockedLoadProvider).toHaveBeenCalledOnce());

  rerender(
    <ActivationProbe
      controller={controller}
      loading="interaction"
      onActivate={onActivate}
      onLayout={() => {
        secondSourceCommitted =
          screen.queryByTestId('activation-media')?.dataset.source ===
          '/second.mp4';
      }}
      source="/second.mp4"
    />
  );

  expect(secondSourceCommitted).toBe(false);
});

test('a stale viewport callback cannot activate after switching to interaction', async () => {
  const controller = new PlayerController();
  const { rerender } = render(
    <ActivationProbe
      controller={controller}
      loading="viewport"
      showMedia={false}
    />
  );
  const staleObserver = ControlledIntersectionObserver.instances[0]!;

  rerender(
    <ActivationProbe
      controller={controller}
      loading="interaction"
      showMedia={false}
    />
  );
  act(() => staleObserver.intersect());

  await Promise.resolve();
  expect(controller.getState()).toMatchObject({
    activation: 'dormant',
    provider: null
  });
  expect(mockedLoadProvider).not.toHaveBeenCalled();
});

test('a strategy change invalidates a pending loader', async () => {
  const pending = deferred<ProviderAdapter>();
  const stale = createFakeProvider();
  const controller = new PlayerController();
  mockedLoadProvider.mockReturnValue(pending.promise);
  const { rerender } = render(
    <ActivationProbe controller={controller} loading="eager" />
  );
  await vi.waitFor(() => expect(mockedLoadProvider).toHaveBeenCalledOnce());

  rerender(<ActivationProbe controller={controller} loading="interaction" />);
  pending.resolve(stale.adapter);

  await vi.waitFor(() => expect(stale.counts().destroyCount).toBe(1));
  expect(stale.counts()).toMatchObject({ attachCount: 0, loadCount: 0 });
  expect(controller.getState()).toMatchObject({
    activation: 'dormant',
    provider: null
  });
});

test('a strategy change detaches an installed adapter and returns to dormant', async () => {
  const installed = createFakeProvider();
  const controller = new PlayerController();
  mockedLoadProvider.mockResolvedValue(installed.adapter);
  const { rerender } = render(
    <ActivationProbe controller={controller} loading="eager" />
  );
  await vi.waitFor(() =>
    expect(installed.counts()).toMatchObject({ attachCount: 1, loadCount: 1 })
  );

  rerender(<ActivationProbe controller={controller} loading="interaction" />);

  await vi.waitFor(() => expect(installed.counts().destroyCount).toBe(1));
  expect(controller.getState()).toMatchObject({
    activation: 'dormant',
    provider: null
  });
  expect(screen.queryByTestId('activation-media')).toBeNull();
});

test('interaction plays once when installation synchronously becomes ready', async () => {
  const controller = new PlayerController();
  const listeners = new Set<ProviderStateListener>();
  const adapter: ProviderAdapter = {
    provider: 'native',
    attach: () => {
      listeners.forEach((listener) =>
        listener({ activation: 'ready', lifecycle: 'ready' })
      );
    },
    destroy: () => undefined,
    load: () => undefined,
    play: async () => ({ ok: true }),
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    }
  };
  mockedLoadProvider.mockResolvedValue(adapter);
  const playWithOrigin = vi.spyOn(controller, 'playWithOrigin');
  let activateFromInteraction!: () => void;

  render(
    <ActivationProbe
      controller={controller}
      loading="interaction"
      onActivate={(activate) => {
        activateFromInteraction = activate;
      }}
    />
  );
  act(() => activateFromInteraction());

  await vi.waitFor(() =>
    expect(playWithOrigin).toHaveBeenCalledExactlyOnceWith('user')
  );
});

test('interaction queues its play behind load when attach reports readiness', async () => {
  const installationOrder: string[] = [];
  const controller = new PlayerController();
  const listeners = new Set<ProviderStateListener>();
  const adapter: ProviderAdapter = {
    provider: 'native',
    attach: () => {
      listeners.forEach((listener) =>
        listener({ activation: 'ready', lifecycle: 'ready' })
      );
    },
    destroy: () => undefined,
    load: () => {
      installationOrder.push('load');
    },
    play: async () => {
      installationOrder.push('play');
      return { ok: true };
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    }
  };
  mockedLoadProvider.mockResolvedValue(adapter);
  const playWithOrigin = vi.spyOn(controller, 'playWithOrigin');
  let activateFromInteraction!: () => void;

  render(
    <ActivationProbe
      controller={controller}
      loading="interaction"
      onActivate={(activate) => {
        activateFromInteraction = activate;
      }}
    />
  );
  act(() => activateFromInteraction());

  await vi.waitFor(() =>
    expect(playWithOrigin).toHaveBeenCalledExactlyOnceWith('user')
  );
  expect(installationOrder).toEqual(['load', 'play']);
});

test('interaction queues its play behind load when attach yields before reporting readiness', async () => {
  const installationOrder: string[] = [];
  const controller = new PlayerController();
  const listeners = new Set<ProviderStateListener>();
  const adapter: ProviderAdapter = {
    provider: 'native',
    attach: async () => {
      await Promise.resolve();
      listeners.forEach((listener) =>
        listener({ activation: 'ready', lifecycle: 'ready' })
      );
    },
    destroy: () => undefined,
    load: () => {
      installationOrder.push('load');
    },
    play: async () => {
      installationOrder.push('play');
      return { ok: true };
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    }
  };
  mockedLoadProvider.mockResolvedValue(adapter);
  const playWithOrigin = vi.spyOn(controller, 'playWithOrigin');
  let activateFromInteraction!: () => void;

  render(
    <ActivationProbe
      controller={controller}
      loading="interaction"
      onActivate={(activate) => {
        activateFromInteraction = activate;
      }}
    />
  );
  act(() => activateFromInteraction());

  await vi.waitFor(() =>
    expect(playWithOrigin).toHaveBeenCalledExactlyOnceWith('user')
  );
  expect(installationOrder).toEqual(['load', 'play']);
});

test('interaction discards a loader resolved against an immediate error snapshot', async () => {
  const pending = deferred<ProviderAdapter>();
  const fake = createFakeProvider();
  const controller = new PlayerController();
  const playWithOrigin = vi.spyOn(controller, 'playWithOrigin');
  let activateFromInteraction!: () => void;
  mockedLoadProvider.mockReturnValue(pending.promise);

  render(
    <ActivationProbe
      controller={controller}
      loading="interaction"
      onActivate={(activate) => {
        activateFromInteraction = activate;
      }}
    />
  );
  act(() => activateFromInteraction());
  await vi.waitFor(() => expect(mockedLoadProvider).toHaveBeenCalledOnce());
  act(() => {
    controller.setActivation({
      activation: 'error',
      error: {
        category: 'configuration',
        fatal: false,
        message: 'Interaction was invalidated.',
        recoverable: false
      }
    });
  });
  pending.resolve(fake.adapter);

  await vi.waitFor(() => expect(fake.counts().destroyCount).toBe(1));
  expect(fake.counts()).toMatchObject({ attachCount: 0, loadCount: 0 });
  act(() => fake.emit({ activation: 'ready', lifecycle: 'ready' }));
  expect(playWithOrigin).not.toHaveBeenCalled();
});

test('detaching media invalidates its pending loader', async () => {
  const pending = deferred<ProviderAdapter>();
  const stale = createFakeProvider();
  const controller = new PlayerController();
  mockedLoadProvider.mockReturnValue(pending.promise);
  const { rerender } = render(
    <ActivationProbe controller={controller} showMedia />
  );
  await vi.waitFor(() => expect(mockedLoadProvider).toHaveBeenCalledOnce());

  rerender(<ActivationProbe controller={controller} showMedia={false} />);
  pending.resolve(stale.adapter);

  await vi.waitFor(() => expect(stale.counts().destroyCount).toBe(1));
  expect(stale.counts()).toMatchObject({ attachCount: 0, loadCount: 0 });
  expect(controller.getState().provider).toBeNull();
});

test('replacing media detaches and reloads for the replacement node', async () => {
  const previous = createFakeProvider();
  const replacement = createFakeProvider();
  const controller = new PlayerController();
  mockedLoadProvider
    .mockResolvedValueOnce(previous.adapter)
    .mockResolvedValueOnce(replacement.adapter);
  const { rerender } = render(
    <ActivationProbe controller={controller} mediaKey="first" />
  );
  await vi.waitFor(() =>
    expect(previous.counts()).toMatchObject({ attachCount: 1, loadCount: 1 })
  );
  const firstMedia = screen.getByTestId('activation-media');

  rerender(<ActivationProbe controller={controller} mediaKey="second" />);

  await vi.waitFor(() => expect(mockedLoadProvider).toHaveBeenCalledTimes(2));
  const secondMedia = screen.getByTestId('activation-media');
  expect(secondMedia).not.toBe(firstMedia);
  expect(mockedLoadProvider.mock.calls[1]?.[0].media).toBe(secondMedia);
  await vi.waitFor(() =>
    expect(replacement.counts()).toMatchObject({ attachCount: 1, loadCount: 1 })
  );
  expect(previous.counts().destroyCount).toBe(1);
});

test.each([
  [
    'startTime',
    { startTime: 1 } satisfies NativePlaybackOptions,
    { startTime: 2 } satisfies NativePlaybackOptions
  ],
  [
    'endTime',
    { endTime: 8 } satisfies NativePlaybackOptions,
    { endTime: 9 } satisfies NativePlaybackOptions
  ],
  [
    'loop',
    { loop: false } satisfies NativePlaybackOptions,
    { loop: true } satisfies NativePlaybackOptions
  ]
])(
  'replaces the installed adapter when same-media %s changes',
  async (_option, initialOptions, nextOptions) => {
    const previous = createFakeProvider();
    const replacement = createFakeProvider();
    const controller = new PlayerController();
    mockedLoadProvider
      .mockResolvedValueOnce(previous.adapter)
      .mockResolvedValueOnce(replacement.adapter);
    const { rerender } = render(
      <ActivationProbe controller={controller} nativeOptions={initialOptions} />
    );
    await vi.waitFor(() =>
      expect(previous.counts()).toMatchObject({
        attachCount: 1,
        loadCount: 1
      })
    );

    rerender(
      <ActivationProbe controller={controller} nativeOptions={nextOptions} />
    );

    await vi.waitFor(() => expect(mockedLoadProvider).toHaveBeenCalledTimes(2));
    expect(mockedLoadProvider.mock.calls[1]?.[0].nativeOptions).toEqual(
      nextOptions
    );
    await vi.waitFor(() =>
      expect(replacement.counts()).toMatchObject({
        attachCount: 1,
        loadCount: 1
      })
    );
    expect(previous.counts().destroyCount).toBe(1);
  }
);

test('forwards the provider option bag from Root to the loader', async () => {
  const fake = createFakeProvider();
  mockedLoadProvider.mockResolvedValue(fake.adapter);

  render(
    fixture({
      loading: 'eager',
      providerOptions: { wistia: { playerColor: 'ff0000' } }
    })
  );

  await vi.waitFor(() => expect(mockedLoadProvider).toHaveBeenCalledOnce());
  // The fixture's source is native, so `Root`'s `resolvedProviderOptions`
  // leaves the bag untouched -- `controls` only folds into whichever bag
  // belongs to the detected source's own provider (`root.tsx`).
  expect(mockedLoadProvider.mock.calls[0]?.[0].providerOptions).toEqual({
    wistia: { playerColor: 'ff0000' }
  });
});

test('keeps the installed adapter when an equal provider option bag is passed again', async () => {
  const previous = createFakeProvider();
  const replacement = createFakeProvider();
  const controller = new PlayerController();
  mockedLoadProvider
    .mockResolvedValueOnce(previous.adapter)
    .mockResolvedValueOnce(replacement.adapter);
  const { rerender } = render(
    <ActivationProbe
      controller={controller}
      providerOptions={{ wistia: { swatch: false } }}
    />
  );
  await vi.waitFor(() =>
    expect(previous.counts()).toMatchObject({ attachCount: 1, loadCount: 1 })
  );

  // A fresh object literal with the same values, as an inline prop produces on
  // every render.
  rerender(
    <ActivationProbe
      controller={controller}
      providerOptions={{ wistia: { swatch: false } }}
    />
  );
  await act(async () => undefined);

  expect(mockedLoadProvider).toHaveBeenCalledOnce();
  expect(replacement.counts()).toMatchObject({ attachCount: 0, loadCount: 0 });
  expect(previous.counts()).toMatchObject({
    attachCount: 1,
    destroyCount: 0,
    loadCount: 1
  });
});

test('replaces the installed adapter when a same-media provider option changes', async () => {
  const previous = createFakeProvider();
  const replacement = createFakeProvider();
  const controller = new PlayerController();
  mockedLoadProvider
    .mockResolvedValueOnce(previous.adapter)
    .mockResolvedValueOnce(replacement.adapter);
  const { rerender } = render(
    <ActivationProbe
      controller={controller}
      providerOptions={{ wistia: { swatch: false } }}
    />
  );
  await vi.waitFor(() =>
    expect(previous.counts()).toMatchObject({ attachCount: 1, loadCount: 1 })
  );

  rerender(
    <ActivationProbe
      controller={controller}
      providerOptions={{ wistia: { swatch: true } }}
    />
  );

  await vi.waitFor(() => expect(mockedLoadProvider).toHaveBeenCalledTimes(2));
  expect(mockedLoadProvider.mock.calls[1]?.[0].providerOptions).toEqual({
    wistia: { swatch: true }
  });
  await vi.waitFor(() =>
    expect(replacement.counts()).toMatchObject({ attachCount: 1, loadCount: 1 })
  );
  expect(previous.counts().destroyCount).toBe(1);
});

// A caller that assembles its bag from its own props writes
// `poster: props.poster`, so a key is present and `undefined` on one render and
// absent on the next. Both build the identical element, so neither is a reason
// to rebuild a live embed.
test.each([
  [
    'a key present and undefined against that key absent',
    { wistia: { swatch: false } } satisfies Player.PlayerProviderOptions,
    {
      wistia: { swatch: false, poster: undefined }
    } satisfies Player.PlayerProviderOptions
  ],
  [
    'no bag at all against an empty bag',
    undefined,
    { wistia: {} } satisfies Player.PlayerProviderOptions
  ]
])(
  'keeps the installed adapter when the bag changes only by %s',
  async (_case, initialOptions, nextOptions) => {
    const previous = createFakeProvider();
    const replacement = createFakeProvider();
    const controller = new PlayerController();
    mockedLoadProvider
      .mockResolvedValueOnce(previous.adapter)
      .mockResolvedValueOnce(replacement.adapter);
    const { rerender } = render(
      <ActivationProbe
        controller={controller}
        providerOptions={initialOptions}
      />
    );
    await vi.waitFor(() =>
      expect(previous.counts()).toMatchObject({ attachCount: 1, loadCount: 1 })
    );

    rerender(
      <ActivationProbe controller={controller} providerOptions={nextOptions} />
    );
    await act(async () => undefined);

    expect(mockedLoadProvider).toHaveBeenCalledOnce();
    expect(replacement.counts()).toMatchObject({
      attachCount: 0,
      loadCount: 0
    });
    expect(previous.counts().destroyCount).toBe(0);
  }
);

// The other direction of dropping the key-count check: a key added with a real
// value is a change, and is only seen by comparing the keys of both bags.
test('replaces the installed adapter when a provider option is added to the bag', async () => {
  const previous = createFakeProvider();
  const replacement = createFakeProvider();
  const controller = new PlayerController();
  mockedLoadProvider
    .mockResolvedValueOnce(previous.adapter)
    .mockResolvedValueOnce(replacement.adapter);
  const { rerender } = render(
    <ActivationProbe
      controller={controller}
      providerOptions={{ wistia: { swatch: false } }}
    />
  );
  await vi.waitFor(() =>
    expect(previous.counts()).toMatchObject({ attachCount: 1, loadCount: 1 })
  );

  rerender(
    <ActivationProbe
      controller={controller}
      providerOptions={{ wistia: { swatch: false, poster: '/still.png' } }}
    />
  );

  await vi.waitFor(() => expect(mockedLoadProvider).toHaveBeenCalledTimes(2));
  expect(mockedLoadProvider.mock.calls[1]?.[0].providerOptions).toEqual({
    wistia: { swatch: false, poster: '/still.png' }
  });
  await vi.waitFor(() =>
    expect(replacement.counts()).toMatchObject({ attachCount: 1, loadCount: 1 })
  );
  expect(previous.counts().destroyCount).toBe(1);
});

test('native option changes invalidate an older pending load', async () => {
  const firstLoad = deferred<ProviderAdapter>();
  const stale = createFakeProvider();
  const current = createFakeProvider();
  const controller = new PlayerController();
  mockedLoadProvider
    .mockReturnValueOnce(firstLoad.promise)
    .mockResolvedValueOnce(current.adapter);
  const { rerender } = render(
    <ActivationProbe controller={controller} nativeOptions={{ startTime: 1 }} />
  );
  await vi.waitFor(() => expect(mockedLoadProvider).toHaveBeenCalledOnce());

  rerender(
    <ActivationProbe controller={controller} nativeOptions={{ startTime: 2 }} />
  );
  await vi.waitFor(() => expect(mockedLoadProvider).toHaveBeenCalledTimes(2));
  firstLoad.resolve(stale.adapter);

  await vi.waitFor(() => expect(stale.counts().destroyCount).toBe(1));
  expect(stale.counts()).toMatchObject({ attachCount: 0, loadCount: 0 });
  expect(current.counts()).toMatchObject({ attachCount: 1, loadCount: 1 });
});

test('contains asynchronous stale adapter destroy rejection', async () => {
  const firstLoad = deferred<ProviderAdapter>();
  const stale = createFakeProvider();
  const current = createFakeProvider();
  const destroyRejection = Promise.reject(new Error('stale destroy failed'));
  const catchRejection = vi.spyOn(destroyRejection, 'catch');
  void destroyRejection.catch(() => undefined);
  stale.adapter.destroy = () => destroyRejection;
  mockedLoadProvider
    .mockReturnValueOnce(firstLoad.promise)
    .mockResolvedValueOnce(current.adapter);
  const { rerender } = render(
    fixture({ loading: 'eager', source: '/first.mp4' })
  );
  await vi.waitFor(() => expect(mockedLoadProvider).toHaveBeenCalledOnce());

  rerender(fixture({ loading: 'eager', source: '/second.mp4' }));
  await vi.waitFor(() => expect(mockedLoadProvider).toHaveBeenCalledTimes(2));
  firstLoad.resolve(stale.adapter);

  await vi.waitFor(() => expect(catchRejection).toHaveBeenCalledTimes(2));
});

test('viewport replacement observes the committed replacement target', async () => {
  const controller = new PlayerController();
  const { rerender } = render(
    <ActivationProbe
      controller={controller}
      loading="viewport"
      showMedia={false}
      viewportKey="first"
    />
  );
  expect(ControlledIntersectionObserver.instances).toHaveLength(1);
  const firstObserver = ControlledIntersectionObserver.instances[0]!;
  const firstViewport = screen.getByTestId('activation-viewport');
  expect(firstObserver.observe).toHaveBeenCalledExactlyOnceWith(firstViewport);

  rerender(
    <ActivationProbe
      controller={controller}
      loading="viewport"
      showMedia={false}
      viewportKey="second"
    />
  );

  await vi.waitFor(() =>
    expect(ControlledIntersectionObserver.instances).toHaveLength(2)
  );
  const secondObserver = ControlledIntersectionObserver.instances[1]!;
  const secondViewport = screen.getByTestId('activation-viewport');
  expect(secondViewport).not.toBe(firstViewport);
  expect(firstObserver.disconnect).toHaveBeenCalled();
  expect(secondObserver.observe).toHaveBeenCalledExactlyOnceWith(
    secondViewport
  );
});

test('Viewport runs a consumer callback-ref cleanup on unmount', () => {
  const consumerCleanup = vi.fn();
  const consumerRef = vi.fn((node: HTMLDivElement | null) =>
    node ? consumerCleanup : undefined
  );
  const { unmount } = render(
    <Player.Root loading="eager" source="/tracer.mp4">
      <Player.Viewport ref={consumerRef} />
    </Player.Root>
  );
  expect(consumerRef).toHaveBeenCalledWith(
    document.querySelector('[data-playdeck-part="viewport"]')
  );

  unmount();

  expect(consumerCleanup).toHaveBeenCalledOnce();
});

test('Viewport composes callback-ref replacement cleanup and object-ref clearing', () => {
  const firstCleanup = vi.fn();
  const secondCleanup = vi.fn();
  const firstRef = vi.fn((node: HTMLDivElement | null) =>
    node ? firstCleanup : undefined
  );
  const secondRef = vi.fn((node: HTMLDivElement | null) =>
    node ? secondCleanup : undefined
  );
  const objectRef = createRef<HTMLDivElement>();
  const player = (
    viewportRef:
      | Ref<HTMLDivElement>
      | ((node: HTMLDivElement | null) => (() => void) | undefined)
  ) => (
    <Player.Root loading="eager" source="/tracer.mp4">
      <Player.Viewport ref={viewportRef} />
    </Player.Root>
  );
  const { rerender, unmount } = render(player(firstRef));

  rerender(player(secondRef));
  expect(firstCleanup).toHaveBeenCalledOnce();
  expect(secondRef).toHaveBeenCalledWith(
    document.querySelector('[data-playdeck-part="viewport"]')
  );

  rerender(player(objectRef));
  expect(secondCleanup).toHaveBeenCalledOnce();
  expect(objectRef.current).toBe(
    document.querySelector('[data-playdeck-part="viewport"]')
  );

  unmount();
  expect(objectRef.current).toBeNull();
});

test('viewport restarts its dormant observer after a strategy round-trip', async () => {
  const controller = new PlayerController();
  const { rerender } = render(
    <ActivationProbe
      controller={controller}
      loading="viewport"
      showMedia={false}
    />
  );
  const firstObserver = ControlledIntersectionObserver.instances[0]!;

  rerender(
    <ActivationProbe
      controller={controller}
      loading="interaction"
      showMedia={false}
    />
  );
  expect(firstObserver.disconnect).toHaveBeenCalled();
  rerender(
    <ActivationProbe
      controller={controller}
      loading="viewport"
      showMedia={false}
    />
  );

  await vi.waitFor(() =>
    expect(ControlledIntersectionObserver.instances).toHaveLength(2)
  );
  expect(
    ControlledIntersectionObserver.instances[1]?.observe
  ).toHaveBeenCalledExactlyOnceWith(screen.getByTestId('activation-viewport'));
});

test('source commit rejects an old loader before passive invalidation', async () => {
  const stale = createFakeProvider();
  const current = createFakeProvider();
  const controller = new PlayerController();
  let settleOldLoad: (() => void) | undefined;
  mockedLoadProvider
    .mockReturnValueOnce({
      then: (resolve: (adapter: ProviderAdapter) => void) => {
        settleOldLoad = () => resolve(stale.adapter);
        return Promise.resolve();
      }
    } as Promise<ProviderAdapter>)
    .mockResolvedValueOnce(current.adapter);
  const { rerender } = render(
    <ActivationProbe controller={controller} source="/first.mp4" />
  );
  await vi.waitFor(() => expect(settleOldLoad).toBeTypeOf('function'));

  rerender(
    <ActivationProbe
      controller={controller}
      onLayout={settleOldLoad}
      source="/second.mp4"
    />
  );

  await vi.waitFor(() => expect(stale.counts().destroyCount).toBe(1));
  expect(stale.counts()).toMatchObject({ attachCount: 0, loadCount: 0 });
  await vi.waitFor(() =>
    expect(current.counts()).toMatchObject({ attachCount: 1, loadCount: 1 })
  );
});

test('viewport without IntersectionObserver reports unsupported and never imports', async () => {
  vi.stubGlobal('IntersectionObserver', undefined);
  const handle = createRef<Player.PlayerHandle>();
  render(fixture({ ref: handle }));

  await vi.waitFor(() =>
    expect(handle.current?.getState()).toMatchObject({
      activation: 'error',
      error: { category: 'unsupported' },
      lifecycle: 'error'
    })
  );
  expect(mockedLoadProvider).not.toHaveBeenCalled();
});

test('interaction loading rejects autoplay before importing', async () => {
  const handle = createRef<Player.PlayerHandle>();
  render(fixture({ autoplay: 'muted', loading: 'interaction', ref: handle }));

  await vi.waitFor(() =>
    expect(handle.current?.getState()).toMatchObject({
      activation: 'error',
      error: { category: 'configuration' },
      lifecycle: 'error'
    })
  );
  expect(mockedLoadProvider).not.toHaveBeenCalled();
});

test('Root unmount destroys its installed provider exactly once', async () => {
  const fake = createFakeProvider();
  mockedLoadProvider.mockResolvedValue(fake.adapter);
  const { unmount } = render(fixture({ loading: 'eager' }));
  await vi.waitFor(() =>
    expect(fake.counts()).toMatchObject({ attachCount: 1, loadCount: 1 })
  );

  unmount();

  expect(fake.counts().destroyCount).toBe(1);
});

test('interaction plays exactly once after asynchronous readiness', async () => {
  const fake = createFakeProvider();
  const controller = new PlayerController();
  const playWithOrigin = vi.spyOn(controller, 'playWithOrigin');
  let activateFromInteraction!: () => void;
  mockedLoadProvider.mockResolvedValue(fake.adapter);
  render(
    <ActivationProbe
      controller={controller}
      loading="interaction"
      onActivate={(activate) => {
        activateFromInteraction = activate;
      }}
    />
  );

  act(() => activateFromInteraction());
  await vi.waitFor(() =>
    expect(fake.counts()).toMatchObject({ attachCount: 1, loadCount: 1 })
  );
  act(() => {
    fake.emit({ activation: 'ready', lifecycle: 'ready' });
    fake.emit({ activation: 'ready', lifecycle: 'ready' });
  });

  await vi.waitFor(() =>
    expect(playWithOrigin).toHaveBeenCalledExactlyOnceWith('user')
  );
});

test('interaction with preload none plays immediately after installation exactly once', async () => {
  const installationOrder: string[] = [];
  const fake = createFakeProvider({
    onLoad: () => installationOrder.push('load'),
    onPlay: () => installationOrder.push('play')
  });
  mockedLoadProvider.mockResolvedValue(fake.adapter);
  render(interactionFixture({ preload: 'none' }));

  fireEvent.click(screen.getByRole('button', { name: 'Play video' }));

  await vi.waitFor(() => expect(fake.counts().playCount).toBe(1));
  act(() => {
    fake.emit({ activation: 'ready', lifecycle: 'ready' });
    fake.emit({ activation: 'ready', lifecycle: 'ready' });
  });
  await Promise.resolve();
  expect(fake.counts().playCount).toBe(1);
  expect(installationOrder).toEqual(['load', 'play']);
});

test('real loader returns a Promise and rejects a missing media mount', async () => {
  const actual = await vi.importActual<
    typeof import('../src/provider-loaders')
  >('../src/provider-loaders');
  const detectedSource = detectSource('/tracer.mp4');
  if (detectedSource.status !== 'success') {
    throw new Error('The native test source was not detected.');
  }

  const result = actual.loadProvider({
    media: null,
    nativeOptions: {},
    source: detectedSource.source
  });

  expect(result).toBeInstanceOf(Promise);
  await expect(result).rejects.toThrow(/requires a media mount/i);
});

test('real loader routes hls sources to the hls provider adapter', async () => {
  const actual = await vi.importActual<
    typeof import('../src/provider-loaders')
  >('../src/provider-loaders');
  const detectedSource = detectSource('/hls/master.m3u8');
  if (detectedSource.status !== 'success') {
    throw new Error('The hls test source was not detected.');
  }

  const adapter = await actual.loadProvider({
    media: document.createElement('video'),
    nativeOptions: {},
    source: detectedSource.source
  });
  expect(adapter.provider).toBe('hls');

  await expect(
    actual.loadProvider({
      media: null,
      nativeOptions: {},
      source: detectedSource.source
    })
  ).rejects.toThrow(/requires a media mount/i);
});

test('incompatible autoplay commit discards a resolving interaction loader', async () => {
  const stale = createFakeProvider();
  const controller = new PlayerController();
  let activateFromInteraction!: () => void;
  let settleLoad: (() => void) | undefined;
  mockedLoadProvider.mockReturnValue({
    then: (resolve: (adapter: ProviderAdapter) => void) => {
      settleLoad = () => resolve(stale.adapter);
      return Promise.resolve();
    }
  } as Promise<ProviderAdapter>);
  const onActivate = (activate: () => void) => {
    activateFromInteraction = activate;
  };
  const { rerender } = render(
    <ActivationProbe
      controller={controller}
      loading="interaction"
      onActivate={onActivate}
    />
  );
  act(() => activateFromInteraction());
  await vi.waitFor(() => expect(settleLoad).toBeTypeOf('function'));

  rerender(
    <ActivationProbe
      autoplay="muted"
      controller={controller}
      loading="interaction"
      onActivate={onActivate}
      onLayout={settleLoad}
    />
  );

  await vi.waitFor(() => expect(stale.counts().destroyCount).toBe(1));
  expect(stale.counts()).toMatchObject({ attachCount: 0, loadCount: 0 });
  expect(controller.getState()).toMatchObject({
    activation: 'error',
    error: { category: 'configuration' },
    lifecycle: 'error',
    provider: null
  });
});

test('incompatible autoplay commit ignores a rejecting interaction loader', async () => {
  const controller = new PlayerController();
  const setActivation = vi.spyOn(controller, 'setActivation');
  const failure = new Error('Provider load failed.');
  let activateFromInteraction!: () => void;
  let rejectLoad: (() => void) | undefined;
  mockedLoadProvider.mockReturnValue({
    then: () =>
      ({
        catch: (reject: (cause: unknown) => void) => {
          rejectLoad = () => reject(failure);
        }
      }) as Promise<ProviderAdapter>
  } as Promise<ProviderAdapter>);
  const onActivate = (activate: () => void) => {
    activateFromInteraction = activate;
  };
  const { rerender } = render(
    <ActivationProbe
      controller={controller}
      loading="interaction"
      onActivate={onActivate}
    />
  );
  act(() => activateFromInteraction());
  await vi.waitFor(() => expect(rejectLoad).toBeTypeOf('function'));

  rerender(
    <ActivationProbe
      autoplay="audible"
      controller={controller}
      loading="interaction"
      onActivate={onActivate}
      onLayout={rejectLoad}
    />
  );

  expect(setActivation).not.toHaveBeenCalledWith({
    activation: 'error',
    error: expect.objectContaining({ category: 'provider' })
  });
  expect(controller.getState()).toMatchObject({
    activation: 'error',
    error: { category: 'configuration' },
    lifecycle: 'error',
    provider: null
  });
});

test('server-renders interaction control without media or loading work', () => {
  const markup = renderToString(interactionFixture());

  expect(markup).toContain('data-playdeck-part="activation"');
  expect(markup).toContain('aria-label="Play video"');
  expect(markup).toContain('data-playdeck-part="poster"');
  expect(markup).not.toContain('<video');
  // The live region ships (empty/idle) so buffering can be announced later,
  // but no loading work has started and nothing is announced.
  expect(markup).toContain('data-playdeck-part="loading-indicator"');
  expect(markup).toContain('data-state="idle"');
  expect(markup).not.toContain('Loading video');
  expect(markup).not.toContain('Buffering');
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
  const media = firstRequestedVideo();
  expect(media?.muted).toBe(true);
  expect(screen.getByRole('status').dataset.state).toBe('loading-provider');
  act(() =>
    fake.emit({
      activation: 'ready',
      lifecycle: 'ready',
      muted: media?.muted
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
  expect(firstRequestedVideo()?.muted).toBe(false);
  act(() =>
    fake.emit({
      activation: 'ready',
      lifecycle: 'ready',
      muted: false
    })
  );

  await vi.waitFor(() => expect(fake.counts().playCount).toBe(1));
  expect(screen.getByRole('button', { name: 'Play' })).toBeDefined();
  expect(fake.counts()).toMatchObject({ muteCount: 0, playCount: 1 });
});

test.each([
  { initialMuted: true, nextMuted: false },
  { initialMuted: false, nextMuted: true }
])(
  'reconciles controlled muted $initialMuted→$nextMuted before pending provider installation',
  async ({ initialMuted, nextMuted }) => {
    const pending = deferred<ProviderAdapter>();
    mockedLoadProvider.mockReturnValue(pending.promise);
    const { rerender } = render(interactionFixture({ muted: initialMuted }));
    fireEvent.click(screen.getByRole('button', { name: 'Play video' }));
    await vi.waitFor(() => expect(mockedLoadProvider).toHaveBeenCalledOnce());
    const media = firstRequestedVideo();
    expect(media?.muted).toBe(initialMuted);
    let mutedAtAttach: boolean | undefined;
    const fake = createFakeProvider({
      onAttach: () => {
        mutedAtAttach = media?.muted;
      }
    });

    rerender(interactionFixture({ muted: nextMuted }));
    pending.resolve(fake.adapter);

    await vi.waitFor(() => expect(fake.counts().attachCount).toBe(1));
    expect(mutedAtAttach).toBe(nextMuted);
    expect(fake.counts()).toMatchObject({ muteCount: 0, unmuteCount: 0 });
  }
);

test('reconciles controlled volume and playback rate before pending provider installation', async () => {
  const pending = deferred<ProviderAdapter>();
  mockedLoadProvider.mockReturnValue(pending.promise);
  const { rerender } = render(
    interactionFixture({ playbackRate: 1.25, volume: 0.25 })
  );
  fireEvent.click(screen.getByRole('button', { name: 'Play video' }));
  await vi.waitFor(() => expect(mockedLoadProvider).toHaveBeenCalledOnce());
  const media = firstRequestedVideo();
  expect(media).toMatchObject({ playbackRate: 1.25, volume: 0.25 });
  let preferencesAtAttach:
    { readonly playbackRate?: number; readonly volume?: number } | undefined;
  const fake = createFakeProvider({
    onAttach: () => {
      preferencesAtAttach = media
        ? { playbackRate: media.playbackRate, volume: media.volume }
        : undefined;
    }
  });

  rerender(interactionFixture({ playbackRate: 1.75, volume: 0.75 }));
  pending.resolve(fake.adapter);

  await vi.waitFor(() => expect(fake.counts().attachCount).toBe(1));
  expect(preferencesAtAttach).toEqual({ playbackRate: 1.75, volume: 0.75 });
  expect(fake.counts()).toMatchObject({
    playbackRateCount: 0,
    volumeCount: 0
  });
});

test.each(['muted', 'audible'] as const)(
  'interaction with %s autoplay is a configuration error',
  async (autoplay) => {
    const handle = createRef<Player.PlayerHandle>();
    render(interactionFixture({ autoplay, ref: handle }));

    await vi.waitFor(() =>
      expect(handle.current?.getState()).toMatchObject({
        activation: 'error',
        error: { category: 'configuration', fatal: false, recoverable: false }
      })
    );
    // No retry is on offer here, so the control does not name one (#198).
    const activation = screen.getByRole('button', { name: 'Play video' });
    expect(activation.getAttribute('aria-disabled')).toBe('true');
    fireEvent.click(activation);
    expect(mockedLoadProvider).not.toHaveBeenCalled();
  }
);

test('configuration-error activation becomes actionable after configuration is valid', async () => {
  const fake = createFakeProvider();
  mockedLoadProvider.mockResolvedValue(fake.adapter);
  const { rerender } = render(interactionFixture({ autoplay: 'audible' }));
  const activation = screen.getByRole('button', { name: 'Play video' });
  await vi.waitFor(() =>
    expect(activation.getAttribute('aria-disabled')).toBe('true')
  );

  rerender(interactionFixture({ autoplay: false }));

  await vi.waitFor(() =>
    expect(activation.getAttribute('aria-disabled')).toBeNull()
  );
  fireEvent.click(activation);
  await vi.waitFor(() => expect(mockedLoadProvider).toHaveBeenCalledOnce());
});

// The entry point behind the activation control reads the same state-level
// signal the control does, so a direct call cannot re-activate what a click is
// refused (#198).
test.each([
  { activated: 'error', recoverable: false },
  { activated: 'eligible', recoverable: true }
])(
  'direct interaction activation over an error reporting recoverable $recoverable leaves activation $activated',
  ({ activated, recoverable }) => {
    const controller = new PlayerController();
    let activateFromInteraction!: () => void;
    render(
      <ActivationProbe
        controller={controller}
        loading="interaction"
        onActivate={(activate) => {
          activateFromInteraction = activate;
        }}
        showMedia={false}
      />
    );
    act(() =>
      controller.setActivation({
        activation: 'error',
        error: {
          category: 'source',
          fatal: true,
          message: 'This video is unavailable.',
          recoverable
        }
      })
    );

    act(() => activateFromInteraction());

    expect(controller.getState().activation).toBe(activated);
  }
);

// Every producer of a configuration error, over the one surface that offers a
// retry: the three published by this layer and the muted-autoplay conflict
// published by core. None of them can be retried, so none of them may leave a
// retry on offer (#198).
const configurationErrorProducers = [
  {
    producer: 'interaction loading with autoplay',
    mount: (surface: ReactNode, ref: Ref<Player.PlayerHandle>) => {
      render(
        <Player.Root
          autoplay="muted"
          loading="interaction"
          ref={ref}
          source="/tracer.mp4"
        >
          <Player.Viewport>
            <Player.Media />
            {surface}
          </Player.Viewport>
        </Player.Root>
      );
    }
  },
  {
    producer: 'viewport loading without Player.Viewport',
    mount: (surface: ReactNode, ref: Ref<Player.PlayerHandle>) => {
      render(
        <Player.Root ref={ref} source="/tracer.mp4">
          <Player.Media />
          {surface}
        </Player.Root>
      );
    }
  },
  {
    producer: 'an invalid viewport margin',
    mount: (surface: ReactNode, ref: Ref<Player.PlayerHandle>) => {
      vi.stubGlobal(
        'IntersectionObserver',
        class extends ControlledIntersectionObserver {
          constructor(
            callback: IntersectionObserverCallback,
            options?: IntersectionObserverInit
          ) {
            super(callback, options);
            throw new DOMException('Invalid root margin.', 'SyntaxError');
          }
        }
      );
      render(
        <Player.Root ref={ref} source="/tracer.mp4">
          <Player.Viewport>
            <Player.Media />
            {surface}
          </Player.Viewport>
        </Player.Root>
      );
    }
  },
  {
    producer: 'muted autoplay against a controlled unmuted state',
    mount: (surface: ReactNode, ref: Ref<Player.PlayerHandle>) => {
      render(
        <Player.Root
          autoplay="muted"
          muted={false}
          ref={ref}
          source="/tracer.mp4"
        >
          <Player.Viewport>{surface}</Player.Viewport>
        </Player.Root>
      );
    }
  }
];

test.each(configurationErrorProducers)(
  'a configuration error from $producer offers no retry',
  async ({ mount }) => {
    const renderPropRetry = vi.fn();
    const handle = createRef<Player.PlayerHandle>();

    mount(
      <>
        <Player.ErrorDisplay />
        <Player.ErrorDisplay>
          {({ retry }) => {
            renderPropRetry(retry);
            return <span>reason</span>;
          }}
        </Player.ErrorDisplay>
      </>,
      handle
    );

    await vi.waitFor(() =>
      expect(handle.current?.getState().error).toMatchObject({
        category: 'configuration',
        recoverable: false
      })
    );
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
    expect(renderPropRetry).toHaveBeenLastCalledWith(null);
  }
);

test('LoadingIndicator keeps a persistent live region so buffering is announced', async () => {
  const fake = createFakeProvider();
  mockedLoadProvider.mockResolvedValue(fake.adapter);
  vi.useFakeTimers();
  render(interactionFixture());
  fireEvent.click(screen.getByRole('button', { name: 'Play video' }));
  await vi.waitFor(() => expect(fake.counts().attachCount).toBe(1));
  act(() =>
    fake.emit({ activation: 'ready', lifecycle: 'ready', buffering: false })
  );
  // The provider-load indicator is held by the minimum-visible floor. Drain it
  // so this starts from a hidden region rather than a held one.
  act(() => void vi.advanceTimersByTime(500));

  // The live region exists and is empty before buffering starts, so the later
  // content change is announced instead of mounting already-populated.
  const region = screen.getByRole('status');
  expect(region.dataset.state).toBe('idle');
  expect(region.textContent).toBe('');

  act(() => fake.emit({ buffering: true }));
  act(() => void vi.advanceTimersByTime(500));

  // Same node, now populated — an announced change, not a fresh mount.
  expect(screen.getByRole('status')).toBe(region);
  expect(region.dataset.state).toBe('buffering');
  expect(region.textContent).toBe('Buffering');
});

test('LoadingIndicator ignores a rebuffer shorter than the 500ms show delay', async () => {
  const fake = createFakeProvider();
  mockedLoadProvider.mockResolvedValue(fake.adapter);
  vi.useFakeTimers();
  render(interactionFixture());
  fireEvent.click(screen.getByRole('button', { name: 'Play video' }));
  await vi.waitFor(() => expect(fake.counts().attachCount).toBe(1));
  act(() =>
    fake.emit({ activation: 'ready', lifecycle: 'ready', buffering: false })
  );
  // Drain the provider-load floor so this starts from a hidden indicator.
  act(() => void vi.advanceTimersByTime(500));
  expect(screen.getByRole('status').dataset.state).toBe('idle');

  // A 300ms rebuffer is the common case under healthy adaptive bitrate. It must
  // never reach the DOM: painting it is the flicker this policy exists to stop.
  act(() => fake.emit({ buffering: true }));
  act(() => void vi.advanceTimersByTime(300));

  // Asserted here, inside the rebuffer, rather than only after it clears.
  // Checking the end state alone proves nothing — it is `idle` with or without
  // a debounce, so the test would pass against the very bug it names.
  expect(screen.getByRole('status').dataset.state).toBe('idle');

  act(() => fake.emit({ buffering: false }));
  act(() => void vi.advanceTimersByTime(5_000));

  // And the cancelled timer never fires late.
  expect(screen.getByRole('status').dataset.state).toBe('idle');
});

test('LoadingIndicator admits a sustained stall at 500ms and not before', async () => {
  const fake = createFakeProvider();
  mockedLoadProvider.mockResolvedValue(fake.adapter);
  vi.useFakeTimers();
  render(interactionFixture());
  fireEvent.click(screen.getByRole('button', { name: 'Play video' }));
  await vi.waitFor(() => expect(fake.counts().attachCount).toBe(1));
  act(() =>
    fake.emit({ activation: 'ready', lifecycle: 'ready', buffering: false })
  );
  // Drain the provider-load floor so this starts from a hidden indicator.
  act(() => void vi.advanceTimersByTime(500));
  expect(screen.getByRole('status').dataset.state).toBe('idle');

  act(() => fake.emit({ buffering: true }));

  // The asymmetry is the assertion. Checking only the 500ms side would pass
  // just as happily against no delay at all — a test that cannot fail.
  act(() => void vi.advanceTimersByTime(499));
  expect(screen.getByRole('status').dataset.state).toBe('idle');

  act(() => void vi.advanceTimersByTime(1));
  expect(screen.getByRole('status').dataset.state).toBe('buffering');
});

test('LoadingIndicator swaps loading-provider to buffering without going idle', async () => {
  const fake = createFakeProvider();
  mockedLoadProvider.mockResolvedValue(fake.adapter);
  vi.useFakeTimers();
  render(interactionFixture());
  fireEvent.click(screen.getByRole('button', { name: 'Play video' }));
  const region = screen.getByRole('status');
  expect(region.dataset.state).toBe('loading-provider');

  await vi.waitFor(() => expect(fake.counts().attachCount).toBe(1));

  // The provider becomes ready and immediately buffers its first segment. The
  // indicator is already on screen, so re-running the show delay here would
  // blank it for 500ms and bring it back — manufacturing the exact flicker the
  // delay exists to remove. It must swap the label instead.
  act(() =>
    fake.emit({ activation: 'ready', lifecycle: 'ready', buffering: true })
  );
  expect(region.dataset.state).toBe('buffering');
  expect(region.textContent).toBe('Buffering');
});

test('LoadingIndicator holds an admitted stall for 500ms after it clears', async () => {
  const fake = createFakeProvider();
  mockedLoadProvider.mockResolvedValue(fake.adapter);
  vi.useFakeTimers();
  render(interactionFixture());
  fireEvent.click(screen.getByRole('button', { name: 'Play video' }));
  await vi.waitFor(() => expect(fake.counts().attachCount).toBe(1));
  act(() =>
    fake.emit({ activation: 'ready', lifecycle: 'ready', buffering: false })
  );
  // Drain the provider-load floor so this starts from a hidden indicator.
  act(() => void vi.advanceTimersByTime(500));
  expect(screen.getByRole('status').dataset.state).toBe('idle');

  // A 700ms stall clears 200ms after being admitted. Hiding on that edge would
  // paint the indicator for 200ms — legible to a machine, a blink to a person.
  act(() => fake.emit({ buffering: true }));
  act(() => void vi.advanceTimersByTime(500));
  expect(screen.getByRole('status').dataset.state).toBe('buffering');

  act(() => void vi.advanceTimersByTime(200));
  act(() => fake.emit({ buffering: false }));
  expect(screen.getByRole('status').dataset.state).toBe('buffering');

  // 500ms after it became visible, not 500ms after it cleared.
  act(() => void vi.advanceTimersByTime(300));
  expect(screen.getByRole('status').dataset.state).toBe('idle');
});

test('LoadingIndicator holds a fast provider load for 500ms', async () => {
  const fake = createFakeProvider();
  mockedLoadProvider.mockResolvedValue(fake.adapter);
  vi.useFakeTimers();
  render(interactionFixture());
  fireEvent.click(screen.getByRole('button', { name: 'Play video' }));
  const region = screen.getByRole('status');
  expect(region.dataset.state).toBe('loading-provider');

  await vi.waitFor(() => expect(fake.counts().attachCount).toBe(1));

  // A warm cache resolves the provider in ~50ms. Without the floor the
  // indicator strobes — the same defect as a short rebuffer, under a different
  // state name, so it gets the same floor rather than a carve-out.
  act(() => void vi.advanceTimersByTime(50));
  act(() =>
    fake.emit({ activation: 'ready', lifecycle: 'ready', buffering: false })
  );
  expect(region.dataset.state).toBe('loading-provider');

  act(() => void vi.advanceTimersByTime(450));
  expect(region.dataset.state).toBe('idle');
});

test('LoadingIndicator drops an admitted stall immediately on a terminal error', async () => {
  const fake = createFakeProvider();
  mockedLoadProvider.mockResolvedValue(fake.adapter);
  vi.useFakeTimers();
  render(interactionFixture());
  fireEvent.click(screen.getByRole('button', { name: 'Play video' }));
  await vi.waitFor(() => expect(fake.counts().attachCount).toBe(1));
  act(() =>
    fake.emit({ activation: 'ready', lifecycle: 'ready', buffering: false })
  );
  // Drain the provider-load floor so this starts from a hidden indicator.
  act(() => void vi.advanceTimersByTime(500));

  act(() => fake.emit({ buffering: true }));
  act(() => void vi.advanceTimersByTime(500));
  expect(screen.getByRole('status').dataset.state).toBe('buffering');

  // The floor must not hold "Buffering" on top of ErrorDisplay. An error
  // overrides both timers with no wait.
  act(() =>
    fake.emit({ activation: 'error', lifecycle: 'error', buffering: true })
  );
  expect(screen.getByRole('status').dataset.state).toBe('idle');
  expect(screen.getByRole('status').textContent).toBe('');
});

test('LoadingIndicator clears its pending timer on unmount', async () => {
  const fake = createFakeProvider();
  mockedLoadProvider.mockResolvedValue(fake.adapter);
  vi.useFakeTimers();
  const { unmount } = render(interactionFixture());
  fireEvent.click(screen.getByRole('button', { name: 'Play video' }));
  await vi.waitFor(() => expect(fake.counts().attachCount).toBe(1));
  act(() =>
    fake.emit({ activation: 'ready', lifecycle: 'ready', buffering: false })
  );
  // Drain the provider-load floor so this starts from a hidden indicator.
  act(() => void vi.advanceTimersByTime(500));

  // Counted as a delta rather than an absolute, so unrelated timers scheduled
  // by the fixture cannot make this pass or fail by accident.
  const before = vi.getTimerCount();
  act(() => fake.emit({ buffering: true }));
  expect(vi.getTimerCount()).toBe(before + 1);

  unmount();
  expect(vi.getTimerCount()).toBe(before);
});

test('LoadingIndicator suppresses buffering after a terminal activation error', async () => {
  const fake = createFakeProvider();
  mockedLoadProvider.mockResolvedValue(fake.adapter);
  render(interactionFixture());
  fireEvent.click(screen.getByRole('button', { name: 'Play video' }));
  await vi.waitFor(() => expect(fake.counts().attachCount).toBe(1));

  act(() =>
    fake.emit({
      activation: 'error',
      buffering: true,
      lifecycle: 'error'
    })
  );

  // The live region stays mounted but must not announce buffering once the
  // activation has terminally errored.
  const region = screen.getByRole('status');
  expect(region.dataset.state).toBe('idle');
  expect(region.textContent).toBe('');
  expect(
    screen.getByRole('button', { name: 'Retry loading video' })
  ).toBeDefined();
});

test('LoadingIndicator does not occupy the viewport while idle, but does while loading or buffering', async () => {
  const fake = createFakeProvider();
  mockedLoadProvider.mockResolvedValue(fake.adapter);
  vi.useFakeTimers();
  render(interactionFixture());

  // Idle, before activation even starts: the live region is mounted (per the
  // announcement-policy test above) but must not claim any of the viewport —
  // a full-bleed, high-z-index idle box makes automated color-contrast checks
  // unable to resolve a background for any text in the player (#32), even
  // though nothing is visibly rendered.
  const idleRegion = screen.getByRole('status');
  expect(idleRegion.dataset.state).toBe('idle');
  expect(idleRegion.style.position).toBe('absolute');
  expect(idleRegion.style.width).toBe('1px');
  expect(idleRegion.style.height).toBe('1px');
  expect(idleRegion.style.overflow).toBe('hidden');
  expect(idleRegion.style.clip).toBe('rect(0, 0, 0, 0)');
  expect(idleRegion.style.zIndex).toBe('');
  expect(idleRegion.style.pointerEvents).toBe('none');

  fireEvent.click(screen.getByRole('button', { name: 'Play video' }));

  // Loading: the same node, now full-bleed and on top, so a real loading
  // indicator a consumer renders as `children` is actually visible.
  const loadingRegion = screen.getByRole('status');
  expect(loadingRegion).toBe(idleRegion);
  expect(loadingRegion.dataset.state).toBe('loading-provider');
  expect(loadingRegion.style.position).toBe('absolute');
  expect(loadingRegion.style.zIndex).toBe('30');
  expect(loadingRegion.style.pointerEvents).toBe('none');
  expect(loadingRegion.style.width).toBe('');
  expect(loadingRegion.style.clip).toBe('');

  await vi.waitFor(() => expect(fake.counts().attachCount).toBe(1));
  act(() =>
    fake.emit({ activation: 'ready', lifecycle: 'ready', buffering: true })
  );

  // Buffering: full-bleed again, for the same reason. The indicator is already
  // visible as `loading-provider`, so this is a label swap, not a fresh show —
  // no delay to advance past.
  const bufferingRegion = screen.getByRole('status');
  expect(bufferingRegion.dataset.state).toBe('buffering');
  expect(bufferingRegion.style.zIndex).toBe('30');
  expect(bufferingRegion.style.pointerEvents).toBe('none');

  act(() => fake.emit({ buffering: false }));
  act(() => void vi.advanceTimersByTime(500));

  // Back to idle once buffering clears and the minimum-visible floor expires:
  // hidden again, not full-bleed.
  const backToIdle = screen.getByRole('status');
  expect(backToIdle.dataset.state).toBe('idle');
  expect(backToIdle.style.zIndex).toBe('');
  expect(backToIdle.style.width).toBe('1px');
});

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
  await vi.waitFor(() =>
    expect(current.counts()).toMatchObject({ attachCount: 1, loadCount: 1 })
  );
});

test('retries an installed provider error with one queued user play', async () => {
  const stale = createFakeProvider();
  const current = createFakeProvider();
  mockedLoadProvider
    .mockResolvedValueOnce(stale.adapter)
    .mockResolvedValueOnce(current.adapter);
  const handle = createRef<Player.PlayerHandle>();
  render(interactionFixture({ ref: handle }));

  const button = screen.getByRole('button', { name: 'Play video' });
  const controller = (handle.current as unknown as InternalControllerAccess)[
    INTERNAL_CONTROLLER
  ];
  const playWithOrigin = vi.spyOn(controller, 'playWithOrigin');
  button.focus();
  fireEvent.click(button);
  await vi.waitFor(() =>
    expect(stale.counts()).toMatchObject({ attachCount: 1, loadCount: 1 })
  );

  act(() => stale.emit({ activation: 'error', lifecycle: 'error' }));
  expect(
    await screen.findByRole('button', { name: 'Retry loading video' })
  ).toBe(button);
  expect(document.activeElement).toBe(button);

  fireEvent.click(button);

  await vi.waitFor(() => expect(stale.counts().destroyCount).toBe(1));
  await vi.waitFor(() => expect(mockedLoadProvider).toHaveBeenCalledTimes(2));
  await vi.waitFor(() =>
    expect(current.counts()).toMatchObject({ attachCount: 1, loadCount: 1 })
  );
  act(() => current.emit({ activation: 'ready', lifecycle: 'ready' }));
  await vi.waitFor(() =>
    expect(playWithOrigin).toHaveBeenCalledExactlyOnceWith('user')
  );
});

// SIDEPRO-201: an external controller drives activation through the
// forwarded ref alone -- no click, no `Player.ActivationButton` in the tree
// at all. The single `activateFromInteraction()` call below has to queue the
// same play `useActivation` queues for a click (use-activation.ts:293-294,
// `active.started = true; active.queuedPlay = queuePlay`),
// and that queued play has to reach the provider exactly once.
test('a dormant interaction root activates and plays from a single ref call', async () => {
  const fake = createFakeProvider();
  mockedLoadProvider.mockResolvedValue(fake.adapter);
  const handle = createRef<Player.PlayerHandle>();
  render(fixture({ loading: 'interaction', ref: handle }));

  expect(mockedLoadProvider).not.toHaveBeenCalled();

  act(() => handle.current?.activateFromInteraction());

  await vi.waitFor(() => expect(mockedLoadProvider).toHaveBeenCalledOnce());
  act(() => fake.emit({ activation: 'ready', lifecycle: 'ready' }));

  await vi.waitFor(() => expect(fake.counts().playCount).toBe(1));
});

// The test above calls `activateFromInteraction` alone and lets the
// auto-queued play do the rest; SIDEPRO-201's external "play" command is
// the pair, in this order — `activateFromInteraction()` then `play()`
// (`use-activation.ts:324-356`, its
// `const activateFromInteraction = useCallback`;
// `player-controller.ts:381-386`) — the order an external control surface
// issues it in. Against a still-`dormant` player, the explicit `play()` has
// no provider to reach yet and resolves `{ ok: false, reason: 'not-ready' }`
// (`player-controller.ts:383-384`) rather than queuing anything — dropped,
// not doubled — so the pair must not cost a second, real play once the
// provider this same `activateFromInteraction` call set loading actually
// attaches. Asserted on `fake.counts().playCount` directly, not on a spy
// over `handle.current.play`/`activateFromInteraction` themselves: those
// are expected to be called once each here regardless of whether the drop
// is working, so only a count on the provider itself can tell a correct
// drop from a bug that lets the early call double up the queued one.
test('interaction issues exactly one play when activateFromInteraction is immediately followed by play', async () => {
  const fake = createFakeProvider();
  mockedLoadProvider.mockResolvedValue(fake.adapter);
  const handle = createRef<Player.PlayerHandle>();
  render(fixture({ loading: 'interaction', ref: handle }));
  let immediateResult: CommandResult | undefined;

  act(() => {
    handle.current?.activateFromInteraction();
    void handle.current?.play().then((result) => {
      immediateResult = result;
    });
  });

  await vi.waitFor(() => expect(mockedLoadProvider).toHaveBeenCalledOnce());
  // Read only once the microtask above has had a chance to run — `act` for a
  // synchronous callback does not itself drain it, so a check placed
  // straight off that `act` would see `undefined` regardless of what
  // `play()` actually returned.
  expect(immediateResult).toEqual({ ok: false, reason: 'not-ready' });

  act(() => fake.emit({ activation: 'ready', lifecycle: 'ready' }));

  await vi.waitFor(() => expect(fake.counts().playCount).toBe(1));
  // The regression this test exists to catch would land moments after the
  // count first reaches one, not before, so a check placed only right after
  // the assertion above would pass over it just as easily as no check at
  // all.
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(fake.counts().playCount).toBe(1);
});

test('usePlayerActions() reaches the same activateFromInteraction binding', async () => {
  const fake = createFakeProvider();
  mockedLoadProvider.mockResolvedValue(fake.adapter);
  let activateFromInteraction!: () => void;
  const Probe = () => {
    const actions = Player.usePlayerActions();
    useLayoutEffect(() => {
      activateFromInteraction = actions.activateFromInteraction;
    }, [actions]);
    return null;
  };
  render(
    <Player.Root loading="interaction" source="/tracer.mp4">
      <Player.Viewport>
        <Player.Media />
      </Player.Viewport>
      <Probe />
    </Player.Root>
  );

  act(() => activateFromInteraction());

  await vi.waitFor(() => expect(mockedLoadProvider).toHaveBeenCalledOnce());
  act(() => fake.emit({ activation: 'ready', lifecycle: 'ready' }));

  await vi.waitFor(() => expect(fake.counts().playCount).toBe(1));
});

// The mock-player decorator (apps/storybook/.storybook/mock-player.tsx) reads
// `INTERNAL_CONTROLLER` off this same handle to reach `setProvider`, which is
// how a story stages its provider. This used to read "the ref handle still
// exposes the provider-facing setProvider escape hatch" and asserted
// `setProvider` sat on the handle directly -- the #328 leak, since every
// consumer got it too. `setProvider` must stay off the declared surface and
// stay reachable through the symbol, and the two halves belong in one test:
// splitting them lets a change satisfy either alone.
test('reaches setProvider through the internal symbol, never off the handle', () => {
  const handle = createRef<Player.PlayerHandle>();
  render(fixture({ ref: handle }));

  const controller = (handle.current as unknown as InternalControllerAccess)[
    INTERNAL_CONTROLLER
  ];
  expect(
    (handle.current as unknown as Record<string, unknown>).setProvider
  ).toBeUndefined();
  expect(controller.setProvider).toBeTypeOf('function');
  const adapter: ProviderAdapter = {
    provider: 'native',
    attach: () => undefined,
    load: () => undefined,
    destroy: () => undefined,
    subscribe: () => () => undefined
  };

  act(() => controller.setProvider(adapter));

  expect(controller.getState().activation).toBe('loading-provider');
});

// An external controller calls `activateFromInteraction()` unconditionally
// before `play()`, so a player that has already activated has to tolerate
// the call rather than restart itself or throw
// (use-activation.ts:334-355, from `const activation = state.activation`, only
// proceeds from `dormant` or `error`).
test('activateFromInteraction on an already-ready player is a no-op', async () => {
  const fake = createFakeProvider();
  mockedLoadProvider.mockResolvedValue(fake.adapter);
  const handle = createRef<Player.PlayerHandle>();
  render(fixture({ loading: 'interaction', ref: handle }));

  act(() => handle.current?.activateFromInteraction());
  await vi.waitFor(() => expect(mockedLoadProvider).toHaveBeenCalledOnce());
  act(() => fake.emit({ activation: 'ready', lifecycle: 'ready' }));
  await vi.waitFor(() => expect(fake.counts().playCount).toBe(1));

  expect(() =>
    act(() => handle.current?.activateFromInteraction())
  ).not.toThrow();
  expect(mockedLoadProvider).toHaveBeenCalledOnce();
  expect(fake.counts().playCount).toBe(1);
});
