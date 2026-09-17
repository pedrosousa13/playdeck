// @vitest-environment happy-dom

import {
  act,
  cleanup,
  fireEvent,
  render,
  waitFor
} from '@testing-library/react';
import { createRef, type ReactNode } from 'react';
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
import { thumbnailLeftStyle } from '../src/thumbnails';

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
    expect(fetchMock).not.toHaveBeenCalled();
    expect(attr(getThumbnail(), 'data-state')).toBe('hidden');
  });

  test('arms the fetch on the first pointer over the slider, and only once', async () => {
    renderWithPlayer(
      <Player.SeekSlider thumbnails="https://cdn.example.test/thumbs.vtt" />
    );
    hoverAt(25);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(fetchMock).toHaveBeenCalledWith(
      'https://cdn.example.test/thumbs.vtt',
      expect.objectContaining({ signal: expect.anything() })
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
    expect(capturedSignal?.aborted).toBe(false);

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
