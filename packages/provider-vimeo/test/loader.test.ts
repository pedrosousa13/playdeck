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

// What one evaluation of the fake SDK module observed and did.
type Evaluation = {
  // The guard as `initAppendVideoMetadata` found it.
  readonly guard: unknown;
  // Whether that installed the `window.location.href` `message` listener.
  readonly listenerInstalled: boolean;
};

// An importer that evaluates the way the real module does. `@vimeo/player`'s
// module scope calls `initAppendVideoMetadata()` (`dist/player.js:2827`), which
// returns early on a truthy guard and otherwise WRITES the guard `true` and
// then installs the listener (`:993-1016`).
//
// That write is the whole reason this fake exists. Without it every load leaves
// the guard exactly as Playdeck left it, so a suppression check that reads the
// global after the load looks correct here and is a no-op in a browser, where
// the SDK has made every outcome truthy. A double that diverges in the one
// behaviour under test is not a double (#333).
const fakeSdkImport = (): {
  readonly importSdk: () => Promise<VimeoSdkModule>;
  readonly evaluations: Evaluation[];
} => {
  const evaluations: Evaluation[] = [];
  return {
    evaluations,
    importSdk: async () => {
      const globals = window as unknown as Record<string, unknown>;
      const listenerInstalled = !globals.VimeoSeoMetadataAppended;
      evaluations.push({ guard: seoGuard(), listenerInstalled });
      if (listenerInstalled) globals.VimeoSeoMetadataAppended = true;
      return { default: fakeConstructor() };
    }
  };
};

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

// --- the seo-metadata guard ---
//
// Asserted at module evaluation rather than after the load, because after the
// load there is nothing left to see: the SDK writes the guard `true` on its way
// to installing the listener, so every one of these cases ends up truthy. What
// Playdeck did or refused to do is only observable in the instant before the
// import, which is where `evaluations` looks.

test('sets the SDK seo-metadata guard before the import runs', async () => {
  const { evaluations, importSdk } = fakeSdkImport();

  await loadVimeoSdk(importSdk, { suppressSeoMetadata: true });

  expect(evaluations).toEqual([{ guard: true, listenerInstalled: false }]);
});

test('writes nothing to the seo-metadata guard when suppression is off', async () => {
  const first = fakeSdkImport();
  await loadVimeoSdk(first.importSdk);
  expect(first.evaluations).toEqual([
    { guard: 'unset', listenerInstalled: true }
  ]);

  resetVimeoSdkLoader();
  delete window.VimeoSeoMetadataAppended;
  const second = fakeSdkImport();
  await loadVimeoSdk(second.importSdk, { suppressSeoMetadata: false });
  expect(second.evaluations).toEqual([
    { guard: 'unset', listenerInstalled: true }
  ]);
});

test('leaves a seo-metadata guard the page already set, in either direction', async () => {
  const pinnedFalse = fakeSdkImport();
  window.VimeoSeoMetadataAppended = false;
  await loadVimeoSdk(pinnedFalse.importSdk, { suppressSeoMetadata: true });
  // Untouched by Playdeck, so the SDK found the `false` the page set and
  // installed its listener — the observable proof nothing overwrote it.
  expect(pinnedFalse.evaluations).toEqual([
    { guard: false, listenerInstalled: true }
  ]);

  resetVimeoSdkLoader();
  const pinnedTrue = fakeSdkImport();
  window.VimeoSeoMetadataAppended = true;
  await loadVimeoSdk(pinnedTrue.importSdk, { suppressSeoMetadata: true });
  expect(pinnedTrue.evaluations).toEqual([
    { guard: true, listenerInstalled: false }
  ]);
});

// --- what a caller is told about its own request (#333) ---
//
// The predicate reports the page's outcome, not this call's mechanism, so both
// ways a request goes nowhere answer the same. Every case below asserts it
// against `listenerInstalled` from the same load: the listener is the thing
// that actually sends `window.location.href`, so "suppressed" can only mean
// "no listener", and tying the two together is what stops the predicate
// drifting into reporting something easier to compute than the truth.

test('answers nothing before any load has decided', () => {
  expect(isSeoMetadataSuppressed()).toBeUndefined();
});

test('reports suppression once a load has applied it', async () => {
  const { evaluations, importSdk } = fakeSdkImport();

  await loadVimeoSdk(importSdk, { suppressSeoMetadata: true });

  expect(evaluations[0]?.listenerInstalled).toBe(false);
  expect(isSeoMetadataSuppressed()).toBe(true);
});

test('reports no suppression after a load that did not ask for it', async () => {
  const { evaluations, importSdk } = fakeSdkImport();

  await loadVimeoSdk(importSdk);

  expect(evaluations[0]?.listenerInstalled).toBe(true);
  expect(isSeoMetadataSuppressed()).toBe(false);
});

// The SDK's own write is what makes this case the trap. The first load leaves
// the guard `true` with the listener live, so a predicate that read the global
// here would answer "suppressed" for a page that is sending its url.
test('reports no suppression for a request that arrived at the cached SDK', async () => {
  const { evaluations, importSdk } = fakeSdkImport();

  await loadVimeoSdk(importSdk);
  await loadVimeoSdk(importSdk, { suppressSeoMetadata: true });

  expect(evaluations).toHaveLength(1);
  expect(evaluations[0]?.listenerInstalled).toBe(true);
  expect(seoGuard()).toBe(true);
  expect(isSeoMetadataSuppressed()).toBe(false);
});

test('reports suppression for a request the earlier load already honoured', async () => {
  const { evaluations, importSdk } = fakeSdkImport();

  await loadVimeoSdk(importSdk, { suppressSeoMetadata: true });
  await loadVimeoSdk(importSdk, { suppressSeoMetadata: true });

  expect(evaluations[0]?.listenerInstalled).toBe(false);
  expect(isSeoMetadataSuppressed()).toBe(true);
});

test('reports no suppression when the page pinned the guard to false', async () => {
  const { evaluations, importSdk } = fakeSdkImport();

  window.VimeoSeoMetadataAppended = false;
  await loadVimeoSdk(importSdk, { suppressSeoMetadata: true });

  expect(evaluations[0]?.listenerInstalled).toBe(true);
  // The SDK overwrote the page's `false` on its way in. A live read would call
  // this suppressed; the recorded answer does not.
  expect(seoGuard()).toBe(true);
  expect(isSeoMetadataSuppressed()).toBe(false);
});

// Truthy, not `=== true`: `initAppendVideoMetadata` returns early on any truthy
// value, so a page that set the guard to one has suppression in effect.
test('reports suppression for a truthy guard the page set itself', async () => {
  const { evaluations, importSdk } = fakeSdkImport();

  (window as unknown as Record<string, unknown>).VimeoSeoMetadataAppended = 1;
  await loadVimeoSdk(importSdk, { suppressSeoMetadata: true });

  expect(evaluations[0]?.listenerInstalled).toBe(false);
  expect(isSeoMetadataSuppressed()).toBe(true);
});

test('answers nothing when the only load rejected', async () => {
  const importSdk = vi
    .fn<() => Promise<VimeoSdkModule>>()
    .mockRejectedValue(new Error('The network dropped the SDK request.'));

  await expect(
    loadVimeoSdk(importSdk, { suppressSeoMetadata: true })
  ).rejects.toThrow('The network dropped the SDK request.');

  expect(isSeoMetadataSuppressed()).toBeUndefined();
});

// A retry after a failure re-imports, and its evaluation is the one that
// decided. The guard Playdeck wrote before the failed attempt is still there,
// so the retry finds it truthy and suppression holds.
test('answers from the retry that succeeded after a failed load', async () => {
  const retry = fakeSdkImport();
  const importSdk = vi
    .fn<() => Promise<VimeoSdkModule>>()
    .mockRejectedValueOnce(new Error('The network dropped the SDK request.'))
    .mockImplementationOnce(retry.importSdk);

  await expect(
    loadVimeoSdk(importSdk, { suppressSeoMetadata: true })
  ).rejects.toThrow('The network dropped the SDK request.');
  expect(isSeoMetadataSuppressed()).toBeUndefined();

  await loadVimeoSdk(importSdk, { suppressSeoMetadata: true });

  expect(retry.evaluations[0]?.listenerInstalled).toBe(false);
  expect(isSeoMetadataSuppressed()).toBe(true);
});

test('resetVimeoSdkLoader clears the recorded suppression answer', async () => {
  const { importSdk } = fakeSdkImport();

  await loadVimeoSdk(importSdk, { suppressSeoMetadata: true });
  expect(isSeoMetadataSuppressed()).toBe(true);

  resetVimeoSdkLoader();
  expect(isSeoMetadataSuppressed()).toBeUndefined();
});

test('resetVimeoSdkLoader clears the cached SDK', async () => {
  const importSdk = vi.fn(async () => ({ default: fakeConstructor() }));

  await loadVimeoSdk(importSdk);
  resetVimeoSdkLoader();
  await loadVimeoSdk(importSdk);
  expect(importSdk).toHaveBeenCalledTimes(2);
});
