// @vitest-environment happy-dom

import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { API_READY_TIMEOUT_MS, type YouTubeIframeApi } from '../src/index';

const scriptSelector = 'script[src="https://www.youtube.com/iframe_api"]';

const deadlineMessage =
  'The YouTube iframe API script loaded but did not initialize within 15000 ms.';

type LoaderWindow = Window & {
  YT?: YouTubeIframeApi;
  onYouTubeIframeAPIReady?: () => void;
};

const loaderWindow = (): LoaderWindow => window as LoaderWindow;

const fakeApi = (): YouTubeIframeApi => ({
  Player: class {
    destroy(): void {}
  } as unknown as YouTubeIframeApi['Player'],
  PlayerState: {
    BUFFERING: 3,
    CUED: 5,
    ENDED: 0,
    PAUSED: 2,
    PLAYING: 1,
    UNSTARTED: -1
  }
});

const importLoader = async () => {
  const { loadYouTubeIframeApi } = await import('../src/loader');
  return loadYouTubeIframeApi;
};

// The deadline arrives as a rejection, so the handler is attached before the
// clock moves: a rejection left unhandled across the advance fails the run.
const messageAtDeadline = async (
  load: Promise<unknown>,
  advanceBy = API_READY_TIMEOUT_MS
): Promise<string> => {
  const settled = load.then(
    () => 'the load resolved',
    (error: unknown) => (error as Error).message
  );
  await vi.advanceTimersByTimeAsync(advanceBy);
  return settled;
};

beforeEach(() => {
  vi.resetModules();
  // The vitest happy-dom environment cannot fetch script files; it logs a
  // NotSupportedError for every external script append. Silence that noise.
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  delete loaderWindow().YT;
  delete loaderWindow().onYouTubeIframeAPIReady;
  document
    .querySelectorAll(scriptSelector)
    .forEach((script) => script.remove());
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  delete loaderWindow().YT;
  delete loaderWindow().onYouTubeIframeAPIReady;
});

test('injects one API script per window and shares one promise', async () => {
  const loadYouTubeIframeApi = await importLoader();

  const first = loadYouTubeIframeApi();
  const second = loadYouTubeIframeApi();

  expect(second).toBe(first);
  expect(document.querySelectorAll(scriptSelector)).toHaveLength(1);

  const api = fakeApi();
  loaderWindow().YT = api;
  loaderWindow().onYouTubeIframeAPIReady?.();

  await expect(first).resolves.toBe(api);
  await expect(second).resolves.toBe(api);
  expect(document.querySelectorAll(scriptSelector)).toHaveLength(1);
});

test('reuses an API script another consumer already injected', async () => {
  const existing = document.createElement('script');
  existing.src = 'https://www.youtube.com/iframe_api';
  document.head.appendChild(existing);
  const loadYouTubeIframeApi = await importLoader();

  const load = loadYouTubeIframeApi();

  expect(document.querySelectorAll(scriptSelector)).toHaveLength(1);

  const api = fakeApi();
  loaderWindow().YT = api;
  loaderWindow().onYouTubeIframeAPIReady?.();

  await expect(load).resolves.toBe(api);
});

test('resolves immediately when the API is already on the window', async () => {
  const api = fakeApi();
  loaderWindow().YT = api;
  const loadYouTubeIframeApi = await importLoader();

  await expect(loadYouTubeIframeApi()).resolves.toBe(api);
  expect(document.querySelectorAll(scriptSelector)).toHaveLength(0);
});

test('chains a pre-existing onYouTubeIframeAPIReady callback', async () => {
  const previousCallback = vi.fn();
  loaderWindow().onYouTubeIframeAPIReady = previousCallback;
  const loadYouTubeIframeApi = await importLoader();

  const load = loadYouTubeIframeApi();
  const api = fakeApi();
  loaderWindow().YT = api;
  loaderWindow().onYouTubeIframeAPIReady?.();

  await expect(load).resolves.toBe(api);
  expect(previousCallback).toHaveBeenCalledTimes(1);
});

test('cleans up after a script error so a retry injects a fresh script', async () => {
  const loadYouTubeIframeApi = await importLoader();

  const failed = loadYouTubeIframeApi();
  const script = document.querySelector(scriptSelector);
  expect(script).not.toBeNull();
  script?.dispatchEvent(new Event('error'));

  await expect(failed).rejects.toThrow(
    'The YouTube iframe API script failed to load.'
  );
  expect(document.querySelectorAll(scriptSelector)).toHaveLength(0);
  expect(loaderWindow().onYouTubeIframeAPIReady).toBeUndefined();

  const retried = loadYouTubeIframeApi();
  expect(retried).not.toBe(failed);
  expect(document.querySelectorAll(scriptSelector)).toHaveLength(1);

  const api = fakeApi();
  loaderWindow().YT = api;
  loaderWindow().onYouTubeIframeAPIReady?.();

  await expect(retried).resolves.toBe(api);
});

test('rejects without cleanup side effects when the script initializes no API', async () => {
  const loadYouTubeIframeApi = await importLoader();

  const load = loadYouTubeIframeApi();
  loaderWindow().onYouTubeIframeAPIReady?.();

  await expect(load).rejects.toThrow(
    'The YouTube iframe API script did not initialize.'
  );

  const retried = loadYouTubeIframeApi();
  const api = fakeApi();
  loaderWindow().YT = api;
  loaderWindow().onYouTubeIframeAPIReady?.();

  await expect(retried).resolves.toBe(api);
});

test('gives the API the same deadline the sibling embed providers give theirs', () => {
  // Pins the number itself. That it matches Wistia's `API_READY_TIMEOUT_MS` is
  // a convention no assertion here can enforce — the two packages share no
  // build edge — so changing either one is a manual re-check of the other.
  expect(API_READY_TIMEOUT_MS).toBe(15_000);
});

test('rejects on the deadline when the script never initializes the API', async () => {
  vi.useFakeTimers();
  const loadYouTubeIframeApi = await importLoader();

  expect(await messageAtDeadline(loadYouTubeIframeApi())).toBe(deadlineMessage);
});

test('starts a genuinely new attempt after the deadline rejected the last one', async () => {
  vi.useFakeTimers();
  const loadYouTubeIframeApi = await importLoader();

  const timedOut = loadYouTubeIframeApi();
  const firstScript = document.querySelector(scriptSelector);
  expect(await messageAtDeadline(timedOut)).toBe(deadlineMessage);
  expect(document.querySelector(scriptSelector)).toBeNull();

  const retried = loadYouTubeIframeApi();
  expect(retried).not.toBe(timedOut);
  const secondScript = document.querySelector(scriptSelector);
  // A count of one holds just as well when the dead element was silently
  // re-adopted, which is the state this exists to rule out.
  expect(secondScript).not.toBeNull();
  expect(secondScript).not.toBe(firstScript);

  const api = fakeApi();
  loaderWindow().YT = api;
  loaderWindow().onYouTubeIframeAPIReady?.();

  await expect(retried).resolves.toBe(api);
});

test('puts a script another consumer already injected under the same deadline', async () => {
  vi.useFakeTimers();
  // Already failed before the loader saw it: no further `error` can fire, so
  // adopting it without a deadline would never settle.
  const existing = document.createElement('script');
  existing.src = 'https://www.youtube.com/iframe_api';
  document.head.appendChild(existing);
  const loadYouTubeIframeApi = await importLoader();

  expect(await messageAtDeadline(loadYouTubeIframeApi())).toBe(deadlineMessage);
});

test('restores a pre-existing ready callback when the deadline expires', async () => {
  vi.useFakeTimers();
  const previousCallback = vi.fn();
  loaderWindow().onYouTubeIframeAPIReady = previousCallback;
  const loadYouTubeIframeApi = await importLoader();

  const timedOut = loadYouTubeIframeApi();
  expect(await messageAtDeadline(timedOut)).toBe(deadlineMessage);
  expect(loaderWindow().onYouTubeIframeAPIReady).toBe(previousCallback);

  // A late API cannot settle the attempt that was already discarded.
  loaderWindow().YT = fakeApi();
  loaderWindow().onYouTubeIframeAPIReady?.();

  expect(previousCallback).toHaveBeenCalledTimes(1);
  await expect(timedOut).rejects.toThrow(deadlineMessage);
});

test('leaves no deadline armed once the ready callback lands', async () => {
  vi.useFakeTimers();
  const loadYouTubeIframeApi = await importLoader();

  const load = loadYouTubeIframeApi();
  const api = fakeApi();
  loaderWindow().YT = api;
  loaderWindow().onYouTubeIframeAPIReady?.();

  await expect(load).resolves.toBe(api);
  expect(document.querySelectorAll(scriptSelector)).toHaveLength(1);
  expect(vi.getTimerCount()).toBe(0);
});

test('resetYouTubeIframeApiLoader drops the memo so the next load starts fresh', async () => {
  // The discarded attempt is left pending on purpose, so its deadline is put on
  // the fake clock rather than the real one, where it would outlive the test.
  vi.useFakeTimers();
  const { loadYouTubeIframeApi, resetYouTubeIframeApiLoader } =
    await import('../src/loader');

  const first = loadYouTubeIframeApi();
  expect(loadYouTubeIframeApi()).toBe(first);

  resetYouTubeIframeApiLoader();

  const second = loadYouTubeIframeApi();
  expect(second).not.toBe(first);

  const api = fakeApi();
  loaderWindow().YT = api;
  loaderWindow().onYouTubeIframeAPIReady?.();
  await expect(second).resolves.toBe(api);
});

test('a superseded attempt leaves the script the next attempt adopted in place', async () => {
  vi.useFakeTimers();
  const { loadYouTubeIframeApi, resetYouTubeIframeApiLoader } =
    await import('../src/loader');

  const superseded = loadYouTubeIframeApi();
  const injected = document.querySelector(scriptSelector);
  resetYouTubeIframeApiLoader();
  // A tick apart, so the superseded attempt's deadline lands on its own while
  // the attempt that adopted its script element is still waiting.
  await vi.advanceTimersByTimeAsync(1);
  const adopting = loadYouTubeIframeApi();

  expect(await messageAtDeadline(superseded, API_READY_TIMEOUT_MS - 1)).toBe(
    deadlineMessage
  );

  expect(document.querySelector(scriptSelector)).toBe(injected);

  const api = fakeApi();
  loaderWindow().YT = api;
  loaderWindow().onYouTubeIframeAPIReady?.();
  await expect(adopting).resolves.toBe(api);
});

test('retry loads the API again after the first attempt hit the deadline', async () => {
  vi.useFakeTimers();
  const { createYouTubeProvider } = await import('../src/index');
  const provider = createYouTubeProvider(
    document.createElement('div'),
    'dQw4w9WgXcQ'
  );
  provider.attach();

  expect(await messageAtDeadline(Promise.resolve(provider.load()))).toBe(
    deadlineMessage
  );

  // `start` installs the next attempt's callback before its first await, so
  // the API can be handed over synchronously after the command is issued.
  const retried = provider.retry();
  loaderWindow().YT = fakeApi();
  loaderWindow().onYouTubeIframeAPIReady?.();

  await expect(retried).resolves.toEqual({ ok: true });
  provider.destroy();
});

test('ignores a late script error after the API resolved', async () => {
  const loadYouTubeIframeApi = await importLoader();

  const load = loadYouTubeIframeApi();
  const api = fakeApi();
  loaderWindow().YT = api;
  loaderWindow().onYouTubeIframeAPIReady?.();
  await expect(load).resolves.toBe(api);

  document.querySelector(scriptSelector)?.dispatchEvent(new Event('error'));

  await expect(loadYouTubeIframeApi()).resolves.toBe(api);
  expect(document.querySelectorAll(scriptSelector)).toHaveLength(1);
});
