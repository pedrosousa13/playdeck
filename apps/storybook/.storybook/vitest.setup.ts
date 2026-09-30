import { userEvent } from 'vitest/browser';
import { afterEach, beforeEach, expect } from 'vitest';

// Preview annotations (decorators, a11y parameters) are applied automatically
// by @storybook/addon-vitest; this file only adds the determinism guard:
// stories must not request anything outside the test origin. Every story test
// checks three surfaces after rendering — requests initiated through fetch,
// resources that finished loading (resource timing), and external URLs
// declared in the DOM (img/src, srcset, video/src, ...), which also catches
// requests still in flight when the test ends.
//
// It also resets the real pointer -- see the `afterEach` below.
//
// `vitest/browser`, not `storybook/test`: this file is Vitest-only
// (`vitest.config.ts`'s `setupFiles`), never bundled into the Storybook
// site `pnpm --filter @playdeck/storybook build` publishes, so importing
// Vitest's own browser module here carries none of the risk it would from
// inside a `.stories.tsx` file, which that build also processes. And it has
// to be this import specifically, not the play-function `userEvent` a story
// receives from `storybook/test`: under the Playwright browser provider that
// one's `.hover()` reliably moves the pointer onto a story's own rendered
// parts (the button a play function just queried, `LiveIndicatorAppearance`'s
// `live`), but measured unreliable against a purpose-built neutral element --
// still not `:hover`-matched a full second after `await`ing it, repeatedly.
// `vitest/browser`'s own `userEvent.hover()`, called here instead of through
// Storybook's wrapper, does not have that problem.

const skippedProtocols = new Set(['data:', 'blob:', 'about:', 'javascript:']);

const externalUrl = (raw: string): string | undefined => {
  let url: URL;
  try {
    url = new URL(raw, location.href);
  } catch {
    return undefined;
  }
  if (skippedProtocols.has(url.protocol)) return undefined;
  return url.origin === location.origin ? undefined : url.href;
};

const externalUrlsInDom = (): string[] => {
  const urls: string[] = [];
  const elements = document.querySelectorAll(
    'img, source, video, audio, iframe, embed, object, script[src], link[href]'
  );
  for (const element of elements) {
    for (const attribute of ['src', 'href', 'data'] as const) {
      const value = element.getAttribute(attribute);
      if (!value) continue;
      const external = externalUrl(value);
      if (external) urls.push(external);
    }
    const srcSet = element.getAttribute('srcset');
    for (const candidate of srcSet?.split(',') ?? []) {
      const candidateUrl = candidate.trim().split(/\s+/, 1)[0];
      if (!candidateUrl) continue;
      const external = externalUrl(candidateUrl);
      if (external) urls.push(external);
    }
  }
  return urls;
};

const fetchedUrls: string[] = [];
const originalFetch = globalThis.fetch;

beforeEach(() => {
  performance.setResourceTimingBufferSize(10_000);
  performance.clearResourceTimings();
  fetchedUrls.length = 0;
  globalThis.fetch = (input, init) => {
    fetchedUrls.push(
      input instanceof Request ? input.url : new URL(input, location.href).href
    );
    return originalFetch(input, init);
  };
});

afterEach(async () => {
  globalThis.fetch = originalFetch;
  const externalRequests = [
    ...fetchedUrls,
    ...performance.getEntriesByType('resource').map((entry) => entry.name),
    ...externalUrlsInDom()
  ].filter((url) => externalUrl(url) !== undefined);
  expect(externalRequests).toEqual([]);
  // Under the Playwright browser provider `userEvent.hover()` drives the
  // real, CDP-tracked pointer, and `userEvent.unhover()` cannot move it back
  // -- it only dispatches synthetic leave events. A story that hovers a part
  // and does not explicitly move the pointer elsewhere (`live` in
  // `stories/theme.stories.tsx`'s `LiveIndicatorAppearance`, among others)
  // leaves it parked over that part's screen coordinate for whatever story
  // runs next, and a full-bleed part -- one that fills its whole story, like
  // `ActivationButton`'s `inset: 0` overlay in `stories/activation.stories.tsx`'s
  // `Styled` -- matches `:hover` at that same coordinate even though nothing
  // in *that* story hovered it. Reproduced even with no earlier hover at all,
  // from the pointer's own un-moved rest position on a fresh page.
  //
  // `document.body` (always present, always larger than the fixed-size
  // viewport these stories render) rather than a query: a query-based
  // `.hover()` retries until the query resolves, and doing that here raced
  // the next test's story mount and stalled on Playwright's ~30s action
  // timeout, repeatedly, across the suite -- tried and reverted. A direct
  // element reference has nothing to retry.
  await userEvent.hover(document.body);
});
