import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import type { VimeoSource } from '@reely/core';
import {
  CHROMELESS_PROBE_TIMEOUT_MS,
  createVimeoChromelessAvailability
} from '../src/chromeless-availability';

const publicSource: VimeoSource = { type: 'vimeo', videoId: '76979871' };

const oembedResponse = (body: unknown): Response => Response.json(body);

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn(async () => oembedResponse({ account_type: 'pro' }));
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

const probeFor = (
  accountType: unknown,
  source: VimeoSource = publicSource
): Promise<unknown> => {
  fetchMock.mockResolvedValue(oembedResponse({ account_type: accountType }));
  return createVimeoChromelessAvailability({
    source,
    controls: undefined
  }).probe();
};

test('reads the account tier from the oEmbed record for the watch url', async () => {
  await probeFor('pro');
  expect(fetchMock).toHaveBeenCalledWith(
    'https://vimeo.com/api/oembed.json?url=https%3A%2F%2Fvimeo.com%2F76979871'
  );
});

test('carries the privacy hash of an unlisted video into the watch url', async () => {
  await probeFor('pro', { type: 'vimeo', videoId: '76979871', hash: 'abc123' });
  expect(fetchMock).toHaveBeenCalledWith(
    'https://vimeo.com/api/oembed.json?url=https%3A%2F%2Fvimeo.com%2F76979871%2Fabc123'
  );
});

test.each(['plus', 'pro', 'business', 'premium', 'enterprise', 'custom'])(
  'reports a legacy paid tier (%s) as chromeless-capable',
  async (accountType) => {
    await expect(probeFor(accountType)).resolves.toEqual({
      status: 'available'
    });
  }
);

test.each(['starter', 'standard', 'advanced'])(
  'reports a renamed 2023 paid tier (%s) as chromeless-capable',
  async (accountType) => {
    await expect(probeFor(accountType)).resolves.toEqual({
      status: 'available'
    });
  }
);

test.each(['free', 'basic'])(
  'reports the plan-limited tier %s as withheld by the plan',
  async (accountType) => {
    await expect(probeFor(accountType)).resolves.toEqual({
      status: 'unavailable',
      reason: 'provider-plan'
    });
  }
);

test('leaves an unrecognized future tier unresolved rather than assuming', async () => {
  await expect(probeFor('galactic')).resolves.toEqual({
    status: 'unknown',
    reason: 'provider-check'
  });
});

test('leaves the verdict unresolved when the record names no tier', async () => {
  await expect(probeFor(undefined)).resolves.toEqual({
    status: 'unknown',
    reason: 'provider-check'
  });
});

test('leaves the verdict unresolved when the tier is not a string', async () => {
  await expect(probeFor(42)).resolves.toEqual({
    status: 'unknown',
    reason: 'provider-check'
  });
});

test('leaves the verdict unresolved when oEmbed refuses the request', async () => {
  fetchMock.mockResolvedValue(new Response('nope', { status: 404 }));
  await expect(
    createVimeoChromelessAvailability({
      source: publicSource,
      controls: undefined
    }).probe()
  ).resolves.toEqual({ status: 'unknown', reason: 'provider-check' });
});

test('leaves the verdict unresolved when the request itself fails', async () => {
  fetchMock.mockRejectedValue(new Error('offline'));
  await expect(
    createVimeoChromelessAvailability({
      source: publicSource,
      controls: undefined
    }).probe()
  ).resolves.toEqual({ status: 'unknown', reason: 'provider-check' });
});

test('leaves the verdict unresolved when the body is not JSON', async () => {
  fetchMock.mockResolvedValue(new Response('<html>'));
  await expect(
    createVimeoChromelessAvailability({
      source: publicSource,
      controls: undefined
    }).probe()
  ).resolves.toEqual({ status: 'unknown', reason: 'provider-check' });
});

test('gives up on a probe that outruns the attach it would have informed', async () => {
  vi.useFakeTimers();
  fetchMock.mockImplementation(() => new Promise(() => undefined));
  const probe = createVimeoChromelessAvailability({
    source: publicSource,
    controls: undefined
  }).probe();
  await vi.advanceTimersByTimeAsync(CHROMELESS_PROBE_TIMEOUT_MS);
  await expect(probe).resolves.toEqual({
    status: 'unknown',
    reason: 'provider-check'
  });
});

test('never asks oEmbed about an embed that shows Vimeo own controls', async () => {
  await expect(
    createVimeoChromelessAvailability({
      source: publicSource,
      controls: true
    }).probe()
  ).resolves.toEqual({ status: 'unavailable', reason: 'provider' });
  expect(fetchMock).not.toHaveBeenCalled();
});

test('holds the verdict unresolved until one is adopted', async () => {
  const chromeless = createVimeoChromelessAvailability({
    source: publicSource,
    controls: undefined
  });
  expect(chromeless.customControlsAvailability()).toEqual({
    status: 'unknown',
    reason: 'provider-check'
  });
  chromeless.adopt(await chromeless.probe());
  expect(chromeless.customControlsAvailability()).toEqual({
    status: 'available'
  });
});
