// @vitest-environment happy-dom

import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import {
  loadWistiaPlayer,
  readApiHandle,
  resetWistiaPlayerLoader,
  SCRIPT_LOAD_TIMEOUT_MS,
  WISTIA_PLAYER_TAG,
  type WistiaPlayerApi,
  type WistiaPlayerElement
} from '../src/loader';

const scriptSrc = 'https://fast.wistia.com/player.js';
const scriptSelector = `script[src="${scriptSrc}"]`;

const failedMessage = 'The Wistia player script failed to load.';
// Deliberately not "did not load": a script this loader adopted rather than
// created can have fired `load` before the loader ever saw it, and there is no
// way to ask an element whether it did. This message holds either way; the one
// below is used only where the loader watched the `load` event itself.
const deadlineMessage = `The Wistia player script did not register <wistia-player> within ${SCRIPT_LOAD_TIMEOUT_MS} ms.`;
const unregisteredMessage =
  'The Wistia player bundle loaded without registering <wistia-player>.';

// A custom-element name can be registered exactly once per window and can never
// be withdrawn, and vitest gives a file one window — so a suite running against
// the real registry could assert the not-yet-registered path in exactly one
// test, and every test after it would short-circuit. The loader reads
// `customElements` off the global on each call, so swapping in a registry per
// test is what lets each one state its own world. Only the two members the
// loader uses are modelled, plus the `define` a bundle would call.
class FakeRegistry {
  readonly #defined = new Map<string, CustomElementConstructor>();
  readonly #waiting = new Map<
    string,
    Array<(value: CustomElementConstructor) => void>
  >();

  get(name: string): CustomElementConstructor | undefined {
    return this.#defined.get(name);
  }

  define(name: string, constructor: CustomElementConstructor): void {
    this.#defined.set(name, constructor);
    this.#waiting.get(name)?.forEach((resolve) => resolve(constructor));
    this.#waiting.delete(name);
  }

  whenDefined(name: string): Promise<CustomElementConstructor> {
    const defined = this.#defined.get(name);
    if (defined) return Promise.resolve(defined);
    return new Promise<CustomElementConstructor>((resolve) => {
      const waiting = this.#waiting.get(name) ?? [];
      waiting.push(resolve);
      this.#waiting.set(name, waiting);
    });
  }
}

let registry: FakeRegistry;
let injections: string[];

// What the real bundle does for its side effect, and the only thing this
// loader waits on.
const defineElement = (): CustomElementConstructor => {
  const constructor = class extends HTMLElement {};
  registry.define(WISTIA_PLAYER_TAG, constructor);
  return constructor;
};

// Stands in for the default injector: same element, same document, no network.
const injectScript = (src: string): HTMLScriptElement => {
  injections.push(src);
  const script = document.createElement('script');
  script.src = src;
  script.async = true;
  document.head.appendChild(script);
  return script;
};

const injectedScript = (): HTMLScriptElement | null =>
  document.querySelector<HTMLScriptElement>(scriptSelector);

// The deadline arrives as a rejection, so the handler is attached before the
// clock moves: a rejection left unhandled across the advance fails the run.
const messageAtDeadline = async (
  load: Promise<unknown>,
  advanceBy = SCRIPT_LOAD_TIMEOUT_MS
): Promise<string> => {
  const settled = load.then(
    () => 'the load resolved',
    (error: unknown) => (error as Error).message
  );
  await vi.advanceTimersByTimeAsync(advanceBy);
  return settled;
};

beforeEach(() => {
  resetWistiaPlayerLoader();
  registry = new FakeRegistry();
  Object.defineProperty(window, 'customElements', {
    configurable: true,
    value: registry
  });
  injections = [];
  document
    .querySelectorAll(scriptSelector)
    .forEach((script) => script.remove());
});

afterEach(() => {
  vi.useRealTimers();
  resetWistiaPlayerLoader();
});

// --- the script the loader puts in the document ---

test('injects Wistia’s own player bundle and resolves what it registers', async () => {
  const load = loadWistiaPlayer(injectScript);

  expect(injections).toEqual([scriptSrc]);
  const registered = defineElement();

  await expect(load).resolves.toBe(registered);
});

test('injects one script for two concurrent players and shares one promise', async () => {
  const first = loadWistiaPlayer(injectScript);
  const second = loadWistiaPlayer(injectScript);

  expect(second).toBe(first);
  expect(injections).toHaveLength(1);
  expect(document.querySelectorAll(scriptSelector)).toHaveLength(1);

  const registered = defineElement();

  await expect(first).resolves.toBe(registered);
  await expect(second).resolves.toBe(registered);
  expect(injections).toHaveLength(1);
});

test('reuses the resolved registration without injecting a second script', async () => {
  const load = loadWistiaPlayer(injectScript);
  const registered = defineElement();
  await load;

  await expect(loadWistiaPlayer(injectScript)).resolves.toBe(registered);
  expect(injections).toHaveLength(1);
});

test('resolves without injecting anything when the element is already registered', async () => {
  // A consumer who loaded the bundle by other means — their own script tag, a
  // bundled copy — must not have it registered a second time.
  const registered = defineElement();

  await expect(loadWistiaPlayer(injectScript)).resolves.toBe(registered);
  expect(injections).toEqual([]);
  expect(injectedScript()).toBeNull();
});

test('adopts a matching script another consumer already injected', async () => {
  const existing = document.createElement('script');
  existing.src = scriptSrc;
  document.head.appendChild(existing);

  const load = loadWistiaPlayer(injectScript);

  expect(injections).toEqual([]);
  expect(injectedScript()).toBe(existing);

  const registered = defineElement();
  await expect(load).resolves.toBe(registered);
});

// --- a load that cannot complete ---

test('rejects and removes the script it injected when that script errors', async () => {
  const load = loadWistiaPlayer(injectScript);
  injectedScript()?.dispatchEvent(new Event('error'));

  await expect(load).rejects.toThrow(failedMessage);
  expect(injectedScript()).toBeNull();
});

test('clears a failed load so the next call injects a fresh script', async () => {
  const failed = loadWistiaPlayer(injectScript);
  injectedScript()?.dispatchEvent(new Event('error'));
  await expect(failed).rejects.toThrow(failedMessage);

  const retried = loadWistiaPlayer(injectScript);
  expect(retried).not.toBe(failed);
  expect(injections).toHaveLength(2);

  const registered = defineElement();
  await expect(retried).resolves.toBe(registered);
});

test('rejects on the deadline when the script never loads at all', async () => {
  vi.useFakeTimers();

  expect(await messageAtDeadline(loadWistiaPlayer(injectScript))).toBe(
    deadlineMessage
  );
});

test('names a bundle that loaded without registering the element', async () => {
  vi.useFakeTimers();
  // A response that arrives 200 OK but is not the bundle — a captive portal, an
  // inspecting proxy, a region block, a truncated body — fires `load` and no
  // `error`, so the rejection has to come from the deadline and say which of
  // the two happened.
  const load = loadWistiaPlayer(injectScript);
  injectedScript()?.dispatchEvent(new Event('load'));

  expect(await messageAtDeadline(load)).toBe(unregisteredMessage);
});

test('starts a genuinely new attempt after the deadline rejected the last one', async () => {
  vi.useFakeTimers();

  const timedOut = loadWistiaPlayer(injectScript);
  const firstScript = injectedScript();
  expect(await messageAtDeadline(timedOut)).toBe(deadlineMessage);
  expect(injectedScript()).toBeNull();

  const retried = loadWistiaPlayer(injectScript);
  expect(retried).not.toBe(timedOut);
  const secondScript = injectedScript();
  // A count of one holds just as well when the dead element was silently
  // re-adopted, which is the state this exists to rule out.
  expect(secondScript).not.toBeNull();
  expect(secondScript).not.toBe(firstScript);

  const registered = defineElement();
  await expect(retried).resolves.toBe(registered);
});

test('puts a script another consumer already injected under the same deadline', async () => {
  vi.useFakeTimers();
  // Already failed before the loader saw it: no further `error` can fire, so
  // adopting it without a deadline would never settle.
  const existing = document.createElement('script');
  existing.src = scriptSrc;
  document.head.appendChild(existing);

  expect(await messageAtDeadline(loadWistiaPlayer(injectScript))).toBe(
    deadlineMessage
  );
  // Not this loader's node to take out of the document.
  expect(injectedScript()).toBe(existing);
});

test('a superseded attempt leaves the script the next attempt adopted in place', async () => {
  vi.useFakeTimers();

  const superseded = loadWistiaPlayer(injectScript);
  const injected = injectedScript();
  resetWistiaPlayerLoader();
  // A tick apart, so the superseded attempt's deadline lands on its own while
  // the attempt that adopted its script element is still waiting.
  await vi.advanceTimersByTimeAsync(1);
  const adopting = loadWistiaPlayer(injectScript);

  expect(await messageAtDeadline(superseded, SCRIPT_LOAD_TIMEOUT_MS - 1)).toBe(
    deadlineMessage
  );
  expect(injectedScript()).toBe(injected);

  const registered = defineElement();
  await expect(adopting).resolves.toBe(registered);
});

test('ignores a late script error once the registration resolved', async () => {
  const load = loadWistiaPlayer(injectScript);
  const registered = defineElement();
  await expect(load).resolves.toBe(registered);

  injectedScript()?.dispatchEvent(new Event('error'));

  await expect(loadWistiaPlayer(injectScript)).resolves.toBe(registered);
  expect(injectedScript()).not.toBeNull();
});

test('leaves no deadline armed once the element registers', async () => {
  vi.useFakeTimers();

  const load = loadWistiaPlayer(injectScript);
  const registered = defineElement();

  await expect(load).resolves.toBe(registered);
  expect(vi.getTimerCount()).toBe(0);
});

test('gives the script load the same backstop the handshake gets', () => {
  // Pins the number itself. That it matches this package's own
  // `API_READY_TIMEOUT_MS` — and the YouTube provider's — is a convention no
  // assertion here can enforce, so changing one is a manual re-check of the
  // others.
  expect(SCRIPT_LOAD_TIMEOUT_MS).toBe(15_000);
});

test('resetWistiaPlayerLoader drops the memo so the next load injects again', async () => {
  const first = loadWistiaPlayer(injectScript);
  const registered = defineElement();
  await first;

  resetWistiaPlayerLoader();

  const second = loadWistiaPlayer(injectScript);
  expect(second).not.toBe(first);
  await expect(second).resolves.toBe(registered);
  // The element is registered, so the fresh memo resolves off the registry
  // rather than putting a second copy of the bundle in the document.
  expect(injections).toHaveLength(1);
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
