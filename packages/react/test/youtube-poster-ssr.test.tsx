// @vitest-environment node
//
// No DOM at all, deliberately: `renderToString` needs none of it, and the
// whole claim under test -- that a YouTube poster can be put in front of a
// `loading="interaction"` root before a provider ever attaches, including on
// the server -- is false the moment rendering it needs a `window`. Every
// other `renderToString` call in this package's tests runs under
// `happy-dom` (`activation.test.tsx`, `index.test.tsx`, `captions.test.tsx`);
// this file is the one that proves the server case for real rather than
// alongside a DOM that happens not to be touched.
//
// `@playdeck/provider-youtube` is mocked the way `activation.test.tsx` mocks
// `../src/provider-loaders`: `resolveYouTubePosterUrl` passes through to the
// real implementation (it is the function under integration test here), and
// `createYouTubeProvider` is wrapped so a call to it is recorded rather than
// attempted -- attempting it would throw outright under this environment
// (`loader.ts` requires `window`/`document`), which would make "never
// called" indistinguishable from "called and crashed silently".

import { renderToString } from 'react-dom/server';
import { afterEach, expect, test, vi } from 'vitest';
import * as Player from '../src/index';

const mockedCreateYouTubeProvider = vi.hoisted(() => vi.fn());

vi.mock('@playdeck/provider-youtube', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@playdeck/provider-youtube')>()),
  createYouTubeProvider: mockedCreateYouTubeProvider
}));

const fetchSpy = vi.fn();

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

test('resolveYouTubePosterUrl feeds a loading="interaction" root with no DOM and no request', async () => {
  const { resolveYouTubePosterUrl } =
    await import('@playdeck/provider-youtube');
  vi.stubGlobal('fetch', fetchSpy);

  const source = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ';
  const poster = resolveYouTubePosterUrl(source);
  expect(poster).toBe('https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg');

  const markup = renderToString(
    <Player.Root
      loading="interaction"
      poster={poster ?? undefined}
      source={source}
    >
      <Player.Viewport>
        <Player.Poster />
        <Player.Media />
        <Player.ActivationButton aria-label="Play video" />
      </Player.Viewport>
    </Player.Root>
  );

  // The resolved still rendered as the poster image's src -- proof this ran
  // through `Player.Root`'s own default-poster wiring (`poster.tsx`'s
  // `DefaultPosterContext`), not just that the helper returned a string.
  expect(markup).toContain(
    'src="https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg"'
  );
  expect(markup).toContain('data-playdeck-part="poster-image"');
  expect(markup).toContain('data-playdeck-part="activation"');
  // Dormant: no media element and no embed frame in the server markup.
  expect(markup).not.toContain('<video');
  expect(markup).not.toContain('<iframe');

  // `renderToString` runs no effect, so this is really asserting that
  // nothing synchronous in `Root`'s render path reaches either -- but it is
  // the fact the issue's acceptance criteria ask for, stated as an assertion
  // rather than inferred from "no effects run".
  expect(fetchSpy).not.toHaveBeenCalled();
  expect(mockedCreateYouTubeProvider).not.toHaveBeenCalled();
});
