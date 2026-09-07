import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import type { VimeoSource } from '@playdeck/core';
import {
  createVimeoPosterAvailability,
  POSTER_PROBE_TIMEOUT_MS
} from '../src/poster-availability';

const publicSource: VimeoSource = { type: 'vimeo', videoId: '76979871' };

const oembedResponse = (body: unknown): Response => Response.json(body);

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn(async () =>
    oembedResponse({
      thumbnail_url: 'https://i.vimeocdn.com/video/example.jpg'
    })
  );
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

test('never asks Vimeo unless resolvePoster is opted into', async () => {
  const probe = createVimeoPosterAvailability({
    source: publicSource,
    options: {}
  }).probe();

  await expect(probe).resolves.toEqual({
    availability: { status: 'unknown', reason: 'provider-check' },
    url: null
  });
  expect(fetchMock).not.toHaveBeenCalled();
});

test('reads the thumbnail url from the oEmbed record for the watch url', async () => {
  const probe = createVimeoPosterAvailability({
    source: publicSource,
    options: { resolvePoster: true }
  }).probe();

  await expect(probe).resolves.toEqual({
    availability: { status: 'available' },
    url: 'https://i.vimeocdn.com/video/example.jpg'
  });
  expect(fetchMock).toHaveBeenCalledWith(
    'https://vimeo.com/api/oembed.json?url=https%3A%2F%2Fvimeo.com%2F76979871',
    {
      signal: expect.any(AbortSignal),
      referrerPolicy: 'strict-origin-when-cross-origin'
    }
  );
});

test('carries the privacy hash of an unlisted video into the watch url', async () => {
  await createVimeoPosterAvailability({
    source: { videoId: '76979871', hash: 'abc123' },
    options: { resolvePoster: true }
  }).probe();

  expect(fetchMock).toHaveBeenCalledWith(
    'https://vimeo.com/api/oembed.json?url=https%3A%2F%2Fvimeo.com%2F76979871%2Fabc123',
    expect.anything()
  );
});

test('reports unavailable/source when the record carries no thumbnail', async () => {
  fetchMock.mockResolvedValue(oembedResponse({}));

  const probe = createVimeoPosterAvailability({
    source: publicSource,
    options: { resolvePoster: true }
  }).probe();

  await expect(probe).resolves.toEqual({
    availability: { status: 'unavailable', reason: 'source' },
    url: null
  });
});

test('stays unresolved when the request fails rather than reporting a false verdict', async () => {
  fetchMock.mockResolvedValue(oembedResponse({}));
  fetchMock.mockRejectedValue(new Error('network down'));

  const probe = createVimeoPosterAvailability({
    source: publicSource,
    options: { resolvePoster: true }
  }).probe();

  await expect(probe).resolves.toEqual({
    availability: { status: 'unknown', reason: 'provider-check' },
    url: null
  });
});

test('stays unresolved when Vimeo answers with a non-ok response', async () => {
  fetchMock.mockResolvedValue(new Response(null, { status: 404 }));

  const probe = createVimeoPosterAvailability({
    source: publicSource,
    options: { resolvePoster: true }
  }).probe();

  await expect(probe).resolves.toEqual({
    availability: { status: 'unknown', reason: 'provider-check' },
    url: null
  });
});

test('adopt records the probed verdict, read back through availability() and url()', async () => {
  const posterAvailability = createVimeoPosterAvailability({
    source: publicSource,
    options: { resolvePoster: true }
  });
  expect(posterAvailability.availability()).toEqual({
    status: 'unknown',
    reason: 'provider-check'
  });
  expect(posterAvailability.url()).toBeNull();

  posterAvailability.adopt(await posterAvailability.probe());

  expect(posterAvailability.availability()).toEqual({ status: 'available' });
  expect(posterAvailability.url()).toBe(
    'https://i.vimeocdn.com/video/example.jpg'
  );
});

test('gives up on a probe that outruns the ready patch it would have informed', async () => {
  vi.useFakeTimers();
  fetchMock.mockImplementation(() => new Promise(() => undefined));
  const probe = createVimeoPosterAvailability({
    source: publicSource,
    options: { resolvePoster: true }
  }).probe();
  await vi.advanceTimersByTimeAsync(POSTER_PROBE_TIMEOUT_MS);
  await expect(probe).resolves.toEqual({
    availability: { status: 'unknown', reason: 'provider-check' },
    url: null
  });
});

test('aborts the request of a probe that outruns the timeout', async () => {
  vi.useFakeTimers();
  let capturedSignal: AbortSignal | undefined;
  fetchMock.mockImplementation((_url: string, init: RequestInit) => {
    capturedSignal = init.signal!;
    return new Promise(() => undefined);
  });
  createVimeoPosterAvailability({
    source: publicSource,
    options: { resolvePoster: true }
  }).probe();
  await vi.advanceTimersByTimeAsync(POSTER_PROBE_TIMEOUT_MS);
  expect(capturedSignal?.aborted).toBe(true);
});

test('cancel aborts the request in flight', async () => {
  let capturedSignal: AbortSignal | undefined;
  fetchMock.mockImplementation((_url: string, init: RequestInit) => {
    capturedSignal = init.signal!;
    return new Promise(() => undefined);
  });
  const posterAvailability = createVimeoPosterAvailability({
    source: publicSource,
    options: { resolvePoster: true }
  });
  posterAvailability.probe();
  posterAvailability.cancel();

  expect(capturedSignal?.aborted).toBe(true);
});
