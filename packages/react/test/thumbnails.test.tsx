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
  THUMBNAILS_FETCH_BYTE_CAP,
  THUMBNAILS_FETCH_TIMEOUT_MS
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
    // getAttribute, not the `.src` property: the latter resolves the value
    // against the document's base URL and percent-encodes it, which would
    // obscure the literal character this test is about.
    expect(getThumbnail()!.querySelector('img')!.getAttribute('src')).toBe(
      'thumb-a�'
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
