import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import type { WistiaSource } from '@playdeck/core';
import {
  createWistiaPosterAvailability,
  POSTER_PROBE_TIMEOUT_MS
} from '../src/poster-availability';

const source: WistiaSource = { type: 'wistia', mediaId: 'e4a27b971d' };

const oembedResponse = (body: unknown): Response => Response.json(body);

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn(async () =>
    oembedResponse({
      thumbnail_url: 'https://embed.wistia.com/deliveries/example.jpg'
    })
  );
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

test('never asks Wistia unless resolvePoster is opted into', async () => {
  const probe = createWistiaPosterAvailability({
    source,
    options: {}
  }).probe();

  await expect(probe).resolves.toEqual({
    availability: { status: 'unknown', reason: 'provider-check' },
    url: null
  });
  expect(fetchMock).not.toHaveBeenCalled();
});

test('reads the thumbnail url from the oEmbed record for the media id', async () => {
  const probe = createWistiaPosterAvailability({
    source,
    options: { resolvePoster: true }
  }).probe();

  await expect(probe).resolves.toEqual({
    availability: { status: 'available' },
    url: 'https://embed.wistia.com/deliveries/example.jpg'
  });
  expect(fetchMock).toHaveBeenCalledWith(
    'https://fast.wistia.com/oembed?url=https%3A%2F%2Fhome.wistia.com%2Fmedias%2Fe4a27b971d&format=json',
    { signal: expect.any(AbortSignal) }
  );
});

test('reports unavailable/source when the record carries no thumbnail', async () => {
  fetchMock.mockResolvedValue(oembedResponse({}));

  const probe = createWistiaPosterAvailability({
    source,
    options: { resolvePoster: true }
  }).probe();

  await expect(probe).resolves.toEqual({
    availability: { status: 'unavailable', reason: 'source' },
    url: null
  });
});

test('stays unresolved when the request fails rather than reporting a false verdict', async () => {
  fetchMock.mockRejectedValue(new Error('network down'));

  const probe = createWistiaPosterAvailability({
    source,
    options: { resolvePoster: true }
  }).probe();

  await expect(probe).resolves.toEqual({
    availability: { status: 'unknown', reason: 'provider-check' },
    url: null
  });
});

test('stays unresolved when Wistia answers with a non-ok response', async () => {
  fetchMock.mockResolvedValue(new Response(null, { status: 404 }));

  const probe = createWistiaPosterAvailability({
    source,
    options: { resolvePoster: true }
  }).probe();

  await expect(probe).resolves.toEqual({
    availability: { status: 'unknown', reason: 'provider-check' },
    url: null
  });
});

test('adopt records the probed verdict, read back through availability() and url()', async () => {
  const posterAvailability = createWistiaPosterAvailability({
    source,
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
    'https://embed.wistia.com/deliveries/example.jpg'
  );
});

test('gives up on a probe that outruns the ready patch it would have informed', async () => {
  vi.useFakeTimers();
  fetchMock.mockImplementation(() => new Promise(() => undefined));
  const probe = createWistiaPosterAvailability({
    source,
    options: { resolvePoster: true }
  }).probe();
  await vi.advanceTimersByTimeAsync(POSTER_PROBE_TIMEOUT_MS);
  await expect(probe).resolves.toEqual({
    availability: { status: 'unknown', reason: 'provider-check' },
    url: null
  });
});

test('cancel aborts the request in flight', async () => {
  let capturedSignal: AbortSignal | undefined;
  fetchMock.mockImplementation((_url: string, init: RequestInit) => {
    capturedSignal = init.signal!;
    return new Promise(() => undefined);
  });
  const posterAvailability = createWistiaPosterAvailability({
    source,
    options: { resolvePoster: true }
  });
  posterAvailability.probe();
  posterAvailability.cancel();

  expect(capturedSignal?.aborted).toBe(true);
});
