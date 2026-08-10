import { expect, test, type Page } from '@playwright/test';
import { playButton } from './locators';

// Under `storybook dev`, Vite's dependency optimizer serves hls.js from its
// deps cache (e.g. /node_modules/.cache/storybook/<version>/<hash>/sb-vite/deps/hls__js.js),
// not the production build's content-hashed /assets/hls-*.js chunk name.
const hlsLibraryChunk = /\/deps\/hls__js\.js$/;

const recordRequests = (page: Page): string[] => {
  const requests: string[] = [];
  page.on('request', (request) => {
    requests.push(new URL(request.url()).pathname);
  });
  return requests;
};

const playToCompletion = async (page: Page): Promise<void> => {
  await playButton(page).click();
  await expect(playButton(page)).toHaveAttribute('data-state', 'playing');

  await expect(playButton(page)).toHaveAttribute('data-state', 'ended');
};

test('plays the local hls fixture to completion with the hls.js engine', async ({
  browserName,
  page
}) => {
  test.skip(browserName !== 'chromium', 'The hls.js flow runs on Chromium.');

  const requests = recordRequests(page);
  await page.goto(
    '/iframe.html?id=fixtures-playerfixture--hls-hls-js&viewMode=story'
  );

  await expect(page.getByTestId('hls-engine')).toHaveText('hls.js');
  await playToCompletion(page);

  expect(requests).toContain('/hls/master.m3u8');
  expect(requests.some((path) => hlsLibraryChunk.test(path))).toBe(true);
});

test('plays the local hls fixture natively without downloading hls.js', async ({
  browserName,
  page
}) => {
  // No CI job runs this any more: CI is Linux-only by decision, and this skip
  // requires darwin, so it is green-by-skip everywhere on CI. It runs only for
  // someone working on a Mac. Kept because it is the only executable record of
  // the native-HLS path, and a deleted test would hide the gap rather than
  // mark it — see the comment above `storybook` in `.github/workflows/ci.yml`.
  test.skip(
    browserName !== 'webkit' || process.platform !== 'darwin',
    'Native HLS requires WebKit on macOS; Linux WebKit lacks native HLS.'
  );

  const requests = recordRequests(page);
  await page.goto(
    '/iframe.html?id=fixtures-playerfixture--hls-native&viewMode=story'
  );

  await expect(page.getByTestId('hls-engine')).toHaveText('native');
  await playToCompletion(page);

  expect(requests).toContain('/hls/master.m3u8');
  expect(requests.some((path) => hlsLibraryChunk.test(path))).toBe(false);
});

test('surfaces a clear unsupported error for an impossible forced hls engine', async ({
  browserName,
  page
}) => {
  test.skip(
    browserName !== 'firefox',
    'Firefox deterministically lacks native HLS, making the forced native engine impossible.'
  );

  await page.goto(
    '/iframe.html?id=fixtures-playerfixture--hls-native&viewMode=story'
  );

  await expect(page.getByTestId('error-category')).toHaveText('unsupported');
  await expect(page.getByTestId('hls-engine')).toHaveText('none');
});
