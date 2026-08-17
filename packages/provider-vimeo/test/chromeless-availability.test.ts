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

// The signal the probe handed to `fetch`, so a test can read whether the
// request was aborted rather than only what the probe resolved.
const probeSignal = (call = 0): AbortSignal =>
  (fetchMock.mock.calls[call]![1] as RequestInit).signal!;

const probeFor = (
  accountType: unknown,
  source: VimeoSource = publicSource
): Promise<unknown> => {
  fetchMock.mockResolvedValue(oembedResponse({ account_type: accountType }));
  return createVimeoChromelessAvailability({
    source,
    options: { customControls: true }
  }).probe();
};

test('reads the account tier from the oEmbed record for the watch url', async () => {
  await probeFor('pro');
  expect(fetchMock).toHaveBeenCalledWith(
    'https://vimeo.com/api/oembed.json?url=https%3A%2F%2Fvimeo.com%2F76979871',
    { signal: expect.any(AbortSignal) }
  );
});

test('carries the privacy hash of an unlisted video into the watch url', async () => {
  await probeFor('pro', { type: 'vimeo', videoId: '76979871', hash: 'abc123' });
  expect(fetchMock).toHaveBeenCalledWith(
    'https://vimeo.com/api/oembed.json?url=https%3A%2F%2Fvimeo.com%2F76979871%2Fabc123',
    { signal: expect.any(AbortSignal) }
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
      options: { customControls: true }
    }).probe()
  ).resolves.toEqual({ status: 'unknown', reason: 'provider-check' });
});

test('leaves the verdict unresolved when the request itself fails', async () => {
  fetchMock.mockRejectedValue(new Error('offline'));
  await expect(
    createVimeoChromelessAvailability({
      source: publicSource,
      options: { customControls: true }
    }).probe()
  ).resolves.toEqual({ status: 'unknown', reason: 'provider-check' });
});

test('leaves the verdict unresolved when the body is not JSON', async () => {
  fetchMock.mockResolvedValue(new Response('<html>'));
  await expect(
    createVimeoChromelessAvailability({
      source: publicSource,
      options: { customControls: true }
    }).probe()
  ).resolves.toEqual({ status: 'unknown', reason: 'provider-check' });
});

test('gives up on a probe that outruns the attach it would have informed', async () => {
  vi.useFakeTimers();
  fetchMock.mockImplementation(() => new Promise(() => undefined));
  const probe = createVimeoChromelessAvailability({
    source: publicSource,
    options: { customControls: true }
  }).probe();
  await vi.advanceTimersByTimeAsync(CHROMELESS_PROBE_TIMEOUT_MS);
  await expect(probe).resolves.toEqual({
    status: 'unknown',
    reason: 'provider-check'
  });
});

test('aborts the request of a probe that outruns that attach', async () => {
  vi.useFakeTimers();
  fetchMock.mockImplementation(() => new Promise(() => undefined));
  createVimeoChromelessAvailability({
    source: publicSource,
    options: { customControls: true }
  }).probe();
  await vi.advanceTimersByTimeAsync(CHROMELESS_PROBE_TIMEOUT_MS);
  expect(probeSignal().aborted).toBe(true);
});

test('cancel aborts the request of a probe still in flight', async () => {
  fetchMock.mockImplementation(() => new Promise(() => undefined));
  const chromeless = createVimeoChromelessAvailability({
    source: publicSource,
    options: { customControls: true }
  });
  const probe = chromeless.probe();
  chromeless.cancel();
  expect(probeSignal().aborted).toBe(true);
  await expect(probe).resolves.toEqual({
    status: 'unknown',
    reason: 'provider-check'
  });
});

test('a probe that starts while another runs abandons the older request', async () => {
  fetchMock.mockImplementation(() => new Promise(() => undefined));
  const chromeless = createVimeoChromelessAvailability({
    source: publicSource,
    options: { customControls: true }
  });
  const abandoned = chromeless.probe();
  chromeless.probe();
  expect(probeSignal(0).aborted).toBe(true);
  expect(probeSignal(1).aborted).toBe(false);
  await expect(abandoned).resolves.toEqual({
    status: 'unknown',
    reason: 'provider-check'
  });
});

test('a cancelled probe resolves rather than rejecting', async () => {
  // The request rejects on abort, the way a real fetch does. The cancel
  // settles the probe on the provisional verdict, and that rejection lands on
  // the request's own catch instead of reaching the caller.
  fetchMock.mockImplementation(
    (_url: string, init: RequestInit) =>
      new Promise((_resolve, reject) => {
        init.signal?.addEventListener('abort', () =>
          reject(init.signal?.reason)
        );
      })
  );
  const chromeless = createVimeoChromelessAvailability({
    source: publicSource,
    options: { customControls: true }
  });
  const probe = chromeless.probe();
  chromeless.cancel();
  await expect(probe).resolves.toEqual({
    status: 'unknown',
    reason: 'provider-check'
  });
});

test('a cancel between the response and the verdict still reaches the request', async () => {
  // The response's headers have arrived and its body is still being read when
  // the cancel lands, so it is the read the abort interrupts rather than the
  // request — and the body only ever fails because that abort reached it.
  let deliverResponse!: () => void;
  fetchMock.mockImplementation(
    (_url: string, init: RequestInit) =>
      new Promise<Response>((resolve) => {
        deliverResponse = () =>
          resolve({
            ok: true,
            json: () =>
              new Promise((_resolve, reject) => {
                init.signal?.addEventListener('abort', () =>
                  reject(init.signal?.reason)
                );
              })
          } as unknown as Response);
      })
  );
  const chromeless = createVimeoChromelessAvailability({
    source: publicSource,
    options: { customControls: true }
  });
  const probe = chromeless.probe();
  deliverResponse();
  // Let the probe take the response and start reading its body.
  await Promise.resolve();
  await Promise.resolve();
  chromeless.cancel();
  expect(probeSignal().aborted).toBe(true);
  await expect(probe).resolves.toEqual({
    status: 'unknown',
    reason: 'provider-check'
  });
});

test('never asks oEmbed about an embed that shows Vimeo own controls', async () => {
  await expect(
    createVimeoChromelessAvailability({
      source: publicSource,
      options: { controls: true }
    }).probe()
  ).resolves.toEqual({ status: 'unavailable', reason: 'provider' });
  expect(fetchMock).not.toHaveBeenCalled();
});

test('the Vimeo-controls short circuit wins even when custom controls were requested', async () => {
  await expect(
    createVimeoChromelessAvailability({
      source: publicSource,
      options: { controls: true, customControls: true }
    }).probe()
  ).resolves.toEqual({ status: 'unavailable', reason: 'provider' });
  expect(fetchMock).not.toHaveBeenCalled();
});

test('never asks oEmbed when custom controls were not requested', async () => {
  await expect(
    createVimeoChromelessAvailability({
      source: publicSource,
      options: {}
    }).probe()
  ).resolves.toEqual({ status: 'unknown', reason: 'provider-check' });
  expect(fetchMock).not.toHaveBeenCalled();
});

test('holds the verdict unresolved until one is adopted', async () => {
  const chromeless = createVimeoChromelessAvailability({
    source: publicSource,
    options: { customControls: true }
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
