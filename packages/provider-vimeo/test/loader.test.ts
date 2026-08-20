// @vitest-environment happy-dom

import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import {
  isSeoMetadataSuppressed,
  loadVimeoSdk,
  resetVimeoSdkLoader,
  type VimeoSdkConstructor,
  type VimeoSdkModule
} from '../src/loader';

declare global {
  interface Window {
    VimeoSeoMetadataAppended?: boolean;
  }
}

const seoGuard = (): unknown =>
  'VimeoSeoMetadataAppended' in window
    ? window.VimeoSeoMetadataAppended
    : 'unset';

const fakeConstructor = (): VimeoSdkConstructor =>
  class {} as unknown as VimeoSdkConstructor;

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

beforeEach(() => {
  resetVimeoSdkLoader();
});

afterEach(() => {
  delete window.VimeoSeoMetadataAppended;
});

test('shares a single in-flight SDK load between concurrent calls', async () => {
  const load = deferred<VimeoSdkModule>();
  const importSdk = vi.fn(() => load.promise);
  const Sdk = fakeConstructor();

  const first = loadVimeoSdk(importSdk);
  const second = loadVimeoSdk(importSdk);
  load.resolve({ default: Sdk });

  await expect(first).resolves.toBe(Sdk);
  await expect(second).resolves.toBe(Sdk);
  expect(importSdk).toHaveBeenCalledTimes(1);
});

test('reuses the resolved SDK for sequential calls', async () => {
  const Sdk = fakeConstructor();
  const importSdk = vi.fn(async () => ({ default: Sdk }));

  await expect(loadVimeoSdk(importSdk)).resolves.toBe(Sdk);
  await expect(loadVimeoSdk(importSdk)).resolves.toBe(Sdk);
  expect(importSdk).toHaveBeenCalledTimes(1);
});

test('clears a failed load so the next call retries the import', async () => {
  const Sdk = fakeConstructor();
  const importSdk = vi
    .fn<() => Promise<VimeoSdkModule>>()
    .mockRejectedValueOnce(new Error('The network dropped the SDK request.'))
    .mockResolvedValueOnce({ default: Sdk });

  await expect(loadVimeoSdk(importSdk)).rejects.toThrow(
    'The network dropped the SDK request.'
  );
  await expect(loadVimeoSdk(importSdk)).resolves.toBe(Sdk);
  expect(importSdk).toHaveBeenCalledTimes(2);
});

test('contains a synchronously throwing importer in the returned promise', async () => {
  const importSdk = vi.fn(() => {
    throw new Error('The importer exploded synchronously.');
  });

  await expect(loadVimeoSdk(importSdk)).rejects.toThrow(
    'The importer exploded synchronously.'
  );
  await expect(
    loadVimeoSdk(async () => ({ default: fakeConstructor() }))
  ).resolves.toBeDefined();
});

test('sets the SDK seo-metadata guard before the import runs', async () => {
  const seenDuringImport: unknown[] = [];
  const importSdk = vi.fn(async () => {
    seenDuringImport.push(seoGuard());
    return { default: fakeConstructor() };
  });

  await loadVimeoSdk(importSdk, { suppressSeoMetadata: true });

  expect(seenDuringImport).toEqual([true]);
});

test('writes nothing to the seo-metadata guard when suppression is off', async () => {
  const importSdk = vi.fn(async () => ({ default: fakeConstructor() }));

  await loadVimeoSdk(importSdk);
  expect(seoGuard()).toBe('unset');

  resetVimeoSdkLoader();
  await loadVimeoSdk(importSdk, { suppressSeoMetadata: false });
  expect(seoGuard()).toBe('unset');
});

test('leaves a seo-metadata guard the page already set, in either direction', async () => {
  const importSdk = vi.fn(async () => ({ default: fakeConstructor() }));

  window.VimeoSeoMetadataAppended = false;
  await loadVimeoSdk(importSdk, { suppressSeoMetadata: true });
  expect(seoGuard()).toBe(false);

  resetVimeoSdkLoader();
  window.VimeoSeoMetadataAppended = true;
  await loadVimeoSdk(importSdk, { suppressSeoMetadata: true });
  expect(seoGuard()).toBe(true);
});

// What a caller asks after a load to find out whether its request took (#333).
// The predicate reports the page's outcome, not this call's mechanism, so the
// two ways a request goes nowhere — a module already imported, and a guard the
// page already owns — answer the same.

test('reports suppression once a load has applied it', async () => {
  const importSdk = vi.fn(async () => ({ default: fakeConstructor() }));

  expect(isSeoMetadataSuppressed()).toBe(false);
  await loadVimeoSdk(importSdk, { suppressSeoMetadata: true });
  expect(isSeoMetadataSuppressed()).toBe(true);
});

test('reports no suppression after a load that did not ask for it', async () => {
  const importSdk = vi.fn(async () => ({ default: fakeConstructor() }));

  await loadVimeoSdk(importSdk);
  expect(isSeoMetadataSuppressed()).toBe(false);
});

test('reports no suppression for a request that arrived at the cached SDK', async () => {
  const importSdk = vi.fn(async () => ({ default: fakeConstructor() }));

  await loadVimeoSdk(importSdk);
  await loadVimeoSdk(importSdk, { suppressSeoMetadata: true });

  expect(importSdk).toHaveBeenCalledTimes(1);
  expect(isSeoMetadataSuppressed()).toBe(false);
});

test('reports suppression for a request the earlier load already honoured', async () => {
  const importSdk = vi.fn(async () => ({ default: fakeConstructor() }));

  await loadVimeoSdk(importSdk, { suppressSeoMetadata: true });
  await loadVimeoSdk(importSdk, { suppressSeoMetadata: true });

  expect(isSeoMetadataSuppressed()).toBe(true);
});

test('reports no suppression when the page pinned the guard to false', async () => {
  const importSdk = vi.fn(async () => ({ default: fakeConstructor() }));

  window.VimeoSeoMetadataAppended = false;
  await loadVimeoSdk(importSdk, { suppressSeoMetadata: true });

  expect(isSeoMetadataSuppressed()).toBe(false);
});

// Truthy, not `=== true`: `initAppendVideoMetadata` returns early on any truthy
// value, so a page that set the guard to one has suppression in effect.
test('reports suppression for a truthy guard the page set itself', async () => {
  const importSdk = vi.fn(async () => ({ default: fakeConstructor() }));

  (window as unknown as Record<string, unknown>).VimeoSeoMetadataAppended = 1;
  await loadVimeoSdk(importSdk, { suppressSeoMetadata: true });

  expect(isSeoMetadataSuppressed()).toBe(true);
});

test('resetVimeoSdkLoader clears the cached SDK', async () => {
  const importSdk = vi.fn(async () => ({ default: fakeConstructor() }));

  await loadVimeoSdk(importSdk);
  resetVimeoSdkLoader();
  await loadVimeoSdk(importSdk);
  expect(importSdk).toHaveBeenCalledTimes(2);
});
