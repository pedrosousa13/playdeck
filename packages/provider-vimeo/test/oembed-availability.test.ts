import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import type { VimeoSource } from '@playdeck/core';
import { createVimeoOembedRequest } from '../src/oembed-availability';

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

const probeInit = (call = 0): RequestInit =>
  fetchMock.mock.calls[call]![1] as RequestInit;

const probeSignal = (call = 0): AbortSignal => probeInit(call).signal!;

// --- sharing (#556) ---

test('a poster ask that arrives while a chromeless ask is in flight joins the same GET', async () => {
  const oembedRequest = createVimeoOembedRequest(publicSource);
  const chromeless = oembedRequest.request('chromeless');
  const poster = oembedRequest.request('poster');

  expect(fetchMock).toHaveBeenCalledTimes(1);
  await expect(chromeless).resolves.toEqual({
    responded: true,
    record: { account_type: 'pro' }
  });
  await expect(poster).resolves.toEqual({
    responded: true,
    record: { account_type: 'pro' }
  });
});

test('a chromeless ask that arrives while a poster ask is in flight joins the same GET', async () => {
  const oembedRequest = createVimeoOembedRequest(publicSource);
  const poster = oembedRequest.request('poster');
  const chromeless = oembedRequest.request('chromeless');

  expect(fetchMock).toHaveBeenCalledTimes(1);
  await Promise.all([chromeless, poster]);
});

test('the same facet asking again starts a fresh request rather than joining its own', async () => {
  fetchMock.mockImplementation(() => new Promise(() => undefined));
  const oembedRequest = createVimeoOembedRequest(publicSource);
  const first = oembedRequest.request('chromeless');
  oembedRequest.request('chromeless');

  expect(fetchMock).toHaveBeenCalledTimes(2);
  expect(probeSignal(0).aborted).toBe(true);
  expect(probeSignal(1).aborted).toBe(false);
  await expect(first).resolves.toEqual({ responded: false, withdrawn: true });
});

test('a facet asking again after the shared request has settled starts a fresh one', async () => {
  const oembedRequest = createVimeoOembedRequest(publicSource);
  await oembedRequest.request('chromeless');
  await oembedRequest.request('poster');

  expect(fetchMock).toHaveBeenCalledTimes(2);
});

test('cancel withdraws the shared request for every facet waiting on it', async () => {
  fetchMock.mockImplementation(() => new Promise(() => undefined));
  const oembedRequest = createVimeoOembedRequest(publicSource);
  const chromeless = oembedRequest.request('chromeless');
  const poster = oembedRequest.request('poster');
  oembedRequest.cancel();

  expect(probeSignal().aborted).toBe(true);
  await expect(chromeless).resolves.toEqual({
    responded: false,
    withdrawn: true
  });
  await expect(poster).resolves.toEqual({ responded: false, withdrawn: true });
});

// --- the request that never answered (#235) ---
//
// `withdrawn` is what `chromeless-availability.ts` reads to tell a probe that
// completed without an answer worth a notice apart from one that was simply
// no longer wanted; `poster-availability.ts` reports the same `unresolved`
// either way and never reads it.

test('reports a deadline as a request that did not answer and was not withdrawn', async () => {
  vi.useFakeTimers();
  fetchMock.mockImplementation(() => new Promise(() => undefined));
  const probe = createVimeoOembedRequest(publicSource).request('chromeless');
  await vi.advanceTimersByTimeAsync(4000);
  await expect(probe).resolves.toEqual({ responded: false, withdrawn: false });
});

test('aborts the underlying request at the deadline', async () => {
  vi.useFakeTimers();
  fetchMock.mockImplementation(() => new Promise(() => undefined));
  createVimeoOembedRequest(publicSource).request('chromeless');
  await vi.advanceTimersByTimeAsync(4000);
  expect(probeSignal().aborted).toBe(true);
});

test('settles a rejected request as not withdrawn rather than defaulting to withdrawn', async () => {
  fetchMock.mockRejectedValue(new Error('boom'));
  await expect(
    createVimeoOembedRequest(publicSource).request('chromeless')
  ).resolves.toEqual({ responded: false, withdrawn: false });
});

test('a rejected request does not abort the controller or leave the timer running', async () => {
  vi.useFakeTimers();
  const abortSpy = vi.spyOn(AbortController.prototype, 'abort');
  fetchMock.mockRejectedValue(new Error('boom'));
  await createVimeoOembedRequest(publicSource).request('chromeless');
  expect(abortSpy).not.toHaveBeenCalled();
  // If the timer were still armed, advancing past the deadline would call
  // `abort()` from the timeout callback.
  vi.advanceTimersByTime(4000);
  expect(abortSpy).not.toHaveBeenCalled();
});
