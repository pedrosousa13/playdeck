import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import type { Availability, VimeoSource } from '@playdeck/core';
import {
  CHROMELESS_PROBE_TIMEOUT_MS,
  createVimeoChromelessAvailability,
  settleWithFallback,
  type VimeoChromelessProbe
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

// The init the probe handed to `fetch`, so a test can read the request that
// was actually made rather than any reconstruction of it.
const probeInit = (call = 0): RequestInit =>
  fetchMock.mock.calls[call]![1] as RequestInit;

// The signal the probe handed to `fetch`, so a test can read whether the
// request was aborted rather than only what the probe resolved.
const probeSignal = (call = 0): AbortSignal => probeInit(call).signal!;

// The verdict half of a probe result, for the tests that are about the verdict
// alone. The completion half beside it has its own tests, at the end of this
// file (#235).
const verdictOf = async (
  probe: Promise<VimeoChromelessProbe>
): Promise<Availability> => (await probe).verdict;

const probeFor = (
  accountType: unknown,
  source: VimeoSource = publicSource
): Promise<Availability> => {
  fetchMock.mockResolvedValue(oembedResponse({ account_type: accountType }));
  return verdictOf(
    createVimeoChromelessAvailability({
      source,
      options: { customControls: true }
    }).probe()
  );
};

test('reads the account tier from the oEmbed record for the watch url', async () => {
  await probeFor('pro');
  expect(fetchMock).toHaveBeenCalledWith(
    'https://vimeo.com/api/oembed.json?url=https%3A%2F%2Fvimeo.com%2F76979871',
    {
      signal: expect.any(AbortSignal),
      referrerPolicy: 'strict-origin-when-cross-origin'
    }
  );
});

test('carries the privacy hash of an unlisted video into the watch url', async () => {
  await probeFor('pro', { type: 'vimeo', videoId: '76979871', hash: 'abc123' });
  expect(fetchMock).toHaveBeenCalledWith(
    'https://vimeo.com/api/oembed.json?url=https%3A%2F%2Fvimeo.com%2F76979871%2Fabc123',
    {
      signal: expect.any(AbortSignal),
      referrerPolicy: 'strict-origin-when-cross-origin'
    }
  );
});

test('declares the referrer policy on the request it hands fetch', async () => {
  // The two assertions above pin this key too, but only incidentally: it rides
  // along in a whole-init comparison whose subject is the url. Named on its own
  // here so that a later refactor of those -- a looser matcher, a shared init
  // fixture -- cannot drop a security property without a test going red (#334).
  await probeFor('pro');
  expect(probeInit().referrerPolicy).toBe('strict-origin-when-cross-origin');
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
    verdictOf(
      createVimeoChromelessAvailability({
        source: publicSource,
        options: { customControls: true }
      }).probe()
    )
  ).resolves.toEqual({ status: 'unknown', reason: 'provider-check' });
});

test('leaves the verdict unresolved when the request itself fails', async () => {
  fetchMock.mockRejectedValue(new Error('offline'));
  await expect(
    verdictOf(
      createVimeoChromelessAvailability({
        source: publicSource,
        options: { customControls: true }
      }).probe()
    )
  ).resolves.toEqual({ status: 'unknown', reason: 'provider-check' });
});

test('leaves the verdict unresolved when the body is not JSON', async () => {
  fetchMock.mockResolvedValue(new Response('<html>'));
  await expect(
    verdictOf(
      createVimeoChromelessAvailability({
        source: publicSource,
        options: { customControls: true }
      }).probe()
    )
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
  await expect(verdictOf(probe)).resolves.toEqual({
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
  await expect(verdictOf(probe)).resolves.toEqual({
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
  await expect(verdictOf(abandoned)).resolves.toEqual({
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
  await expect(verdictOf(probe)).resolves.toEqual({
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
  await expect(verdictOf(probe)).resolves.toEqual({
    status: 'unknown',
    reason: 'provider-check'
  });
});

test('never asks oEmbed about an embed that shows Vimeo own controls', async () => {
  await expect(
    verdictOf(
      createVimeoChromelessAvailability({
        source: publicSource,
        options: { controls: true }
      }).probe()
    )
  ).resolves.toEqual({ status: 'unavailable', reason: 'provider' });
  expect(fetchMock).not.toHaveBeenCalled();
});

test('the Vimeo-controls short circuit wins even when custom controls were requested', async () => {
  await expect(
    verdictOf(
      createVimeoChromelessAvailability({
        source: publicSource,
        options: { controls: true, customControls: true }
      }).probe()
    )
  ).resolves.toEqual({ status: 'unavailable', reason: 'provider' });
  expect(fetchMock).not.toHaveBeenCalled();
});

test('never asks oEmbed when custom controls were not requested', async () => {
  await expect(
    verdictOf(
      createVimeoChromelessAvailability({
        source: publicSource,
        options: {}
      }).probe()
    )
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

// --- whether the probe completed (#235) ---
//
// The verdict is the same `providerCheck` in every unresolved case above, so
// these read the fact beside it instead: whether the probe got to an answer,
// or was stopped short of one. Only the second is a consumer's own environment
// speaking, and only the second is worth a notice.

const probeResult = (
  options: { controls?: boolean; customControls?: boolean } = {
    customControls: true
  }
): Promise<VimeoChromelessProbe> =>
  createVimeoChromelessAvailability({ source: publicSource, options }).probe();

test('reports a request that never reached Vimeo as a probe that did not complete', async () => {
  fetchMock.mockRejectedValue(new Error('Refused to connect to vimeo.com'));
  await expect(probeResult()).resolves.toEqual({
    verdict: { status: 'unknown', reason: 'provider-check' },
    completed: false
  });
});

test('reports a probe given up on at the deadline as one that did not complete', async () => {
  vi.useFakeTimers();
  fetchMock.mockImplementation(() => new Promise(() => undefined));
  const probe = probeResult();
  await vi.advanceTimersByTimeAsync(CHROMELESS_PROBE_TIMEOUT_MS);
  await expect(probe).resolves.toEqual({
    verdict: { status: 'unknown', reason: 'provider-check' },
    completed: false
  });
});

test('reports a cancelled probe as complete: the question was withdrawn, not left unanswered', async () => {
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
    verdict: { status: 'unknown', reason: 'provider-check' },
    completed: true
  });
});

test('reports a probe abandoned by a newer one as complete, the same as a cancel', async () => {
  fetchMock.mockImplementation(() => new Promise(() => undefined));
  const chromeless = createVimeoChromelessAvailability({
    source: publicSource,
    options: { customControls: true }
  });
  const abandoned = chromeless.probe();
  chromeless.probe();
  await expect(abandoned).resolves.toEqual({
    verdict: { status: 'unknown', reason: 'provider-check' },
    completed: true
  });
});

test('reports a cancel that interrupts the body read as complete: the response had arrived', async () => {
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
  await Promise.resolve();
  await Promise.resolve();
  chromeless.cancel();
  await expect(probe).resolves.toEqual({
    verdict: { status: 'unknown', reason: 'provider-check' },
    completed: true
  });
});

test.each([
  ['a refused request', () => new Response('nope', { status: 404 })],
  ['a body that is not JSON', () => new Response('<html>')],
  ['a record naming no tier', () => oembedResponse({ video_id: 76979871 })],
  ['an unrecognized tier', () => oembedResponse({ account_type: 'galactic' })]
])(
  'reports %s as a completed probe, since Vimeo answered',
  async (_form, response) => {
    fetchMock.mockResolvedValue(response());
    await expect(probeResult()).resolves.toEqual({
      verdict: { status: 'unknown', reason: 'provider-check' },
      completed: true
    });
  }
);

test('reports a paid tier as a completed probe', async () => {
  fetchMock.mockResolvedValue(oembedResponse({ account_type: 'pro' }));
  await expect(probeResult()).resolves.toEqual({
    verdict: { status: 'available' },
    completed: true
  });
});

test('reports a plan-limited tier as a completed probe', async () => {
  fetchMock.mockResolvedValue(oembedResponse({ account_type: 'basic' }));
  await expect(probeResult()).resolves.toEqual({
    verdict: { status: 'unavailable', reason: 'provider-plan' },
    completed: true
  });
});

test('reports the Vimeo-controls short circuit as a completed probe', async () => {
  await expect(probeResult({ controls: true })).resolves.toEqual({
    verdict: { status: 'unavailable', reason: 'provider' },
    completed: true
  });
  expect(fetchMock).not.toHaveBeenCalled();
});

test('reports the opt-in short circuit as a completed probe', async () => {
  await expect(probeResult({})).resolves.toEqual({
    verdict: { status: 'unknown', reason: 'provider-check' },
    completed: true
  });
  expect(fetchMock).not.toHaveBeenCalled();
});

// -- a rejected request settles incomplete, not completed (#235) --
//
// `chromelessAvailability` catches its own failures today, so nothing reaches
// `settleWithFallback` by rejecting. Exercised directly here anyway: reusing
// the abort handler as the rejection handler once meant a rejection defaulted
// to `completed`, silently dropping the notice it should have earned, and
// nothing above would have caught that if the internal catch ever moved.

test('settles a rejected request as incomplete rather than defaulting to completed', async () => {
  const controller = new AbortController();
  await expect(
    settleWithFallback(
      Promise.reject(new Error('boom')),
      CHROMELESS_PROBE_TIMEOUT_MS,
      controller
    )
  ).resolves.toEqual({
    verdict: { status: 'unknown', reason: 'provider-check' },
    completed: false
  });
});

test('a rejected request does not abort the controller or leave the timer running', async () => {
  vi.useFakeTimers();
  const abortSpy = vi.spyOn(AbortController.prototype, 'abort');
  const controller = new AbortController();
  await settleWithFallback(
    Promise.reject(new Error('boom')),
    CHROMELESS_PROBE_TIMEOUT_MS,
    controller
  );
  expect(abortSpy).not.toHaveBeenCalled();
  // If the timer were still armed, advancing past the deadline would call
  // `abort()` from the timeout callback.
  vi.advanceTimersByTime(CHROMELESS_PROBE_TIMEOUT_MS);
  expect(abortSpy).not.toHaveBeenCalled();
});
