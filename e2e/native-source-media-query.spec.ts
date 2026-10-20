import { expect, test, type Page } from '@playwright/test';

// #913: a mobile rendition and a desktop rendition picked by `media` on each
// `VideoFileSource.sources` entry, staged by
// `apps/storybook/stories/player-fixture.stories.tsx`'s `NativeSourceMediaQuery`
// (`source: 'media-query'`): `tracer.mp4` tagged `(max-width: 600px)`,
// `tracer-10s.mp4` tagged `(min-width: 601px)`. The fixture's default
// `loading="viewport"` commits as soon as it mounts in the story's iframe --
// nothing scrolls it into view, so `IntersectionObserver` fires immediately --
// which is the client-created path this feature renders only the matching
// entry for: no browser ever has a wrong entry to pick in the first place.
const STORY =
  '/iframe.html?id=fixtures-playerfixture--native-source-media-query&viewMode=story';

const MOBILE_SOURCE = 'tracer.mp4';
const DESKTOP_SOURCE = 'tracer-10s.mp4';

const requestedPaths = async (page: Page): Promise<string[]> => {
  const urls: string[] = [];
  page.on('request', (request) => urls.push(request.url()));
  await page.goto(STORY);
  await expect
    .poll(() =>
      page.evaluate(() => window.playdeckHandle?.getState().activation)
    )
    .toBe('ready');
  return urls;
};

test('requests only the mobile rendition at a phone width', async ({
  page
}) => {
  await page.setViewportSize({ width: 375, height: 667 });
  const urls = await requestedPaths(page);

  expect(urls.some((url) => url.includes(MOBILE_SOURCE))).toBe(true);
  expect(urls.some((url) => url.includes(DESKTOP_SOURCE))).toBe(false);
});

test('requests only the desktop rendition at a desktop width', async ({
  page
}) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  const urls = await requestedPaths(page);

  expect(urls.some((url) => url.includes(DESKTOP_SOURCE))).toBe(true);
  expect(urls.some((url) => url.includes(MOBILE_SOURCE))).toBe(false);
});
