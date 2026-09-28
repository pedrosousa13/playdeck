// @vitest-environment happy-dom

import {
  act,
  cleanup,
  fireEvent,
  render,
  waitFor
} from '@testing-library/react';
import { createRef, Profiler, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type {
  Availability,
  CommandResult,
  PlayerCapabilities,
  ProviderAdapter,
  ProviderEvent,
  ProviderStateListener,
  ProviderStatePatch
} from '@playdeck/core';
import {
  INTERNAL_CONTROLLER,
  type InternalControllerAccess
} from '../src/internal-controller';
import * as Player from '../src/index';
import {
  thumbnailLeftStyle,
  THUMBNAILS_BODY_READ_TIMEOUT_MS,
  THUMBNAILS_FETCH_BYTE_CAP,
  THUMBNAILS_FETCH_TIMEOUT_MS,
  THUMBNAILS_RETRY_BACKOFF_MS
} from '../src/thumbnails';

const available: Availability = { status: 'available' };
const notReady: Availability = { status: 'unknown', reason: 'not-ready' };

const ok = async (): Promise<CommandResult> => ({ ok: true });

const createMockAdapter = () => {
  const listeners = new Set<ProviderStateListener>();
  const adapter: ProviderAdapter = {
    provider: 'native',
    attach: () => {},
    load: () => {},
    destroy: () => {},
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    play: vi.fn(ok),
    pause: vi.fn(ok),
    seekTo: vi.fn(ok),
    seekBy: vi.fn(ok),
    mute: vi.fn(ok),
    unmute: vi.fn(ok),
    setVolume: vi.fn(ok)
  };
  return {
    adapter,
    emit: (patch: ProviderStatePatch, event?: ProviderEvent) =>
      listeners.forEach((listener) => listener(patch, event))
  };
};

const allNotReady = (): PlayerCapabilities => ({
  seek: notReady,
  setVolume: notReady,
  setPlaybackRate: notReady,
  selectQuality: notReady,
  selectQualityAuto: notReady,
  selectTextTrack: notReady,
  selectAudioTrack: notReady,
  chapters: notReady,
  liveEdge: notReady,
  fullscreen: notReady,
  pictureInPicture: notReady,
  airPlay: notReady,
  remotePlayback: notReady,
  customControls: notReady,
  providerPoster: notReady
});

const renderWithPlayer = (ui: ReactNode, initial?: ProviderStatePatch) => {
  const handle = createRef<Player.PlayerHandle>();
  // Wrapped rather than rendered bare, so `rerender` swaps the child under
  // the SAME `Player.Root` and controller -- the whole point of the re-arm
  // test.
  const wrap = (child: ReactNode) => (
    <Player.Root loading="interaction" ref={handle} source="/tracer.mp4">
      {child}
      <Player.ErrorDisplay />
    </Player.Root>
  );
  const utils = render(wrap(ui));
  const controller = (handle.current as unknown as InternalControllerAccess)[
    INTERNAL_CONTROLLER
  ];
  const mock = createMockAdapter();
  act(() => {
    controller.setProvider(mock.adapter);
    mock.emit({
      lifecycle: 'ready',
      activation: 'ready',
      provider: 'native',
      capabilities: { ...allNotReady(), seek: available },
      duration: 100,
      currentTime: 30,
      ...initial
    });
  });
  return {
    ...utils,
    controller,
    rerender: (nextUi: ReactNode) => utils.rerender(wrap(nextUi)),
    notice: () => utils.container.querySelector('[data-playdeck-part="notice"]')
  };
};

const attr = (element: Element | null, name: string): string | null =>
  element?.getAttribute(name) ?? null;

// A macrotask, not another microtask: whatever depth of `.then()`/`.catch()`
// chain a fetch mock's own promise resolution triggers, every microtask it
// queues drains before a `setTimeout` callback runs, so this settles the
// whole chain regardless of how many hops it takes -- unlike awaiting the
// mock's returned promise directly, which only proves its own settlement,
// not what `arm()` chained after it.
const flushMicrotasks = (): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, 0));

// Width 200, so a pointer's clientX maps to a predictable fraction of the
// slider's own box: 50 -> 0.25 (time 25), 150 -> 0.75 (time 75), against the
// [0, 100] window `renderWithPlayer`'s default duration/currentTime produce.
const stubBox = (element: Element) => {
  Object.defineProperty(element, 'getBoundingClientRect', {
    configurable: true,
    value: () => ({
      left: 0,
      width: 200,
      right: 200,
      top: 0,
      height: 40,
      bottom: 40,
      x: 0,
      y: 0,
      toJSON: () => ({})
    })
  });
};

const getSlider = (): HTMLElement =>
  document.querySelector('[data-playdeck-part="seek-slider"]') as HTMLElement;
const getInput = (): HTMLElement =>
  document.querySelector(
    '[data-playdeck-part="seek-slider-input"]'
  ) as HTMLElement;
const getThumbnail = (): Element | null =>
  document.querySelector('[data-playdeck-part="thumbnail"]');

const hoverAt = (clientX: number) => {
  const slider = getSlider();
  stubBox(slider);
  fireEvent.pointerMove(slider, { clientX });
};

// Two cues on the [0, 100] window `renderWithPlayer` produces: [0, 50) crops
// the sprite's left tile, [50, 100) its right tile.
const twoCueVtt = [
  'WEBVTT',
  '',
  '00:00:00.000 --> 00:00:50.000',
  'https://cdn.example.test/sprite.jpg#xywh=0,0,160,90',
  '',
  '00:00:50.000 --> 00:01:40.000',
  'https://cdn.example.test/sprite.jpg#xywh=160,0,160,90',
  ''
].join('\n');

const wholeImageVtt = [
  'WEBVTT',
  '',
  '00:00:00.000 --> 00:01:40.000',
  'https://cdn.example.test/whole.jpg',
  ''
].join('\n');

const okTextResponse = (body: string): Response =>
  new Response(body, { status: 200 });

let fetchMock: ReturnType<typeof vi.fn>;

// Every test but the ones that want a different response replaces the global
// `fetch` this way, differing only in `impl` -- factored out so a test's own
// mock body is the only thing it has to say.
const stubFetch = (
  impl: (url: string, init?: RequestInit) => Promise<Response>
): void => {
  fetchMock = vi.fn(impl);
  vi.stubGlobal('fetch', fetchMock);
};

beforeEach(() => {
  stubFetch(async () => okTextResponse(twoCueVtt));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('SeekSlider thumbnails', () => {
  test('renders nothing extra without the thumbnails prop', () => {
    renderWithPlayer(<Player.SeekSlider />);
    expect(getThumbnail()).toBeNull();
  });

  test('fetches nothing at mount even with thumbnails set', async () => {
    renderWithPlayer(
      <Player.SeekSlider thumbnails="https://cdn.example.test/thumbs.vtt" />
    );
    // Awaited rather than read synchronously: the part ships in the chunk
    // `SeekSlider` imports for it (`transport-controls.tsx`'s
    // `useThumbnailPreview`), so it mounts a tick after the slider does
    // rather than in the same one. What this test is about is unchanged on
    // the far side of that wait -- the cue file is fetched by neither the
    // mount nor the preview arriving, only by an interaction.
    await waitFor(() =>
      expect(attr(getThumbnail(), 'data-state')).toBe('hidden')
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test('arms the fetch on the first pointer over the slider, and only once', async () => {
    renderWithPlayer(
      <Player.SeekSlider thumbnails="https://cdn.example.test/thumbs.vtt" />
    );
    hoverAt(25);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(fetchMock).toHaveBeenCalledWith(
      'https://cdn.example.test/thumbs.vtt',
      expect.objectContaining({
        signal: expect.anything(),
        referrerPolicy: 'no-referrer'
      })
    );

    hoverAt(30);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  test('arms the fetch on the first keyboard focus on the input', async () => {
    renderWithPlayer(
      <Player.SeekSlider thumbnails="https://cdn.example.test/thumbs.vtt" />
    );
    fireEvent.focus(getInput());
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
  });

  test('renders the cropped region for the previewed pointer position, and moves with it', async () => {
    renderWithPlayer(
      <Player.SeekSlider thumbnails="https://cdn.example.test/thumbs.vtt" />
    );
    hoverAt(50); // fraction 0.25, time 25 -> first cue
    await waitFor(() =>
      expect(attr(getThumbnail(), 'data-state')).toBe('visible')
    );

    const thumbnail = getThumbnail();
    const image = thumbnail!.querySelector('img')!;
    expect(image.src).toBe('https://cdn.example.test/sprite.jpg');
    expect(image.getAttribute('referrerpolicy')).toBe('no-referrer');
    expect(image.style.left).toBe('0px');
    expect(image.style.top).toBe('0px');
    expect((thumbnail as HTMLElement).style.width).toBe('160px');
    expect((thumbnail as HTMLElement).style.height).toBe('90px');
    expect((thumbnail as HTMLElement).style.overflow).toBe('hidden');
    expect(thumbnail!.getAttribute('aria-hidden')).toBe('true');

    fireEvent.pointerMove(getSlider(), { clientX: 150 }); // fraction 0.75, time 75 -> second cue
    expect(getThumbnail()!.querySelector('img')!.style.left).toBe('-160px');
  });

  test('renders a region-less cue whole', async () => {
    stubFetch(async () => okTextResponse(wholeImageVtt));
    renderWithPlayer(
      <Player.SeekSlider thumbnails="https://cdn.example.test/thumbs.vtt" />
    );
    hoverAt(50);
    await waitFor(() =>
      expect(attr(getThumbnail(), 'data-state')).toBe('visible')
    );

    const thumbnail = getThumbnail() as HTMLElement;
    expect(thumbnail.style.width).toBe('');
    expect(thumbnail.style.height).toBe('');
    const image = thumbnail.querySelector('img')!;
    expect(image.src).toBe('https://cdn.example.test/whole.jpg');
    expect(image.style.left).toBe('');
    expect(image.style.top).toBe('');
  });

  test('previews the input value on focus alone, with no pointer active', async () => {
    renderWithPlayer(
      <Player.SeekSlider thumbnails="https://cdn.example.test/thumbs.vtt" />
    );
    fireEvent.focus(getInput()); // currentTime is 30 -> first cue ([0, 50))
    await waitFor(() =>
      expect(attr(getThumbnail(), 'data-state')).toBe('visible')
    );
    expect(getThumbnail()!.querySelector('img')!.src).toBe(
      'https://cdn.example.test/sprite.jpg'
    );
  });

  test('a pointer active at the same time as focus wins', async () => {
    renderWithPlayer(
      <Player.SeekSlider thumbnails="https://cdn.example.test/thumbs.vtt" />
    );
    fireEvent.focus(getInput()); // value 30 -> first cue, if focus alone decided it
    await waitFor(() =>
      expect(attr(getThumbnail(), 'data-state')).toBe('visible')
    );
    hoverAt(150); // fraction 0.75, time 75 -> second cue

    expect(getThumbnail()!.querySelector('img')!.style.left).toBe('-160px');
  });

  test('aborts the in-flight fetch on unmount', async () => {
    let capturedSignal: AbortSignal | undefined;
    stubFetch((_url, init) => {
      capturedSignal = init?.signal ?? undefined;
      return new Promise<Response>(() => {}); // never resolves
    });
    const { unmount } = renderWithPlayer(
      <Player.SeekSlider thumbnails="https://cdn.example.test/thumbs.vtt" />
    );
    hoverAt(50);
    // Awaited for the same reason the mount test above awaits: the hover is
    // recorded by `SeekSlider` immediately, but the fetch it arms belongs to
    // the chunk that carries the preview, so `capturedSignal` exists one
    // tick later. The abort this test is about is asserted on the same
    // signal, unchanged.
    await waitFor(() => expect(capturedSignal?.aborted).toBe(false));

    unmount();
    expect(capturedSignal?.aborted).toBe(true);
  });

  test('a fetch that fails renders no thumbnail and publishes no notice', async () => {
    stubFetch(async () => {
      throw new Error('network down');
    });
    const { controller } = renderWithPlayer(
      <Player.SeekSlider thumbnails="https://cdn.example.test/thumbs.vtt" />
    );
    hoverAt(50);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    await flushMicrotasks();

    expect(attr(getThumbnail(), 'data-state')).toBe('hidden');
    expect(controller.getState().error).toBeNull();
  });

  // A fetch that fails once must not leave the preview empty forever -- a
  // later arm (here, leaving and re-entering the slider) retries the same
  // url, and a retry that succeeds shows the thumbnails the first attempt
  // never got to parse.
  test('a fetch that fails once is retried on a later arm, and thumbnails that were empty now show', async () => {
    vi.useFakeTimers();
    let attempt = 0;
    stubFetch(async () => {
      attempt += 1;
      if (attempt === 1) throw new Error('network down');
      return okTextResponse(twoCueVtt);
    });
    const { controller } = renderWithPlayer(
      <Player.SeekSlider thumbnails="https://cdn.example.test/thumbs.vtt" />
    );
    hoverAt(50);
    await act(() => vi.advanceTimersByTimeAsync(0));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(attr(getThumbnail(), 'data-state')).toBe('hidden');
    expect(controller.getState().error).toBeNull();

    await act(() => vi.advanceTimersByTimeAsync(THUMBNAILS_RETRY_BACKOFF_MS));
    fireEvent.pointerLeave(getSlider());
    hoverAt(50);
    await act(() => vi.advanceTimersByTimeAsync(0));

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(attr(getThumbnail(), 'data-state')).toBe('visible');
  });

  // A retry only fires on a later arm -- `armed` toggling, which re-runs the
  // fetch effect. A pointer that never leaves the slider (or keyboard focus
  // that never blurs) holds `armed` at `true` for the whole backoff, so
  // nothing re-runs the effect on its own; the retry has to be scheduled
  // directly against the failure's own `retryAt`, not left for a re-arm that
  // may never come.
  test('a fetch that fails once is retried while the pointer never leaves the slider, once the backoff ends', async () => {
    vi.useFakeTimers();
    let attempt = 0;
    stubFetch(async () => {
      attempt += 1;
      if (attempt === 1) throw new Error('network down');
      return okTextResponse(twoCueVtt);
    });
    renderWithPlayer(
      <Player.SeekSlider thumbnails="https://cdn.example.test/thumbs.vtt" />
    );
    hoverAt(50);
    await act(() => vi.advanceTimersByTimeAsync(0));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(attr(getThumbnail(), 'data-state')).toBe('hidden');

    // Short of the backoff: no retry yet, and the pointer has not moved.
    await act(() =>
      vi.advanceTimersByTimeAsync(THUMBNAILS_RETRY_BACKOFF_MS - 1)
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // The backoff elapses with the pointer still over the slider.
    await act(() => vi.advanceTimersByTimeAsync(1));
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(attr(getThumbnail(), 'data-state')).toBe('visible');
  });

  test('a host that keeps failing while the pointer never leaves is retried at most once per backoff, not in a tight loop', async () => {
    vi.useFakeTimers();
    stubFetch(async () => {
      throw new Error('network down');
    });
    renderWithPlayer(
      <Player.SeekSlider thumbnails="https://cdn.example.test/thumbs.vtt" />
    );
    hoverAt(50);
    await act(() => vi.advanceTimersByTimeAsync(0));
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // Three full backoff windows with the pointer never leaving: exactly
    // one retry per window, not a burst within it.
    await act(() => vi.advanceTimersByTimeAsync(THUMBNAILS_RETRY_BACKOFF_MS));
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await act(() => vi.advanceTimersByTimeAsync(THUMBNAILS_RETRY_BACKOFF_MS));
    expect(fetchMock).toHaveBeenCalledTimes(3);
    await act(() => vi.advanceTimersByTimeAsync(THUMBNAILS_RETRY_BACKOFF_MS));
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  // The fetch itself is decoupled from arm/disarm -- leaving the slider
  // while a fetch is still in flight does not cancel it, only the effect
  // run that started it. If that failure's own retry got scheduled by that
  // same, by-then-cleaned-up run, nothing left mounted owns the timer, and
  // it fires anyway once the backoff ends, even though nothing is armed any
  // more.
  test('does not schedule a stray retry from a fetch that outlives its own arm (disarmed before it fails)', async () => {
    vi.useFakeTimers();
    let reject: ((reason: unknown) => void) | undefined;
    stubFetch(
      () =>
        new Promise<Response>((_resolve, rejectFn) => {
          reject = rejectFn;
        })
    );
    renderWithPlayer(
      <Player.SeekSlider thumbnails="https://cdn.example.test/thumbs.vtt" />
    );
    hoverAt(50);
    await act(() => vi.advanceTimersByTimeAsync(0));
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // Leaves while the fetch above is still in flight: this arm's own
    // effect run is cleaned up, but the fetch it started keeps running.
    fireEvent.pointerLeave(getSlider());
    await act(() => vi.advanceTimersByTimeAsync(0));

    // Fails only now, after the run that started it is already gone.
    reject!(new Error('network down'));
    await act(() => vi.advanceTimersByTimeAsync(0));

    // Well past the backoff, with the pointer never having come back.
    await act(() =>
      vi.advanceTimersByTimeAsync(THUMBNAILS_RETRY_BACKOFF_MS * 3)
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  test('retries once the backoff ends after a re-arm while the original fetch was still in flight', async () => {
    vi.useFakeTimers();
    let attempt = 0;
    let firstReject: ((reason: unknown) => void) | undefined;
    stubFetch(async () => {
      attempt += 1;
      if (attempt === 1) {
        return new Promise<Response>((_resolve, rejectFn) => {
          firstReject = rejectFn;
        });
      }
      return okTextResponse(twoCueVtt);
    });
    renderWithPlayer(
      <Player.SeekSlider thumbnails="https://cdn.example.test/thumbs.vtt" />
    );
    hoverAt(50);
    await act(() => vi.advanceTimersByTimeAsync(0));
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // Leaves and re-enters while the first attempt is still pending: a new
    // effect run starts, finds a fetch already in flight and does nothing
    // -- the original run's own fetch is what eventually fails.
    fireEvent.pointerLeave(getSlider());
    hoverAt(50);
    await act(() => vi.advanceTimersByTimeAsync(0));
    expect(fetchMock).toHaveBeenCalledTimes(1);

    firstReject!(new Error('network down'));
    await act(() => vi.advanceTimersByTimeAsync(0));
    expect(attr(getThumbnail(), 'data-state')).toBe('hidden');

    // Stays hovered for the whole backoff -- the retry has to belong to
    // the CURRENT arm, not the one that started the failed fetch.
    await act(() => vi.advanceTimersByTimeAsync(THUMBNAILS_RETRY_BACKOFF_MS));
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(attr(getThumbnail(), 'data-state')).toBe('visible');
  });

  test('does not fetch again after unmount, even when the pending retry belonged to an earlier, already-cleaned-up arm', async () => {
    vi.useFakeTimers();
    let attempt = 0;
    let firstReject: ((reason: unknown) => void) | undefined;
    stubFetch(async () => {
      attempt += 1;
      if (attempt === 1) {
        return new Promise<Response>((_resolve, rejectFn) => {
          firstReject = rejectFn;
        });
      }
      return okTextResponse(twoCueVtt);
    });
    const { unmount } = renderWithPlayer(
      <Player.SeekSlider thumbnails="https://cdn.example.test/thumbs.vtt" />
    );
    hoverAt(50);
    await act(() => vi.advanceTimersByTimeAsync(0));
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // Re-arms while the first attempt is still in flight, so its later
    // failure belongs to an effect run this instance has already moved
    // past.
    fireEvent.pointerLeave(getSlider());
    hoverAt(50);
    await act(() => vi.advanceTimersByTimeAsync(0));

    firstReject!(new Error('network down'));
    await act(() => vi.advanceTimersByTimeAsync(0));

    unmount();
    await act(() =>
      vi.advanceTimersByTimeAsync(THUMBNAILS_RETRY_BACKOFF_MS * 3)
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  // A non-ok response counts as a failure the same way a rejected fetch
  // does, eligible for the same retry -- not the "no thumbnails, no notice"
  // treatment an ok-but-unparseable body gets below.
  test('a non-ok response is retried on a later arm', async () => {
    vi.useFakeTimers();
    let attempt = 0;
    stubFetch(async () => {
      attempt += 1;
      return attempt === 1
        ? new Response('nope', { status: 500 })
        : okTextResponse(twoCueVtt);
    });
    renderWithPlayer(
      <Player.SeekSlider thumbnails="https://cdn.example.test/thumbs.vtt" />
    );
    hoverAt(50);
    await act(() => vi.advanceTimersByTimeAsync(0));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(attr(getThumbnail(), 'data-state')).toBe('hidden');

    await act(() => vi.advanceTimersByTimeAsync(THUMBNAILS_RETRY_BACKOFF_MS));
    fireEvent.pointerLeave(getSlider());
    hoverAt(50);
    await act(() => vi.advanceTimersByTimeAsync(0));

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(attr(getThumbnail(), 'data-state')).toBe('visible');
  });

  test('a repeated re-arm while a failure is still within its backoff does not retry', async () => {
    vi.useFakeTimers();
    stubFetch(async () => {
      throw new Error('network down');
    });
    renderWithPlayer(
      <Player.SeekSlider thumbnails="https://cdn.example.test/thumbs.vtt" />
    );
    hoverAt(50);
    await act(() => vi.advanceTimersByTimeAsync(0));
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // Five more arms, all inside the backoff window -- none of them should
    // reach the network.
    for (let i = 0; i < 5; i += 1) {
      fireEvent.pointerLeave(getSlider());
      hoverAt(50);
    }
    await act(() => vi.advanceTimersByTimeAsync(0));
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await act(() => vi.advanceTimersByTimeAsync(THUMBNAILS_RETRY_BACKOFF_MS));
    fireEvent.pointerLeave(getSlider());
    hoverAt(50);
    await act(() => vi.advanceTimersByTimeAsync(0));
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  test('a URL that already fetched successfully is not refetched on a later arm', async () => {
    renderWithPlayer(
      <Player.SeekSlider thumbnails="https://cdn.example.test/thumbs.vtt" />
    );
    hoverAt(50);
    await waitFor(() =>
      expect(attr(getThumbnail(), 'data-state')).toBe('visible')
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);

    fireEvent.pointerLeave(getSlider());
    hoverAt(50);
    fireEvent.pointerLeave(getSlider());
    hoverAt(50);
    await flushMicrotasks();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  // A response whose body keeps delivering bytes past the headers deadline
  // -- merely slow, not stalled -- must still be read to completion: the
  // headers deadline only ever bounded the wait for `fetch()` itself to
  // settle, which already happened here.
  test('a body that arrives slowly but steadily, past the headers deadline, still shows its thumbnails', async () => {
    vi.useFakeTimers();
    const vttBytes = new TextEncoder().encode(twoCueVtt);
    const half = Math.ceil(vttBytes.length / 2);
    stubFetch(
      async (_url, init) =>
        new Response(
          new ReadableStream<Uint8Array>({
            start(controller) {
              controller.enqueue(vttBytes.slice(0, half));
              const rest = setTimeout(() => {
                controller.enqueue(vttBytes.slice(half));
                controller.close();
              }, THUMBNAILS_FETCH_TIMEOUT_MS * 2);
              // Mirrors what a real fetch does to its response body's
              // stream once the request is aborted -- needed here because
              // this hand-built stream has no fetch layer of its own to do
              // it automatically.
              init?.signal?.addEventListener('abort', () => {
                clearTimeout(rest);
                controller.error(
                  new DOMException('The operation was aborted.', 'AbortError')
                );
              });
            }
          }),
          { status: 200 }
        )
    );
    renderWithPlayer(
      <Player.SeekSlider thumbnails="https://cdn.example.test/thumbs.vtt" />
    );
    hoverAt(50);
    // A first flush at 0 to let the dynamic import and the effect it
    // arms run before the real advance below starts: scheduling `rest`
    // (above) partway into a single large jump lands it later than
    // intended, the same reason the deadline test further down splits its
    // own advance the same way.
    await act(() => vi.advanceTimersByTimeAsync(0));
    await act(() =>
      vi.advanceTimersByTimeAsync(THUMBNAILS_FETCH_TIMEOUT_MS * 2)
    );
    expect(attr(getThumbnail(), 'data-state')).toBe('visible');
    expect(getThumbnail()!.querySelector('img')!.src).toBe(
      'https://cdn.example.test/sprite.jpg'
    );
  });

  // A body that stops delivering bytes partway through -- no network error,
  // no close, nothing -- must still end as a failure, bounded by its own
  // deadline rather than hanging forever; and, like any other failure, be
  // eligible for a retry on a later arm.
  test('a body that stalls partway fails at its own deadline, and a later arm retries it', async () => {
    vi.useFakeTimers();
    const vttBytes = new TextEncoder().encode(twoCueVtt);
    let attempt = 0;
    stubFetch(async (_url, init) => {
      attempt += 1;
      const succeeds = attempt === 2;
      return new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(vttBytes.slice(0, 10));
            if (succeeds) {
              controller.enqueue(vttBytes.slice(10));
              controller.close();
            }
            // Mirrors real fetch's own abort-to-stream-error behaviour --
            // see the slow-body test above for why this is needed on a
            // hand-built stream.
            init?.signal?.addEventListener('abort', () => {
              controller.error(
                new DOMException('The operation was aborted.', 'AbortError')
              );
            });
          }
        }),
        { status: 200 }
      );
    });
    renderWithPlayer(
      <Player.SeekSlider thumbnails="https://cdn.example.test/thumbs.vtt" />
    );
    hoverAt(50);
    await act(() => vi.advanceTimersByTimeAsync(0));
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await act(() =>
      vi.advanceTimersByTimeAsync(THUMBNAILS_BODY_READ_TIMEOUT_MS)
    );
    expect(attr(getThumbnail(), 'data-state')).toBe('hidden');

    await act(() => vi.advanceTimersByTimeAsync(THUMBNAILS_RETRY_BACKOFF_MS));
    fireEvent.pointerLeave(getSlider());
    hoverAt(50);
    await act(() => vi.advanceTimersByTimeAsync(0));

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(attr(getThumbnail(), 'data-state')).toBe('visible');
  });

  test('a malformed body that parses to no cues renders no thumbnail and publishes no notice', async () => {
    stubFetch(async () => okTextResponse('<html>not a vtt file</html>'));
    const { controller } = renderWithPlayer(
      <Player.SeekSlider thumbnails="https://cdn.example.test/thumbs.vtt" />
    );
    hoverAt(50);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    await flushMicrotasks();

    expect(attr(getThumbnail(), 'data-state')).toBe('hidden');
    expect(controller.getState().error).toBeNull();
  });

  test('a refused thumbnails URL reports the surface, fetches nothing, and renders no thumbnail', async () => {
    const { controller, notice } = renderWithPlayer(
      <Player.SeekSlider thumbnails="javascript:alert(1)" />
    );

    expect(getThumbnail()).toBeNull();
    expect(controller.getState().error).toMatchObject({
      category: 'configuration',
      fatal: false,
      recoverable: false
    });
    expect(controller.getState().error?.message).toContain('thumbnails URL');
    expect(notice()?.textContent).toContain('thumbnails URL');

    hoverAt(50);
    await flushMicrotasks();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test('a refused cue image reports the surface and drops only that cue', async () => {
    stubFetch(async () =>
      okTextResponse(
        [
          'WEBVTT',
          '',
          '00:00:00.000 --> 00:00:50.000',
          'javascript:alert(1)',
          '',
          '00:00:50.000 --> 00:01:40.000',
          'https://cdn.example.test/sprite.jpg#xywh=160,0,160,90',
          ''
        ].join('\n')
      )
    );
    const { controller } = renderWithPlayer(
      <Player.SeekSlider thumbnails="https://cdn.example.test/thumbs.vtt" />
    );
    hoverAt(50); // time 25 -> the poisoned first cue
    await waitFor(() =>
      expect(controller.getState().error?.message).toContain(
        'thumbnails cue image'
      )
    );
    expect(attr(getThumbnail(), 'data-state')).toBe('hidden');

    fireEvent.pointerMove(getSlider(), { clientX: 150 }); // time 75 -> the good second cue
    expect(attr(getThumbnail(), 'data-state')).toBe('visible');
    expect(getThumbnail()!.querySelector('img')!.src).toBe(
      'https://cdn.example.test/sprite.jpg'
    );
    // The good cue's own render withdrew the notice the poisoned one published.
    expect(controller.getState().error).toBeNull();
  });

  test('a changed thumbnails URL re-arms and re-fetches', async () => {
    const { rerender } = renderWithPlayer(
      <Player.SeekSlider thumbnails="https://cdn.example.test/thumbs.vtt" />
    );
    hoverAt(50);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    rerender(
      <Player.SeekSlider thumbnails="https://cdn.example.test/other.vtt" />
    );
    hoverAt(50);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      'https://cdn.example.test/other.vtt',
      expect.anything()
    );
  });

  // #798: a relative cue image resolves against the VTT file's own fetch
  // address, not the page's -- and, since a redirect can move that address,
  // against the *response's* URL specifically rather than the URL the file
  // was requested with. `okTextResponse`'s `Response` is not the product of
  // a real fetch, so its own `.url` reads `''`; this test overrides it the
  // way a redirected fetch's `response.url` would differ from its request.
  test('a relative cue image resolves against the response URL, not the requested URL or the page', async () => {
    stubFetch(async () => {
      const response = okTextResponse(
        [
          'WEBVTT',
          '',
          '00:00:00.000 --> 00:01:40.000',
          'sprite-0.jpg#xywh=0,0,160,90',
          ''
        ].join('\n')
      );
      Object.defineProperty(response, 'url', {
        value: 'https://cdn.example.test/redirected/thumbs.vtt',
        configurable: true
      });
      return response;
    });
    renderWithPlayer(
      <Player.SeekSlider thumbnails="https://cdn.example.test/thumbs.vtt" />
    );
    hoverAt(50);
    await waitFor(() =>
      expect(getThumbnail()!.querySelector('img')?.src).toBe(
        'https://cdn.example.test/redirected/sprite-0.jpg'
      )
    );
  });

  // #798: `response.url` reads `''` for a `Response` that is not the
  // product of a real network fetch -- `okTextResponse` below builds
  // exactly this kind, the same as every other test in this file that
  // does not override `.url` -- and for some fetch polyfills and
  // opaque-response cases too. `useThumbnailCues` must fall back to the
  // requested `url` in that case rather than publish the cue unresolved:
  // an unresolved relative cue is the original bug, resolving against the
  // page once rendered as an `<img src>`.
  test('a relative cue image resolves against the requested VTT URL when the response reports no URL of its own', async () => {
    stubFetch(async () =>
      okTextResponse(
        [
          'WEBVTT',
          '',
          '00:00:00.000 --> 00:01:40.000',
          'sprite-0.jpg#xywh=0,0,160,90',
          ''
        ].join('\n')
      )
    );
    renderWithPlayer(
      <Player.SeekSlider thumbnails="https://cdn.example.test/thumbs.vtt" />
    );
    hoverAt(50);
    await waitFor(() =>
      expect(getThumbnail()!.querySelector('img')?.src).toBe(
        'https://cdn.example.test/sprite-0.jpg'
      )
    );
  });

  // #749: mirrors the deadline `OEMBED_REQUEST_TIMEOUT_MS`
  // (provider-vimeo/src/oembed-availability.ts) and `POSTER_PROBE_TIMEOUT_MS`
  // (provider-wistia/src/poster-availability.ts) already give their own
  // fetches, and reports it the way an unparseable file already does --
  // rather than the silent path an unmount's or a url change's own abort
  // still takes.
  //
  // The commit-count assertion at the end is what makes that second half
  // discriminating rather than vacuous: `cues` was already `EMPTY_CUES` and
  // `data-state` was already `hidden` before the deadline ever fired, so
  // asserting either by itself would pass whether or not the deadline
  // publishes anything at all (docs/agents/demonstrated-red.md's "reads a
  // default as a result"). A `Profiler` around the slider makes the
  // publish's own re-render commit observable instead.
  //
  // Demonstrated red (docs/agents/demonstrated-red.md), two substitute
  // mutations:
  //
  // 1. The timer's own `controller.abort()` call removed, leaving
  //    `deadlineExpired` set but nothing aborted -- `expect(capturedSignal
  //    ?.aborted).toBe(true)` received `false`.
  //
  // 2. Reverted, then `if (deadlineExpired) publishCues(EMPTY_CUES);`
  //    commented out of `.catch()`, leaving it silent again -- the
  //    commit-count assertion failed: `expected 4 to be greater than 4` (no
  //    additional commit followed the deadline, only the abort).
  //
  // Both reverted, and the test passed again.
  test('aborts the fetch at its own deadline, and reports it the way an unparseable file already does', async () => {
    vi.useFakeTimers();
    let capturedSignal: AbortSignal | undefined;
    stubFetch((_url, init) => {
      const signal = init?.signal;
      capturedSignal = signal ?? undefined;
      // Never resolves on its own, but rejects on abort -- the way a real
      // fetch() does -- since this test needs the effect's own `.catch()` to
      // actually run once the deadline aborts it, not just the signal's own
      // `aborted` flag to flip.
      return new Promise<Response>((_resolve, reject) => {
        signal?.addEventListener('abort', () => {
          reject(new DOMException('The operation was aborted.', 'AbortError'));
        });
      });
    });
    const onRender = vi.fn();
    renderWithPlayer(
      <Profiler id="thumbnail-probe" onRender={onRender}>
        <Player.SeekSlider thumbnails="https://cdn.example.test/thumbs.vtt" />
      </Profiler>
    );
    hoverAt(50);
    // Flushes the dynamic import the hover armed, and the effect it lets run,
    // without advancing real (or, here, fake) time.
    await act(() => vi.advanceTimersByTimeAsync(0));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(capturedSignal?.aborted).toBe(false);
    const commitsBeforeDeadline = onRender.mock.calls.length;

    await act(() => vi.advanceTimersByTimeAsync(THUMBNAILS_FETCH_TIMEOUT_MS));
    expect(capturedSignal?.aborted).toBe(true);
    expect(attr(getThumbnail(), 'data-state')).toBe('hidden');
    expect(onRender.mock.calls.length).toBeGreaterThan(commitsBeforeDeadline);
  });

  // #749: `Content-Length` is not trusted on its own -- this stream carries
  // none at all -- so the cap is enforced by counting bytes as they arrive.
  //
  // Red, natural (with `response.text()` in place of `readCappedBody`):
  // `expect(cancelled).toBe(true)` timed out still `false` -- the whole
  // stream is read to completion (`response.text()` never cancels it)
  // rather than stopping at the cap.
  test('a body larger than the byte cap yields no thumbnails, and reading stops at the cap', async () => {
    let cancelled = false;
    stubFetch(
      async () =>
        new Response(
          new ReadableStream<Uint8Array>({
            start(controller) {
              // One chunk already past the cap: enough on its own to prove
              // reading stops there rather than after the whole body.
              controller.enqueue(new Uint8Array(THUMBNAILS_FETCH_BYTE_CAP + 1));
            },
            cancel() {
              cancelled = true;
            }
          }),
          { status: 200 }
        )
    );
    const { controller } = renderWithPlayer(
      <Player.SeekSlider thumbnails="https://cdn.example.test/thumbs.vtt" />
    );
    hoverAt(50);
    await waitFor(() => expect(cancelled).toBe(true));

    expect(attr(getThumbnail(), 'data-state')).toBe('hidden');
    expect(controller.getState().error).toBeNull();
  });

  // #749: `{ stream: true }` deliberately withholds an incomplete trailing
  // multi-byte sequence across `decode()` calls, expecting a later chunk to
  // complete it. When none ever arrives -- the stream closes with a lead
  // byte and its continuation byte still held internally -- those bytes
  // must still surface as the replacement character a final decode
  // produces for them, not vanish.
  //
  // Red, natural (with the trailing `text += decoder.decode();` flush
  // removed from readCappedBody): the cue's own url read back as
  // 'thumb-a' -- the withheld bytes silently dropped rather than resolving
  // to 'thumb-a�'.
  test('flushes the decoder so a multi-byte character split across the final two chunks is not silently dropped', async () => {
    const prefixBytes = new TextEncoder().encode(
      ['WEBVTT', '', '00:00:00.000 --> 00:00:05.000', 'thumb-a'].join('\n')
    );
    // '𝄞' (U+1D11E) encodes to 4 UTF-8 bytes ([0xF0, 0x9D, 0x84, 0x9E]).
    // Only the first 3 are ever sent -- one at the end of the first chunk,
    // two making up the whole of the second and final one -- so the
    // sequence never completes.
    const clefBytes = new TextEncoder().encode('\u{1D11E}');
    const chunk1 = new Uint8Array([...prefixBytes, clefBytes[0]]);
    const chunk2 = clefBytes.slice(1, 3);
    stubFetch(
      async () =>
        new Response(
          new ReadableStream<Uint8Array>({
            start(controller) {
              controller.enqueue(chunk1);
              controller.enqueue(chunk2);
              controller.close();
            }
          }),
          { status: 200 }
        )
    );
    renderWithPlayer(
      <Player.SeekSlider thumbnails="https://cdn.example.test/thumbs.vtt" />
    );
    hoverAt(5); // fraction 0.025, time 2.5 -> inside the [0, 5) cue
    await waitFor(() =>
      expect(attr(getThumbnail(), 'data-state')).toBe('visible')
    );
    // #798: this relative cue now resolves against the VTT file's own
    // address (`useThumbnailCues`'s `responseBaseUrl`) before it ever
    // becomes `src`, so the replacement character this test is about
    // surfaces percent-encoded inside a full URL rather than literally --
    // `getAttribute` or the `.src` property read the same value either way,
    // since resolution already happened upstream of both.
    expect(getThumbnail()!.querySelector('img')!.getAttribute('src')).toBe(
      'https://cdn.example.test/thumb-a%EF%BF%BD'
    );
  });
});

// A pure-function suite, not a rendered-component one: happy-dom rejects
// `clamp()`/`min()` as an invalid CSS value outright (`el.style.left =
// 'clamp(...)'` is silently dropped, leaving whatever the element held
// before), so a DOM-rendered `style.left` can never be asserted on for this
// value in this test environment -- see `thumbnailLeftStyle`'s own comment
// in thumbnails.ts. Asserting the exported function's return value directly
// is the meaningful check available here; a real browser is what proves the
// resolved geometry (see the PR description).
describe('thumbnailLeftStyle', () => {
  test('centres unclamped mid-track, on a 100-wide window starting at 0', () => {
    // time 25 of [0, 100), half-width 80 (a 160px region): comfortably clear
    // of both edges, so clamp()'s middle argument wins.
    expect(thumbnailLeftStyle(25, 0, 100, 160)).toBe(
      'clamp(80px, 25%, calc(100% - 80px))'
    );
  });

  test('clamps to the near edge at time 0', () => {
    expect(thumbnailLeftStyle(0, 0, 100, 160)).toBe(
      'clamp(80px, 0%, calc(100% - 80px))'
    );
  });

  test('clamps to the far edge at the window end', () => {
    expect(thumbnailLeftStyle(100, 0, 100, 160)).toBe(
      'clamp(80px, 100%, calc(100% - 80px))'
    );
  });

  test('stays a plain percentage with no known region width', () => {
    expect(thumbnailLeftStyle(25, 0, 100, undefined)).toBe('25%');
  });

  test('is 0% with no active preview, regardless of region width', () => {
    expect(thumbnailLeftStyle(null, 0, 100, 80)).toBe('0%');
  });
});
