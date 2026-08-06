// @vitest-environment happy-dom

import { beforeEach, expect, test, vi } from 'vitest';
import {
  loadWistiaPlayer,
  readApiHandle,
  resetWistiaPlayerLoader,
  WISTIA_PLAYER_TAG,
  type WistiaPlayerApi,
  type WistiaPlayerElement
} from '../src/loader';

type Deferred<Value> = {
  promise: Promise<Value>;
  resolve: (value: Value) => void;
  reject: (cause: unknown) => void;
};

const deferred = <Value>(): Deferred<Value> => {
  let resolve!: (value: Value) => void;
  let reject!: (cause: unknown) => void;
  const promise = new Promise<Value>((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });
  return { promise, resolve, reject };
};

// The import Wistia ships registers the element for its side effect, so every
// importer here does the same rather than resolving a module object.
const defineElement = (): void => {
  if (!customElements.get(WISTIA_PLAYER_TAG)) {
    customElements.define(WISTIA_PLAYER_TAG, class extends HTMLElement {});
  }
};

beforeEach(() => {
  resetWistiaPlayerLoader();
});

test('resolves the registration the imported bundle defines', async () => {
  const importSdk = vi.fn(async () => {
    defineElement();
  });

  const registration = await loadWistiaPlayer(importSdk);
  expect(registration).toBe(customElements.get(WISTIA_PLAYER_TAG));
  expect(importSdk).toHaveBeenCalledTimes(1);
});

test('shares a single in-flight load between concurrent calls', async () => {
  const load = deferred<void>();
  const importSdk = vi.fn(() => load.promise);

  const first = loadWistiaPlayer(importSdk);
  const second = loadWistiaPlayer(importSdk);
  defineElement();
  load.resolve();

  await expect(first).resolves.toBe(customElements.get(WISTIA_PLAYER_TAG));
  await expect(second).resolves.toBe(customElements.get(WISTIA_PLAYER_TAG));
  expect(importSdk).toHaveBeenCalledTimes(1);
});

test('reuses the resolved registration for sequential calls', async () => {
  const importSdk = vi.fn(async () => {
    defineElement();
  });

  await loadWistiaPlayer(importSdk);
  await loadWistiaPlayer(importSdk);
  expect(importSdk).toHaveBeenCalledTimes(1);
});

test('resolves without importing again when the element is already defined', async () => {
  defineElement();
  const importSdk = vi.fn(async () => undefined);

  await expect(loadWistiaPlayer(importSdk)).resolves.toBe(
    customElements.get(WISTIA_PLAYER_TAG)
  );
  // The import still runs — it is the only way to know the element came from
  // Wistia — but `whenDefined` settles immediately rather than waiting for a
  // registration that has already happened.
  expect(importSdk).toHaveBeenCalledTimes(1);
});

test('clears a failed load so the next call retries the import', async () => {
  const importSdk = vi
    .fn<() => Promise<unknown>>()
    .mockRejectedValueOnce(new Error('The network dropped the SDK request.'))
    .mockImplementationOnce(async () => {
      defineElement();
    });

  await expect(loadWistiaPlayer(importSdk)).rejects.toThrow(
    'The network dropped the SDK request.'
  );
  await expect(loadWistiaPlayer(importSdk)).resolves.toBeDefined();
  expect(importSdk).toHaveBeenCalledTimes(2);
});

test('contains a synchronously throwing importer in the returned promise', async () => {
  const importSdk = vi.fn(() => {
    throw new Error('The importer exploded synchronously.');
  });

  await expect(loadWistiaPlayer(importSdk)).rejects.toThrow(
    'The importer exploded synchronously.'
  );
  await expect(
    loadWistiaPlayer(async () => {
      defineElement();
    })
  ).resolves.toBeDefined();
});

test('resetWistiaPlayerLoader clears the cached registration', async () => {
  const importSdk = vi.fn(async () => {
    defineElement();
  });

  await loadWistiaPlayer(importSdk);
  resetWistiaPlayerLoader();
  await loadWistiaPlayer(importSdk);
  expect(importSdk).toHaveBeenCalledTimes(2);
});

// --- the handle the element hands over ---

const handle = {} as WistiaPlayerApi;

test('prefers the supported handle property over the deprecated alias', () => {
  const deprecated = {} as WistiaPlayerApi;
  expect(
    readApiHandle({
      api: handle,
      wistiaApi: deprecated,
      deprecatedApiDoNotUse: deprecated
    } as WistiaPlayerElement)
  ).toBe(handle);
  expect(
    readApiHandle({
      wistiaApi: handle,
      deprecatedApiDoNotUse: deprecated
    } as WistiaPlayerElement)
  ).toBe(handle);
  expect(
    readApiHandle({ deprecatedApiDoNotUse: handle } as WistiaPlayerElement)
  ).toBe(handle);
});

test('reads no handle from an element whose player was removed', () => {
  expect(
    readApiHandle({ deprecatedApiDoNotUse: 'removed' } as WistiaPlayerElement)
  ).toBeUndefined();
  expect(readApiHandle({} as WistiaPlayerElement)).toBeUndefined();
  expect(
    readApiHandle({ deprecatedApiDoNotUse: null } as WistiaPlayerElement)
  ).toBeUndefined();
});
