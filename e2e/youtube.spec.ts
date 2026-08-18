import { expect, test, type Page } from '@playwright/test';
import { playButton } from './locators';

const youtubeDomains = [
  'youtube.com',
  'youtube-nocookie.com',
  'youtu.be',
  'ytimg.com',
  'googlevideo.com',
  'ggpht.com'
];

const isYouTubeUrl = (url: URL): boolean =>
  youtubeDomains.some(
    (domain) => url.hostname === domain || url.hostname.endsWith(`.${domain}`)
  );

// A deterministic stand-in for https://www.youtube.com/iframe_api. It mirrors
// the parts of the real API the adapter relies on: the window-level ready
// callback, the adoption of the iframe it is handed rather than one it builds,
// and asynchronous state confirmation.
const fakeIframeApi = `
  window.YT = {
    PlayerState: {
      UNSTARTED: -1, ENDED: 0, PLAYING: 1, PAUSED: 2, BUFFERING: 3, CUED: 5
    },
    Player: function (iframe, config) {
      let state = -1;
      const target = {};
      const events = config.events || {};
      const setState = (next) => {
        state = next;
        if (events.onStateChange) events.onStateChange({ data: next, target });
      };
      Object.assign(target, {
        playVideo: () => setTimeout(() => setState(1), 0),
        pauseVideo: () => setTimeout(() => setState(2), 0),
        seekTo: () => {},
        mute: () => {},
        unMute: () => {},
        isMuted: () => false,
        setVolume: () => {},
        getVolume: () => 100,
        getDuration: () => 120,
        getCurrentTime: () => 0,
        getPlaybackRate: () => 1,
        setPlaybackRate: () => {},
        getPlayerState: () => state,
        getIframe: () => iframe,
        destroy: () => iframe.remove()
      });
      setTimeout(() => {
        if (events.onReady) events.onReady({ target });
      }, 0);
      return target;
    }
  };
  if (window.onYouTubeIframeAPIReady) window.onYouTubeIframeAPIReady();
`;

const routeYouTube = async (page: Page): Promise<string[]> => {
  const requests: string[] = [];
  await page.route(isYouTubeUrl, async (route) => {
    const url = new URL(route.request().url());
    requests.push(url.href);
    if (url.pathname === '/iframe_api') {
      await route.fulfill({
        body: fakeIframeApi,
        contentType: 'text/javascript',
        status: 200
      });
      return;
    }
    if (url.pathname.startsWith('/embed/')) {
      await route.fulfill({
        body: '<!doctype html><title>embed</title>',
        contentType: 'text/html',
        status: 200
      });
      return;
    }
    await route.fulfill({ body: '', status: 204 });
  });
  return requests;
};

test('youtube interaction activation rejects every YouTube request before the click', async ({
  page
}) => {
  const youtubeRequests = await routeYouTube(page);

  await page.goto(
    '/iframe.html?id=fixtures-playerfixture--interaction-youtube&viewMode=story'
  );
  const activationButton = page.getByRole('button', {
    name: 'Play video',
    exact: true
  });
  await expect(activationButton).toBeVisible();
  await expect(page.getByTestId('viewport')).toBeVisible();
  expect(youtubeRequests).toEqual([]);

  await activationButton.click();

  await expect
    .poll(
      () => youtubeRequests.filter((url) => url.endsWith('/iframe_api')).length
    )
    .toBeGreaterThan(0);
  await expect
    .poll(() => youtubeRequests.filter((url) => url.includes('/embed/')))
    .toContainEqual(expect.stringContaining('youtube-nocookie.com'));
});

test('youtube one interaction click loads the provider and queues playback', async ({
  page
}) => {
  const youtubeRequests = await routeYouTube(page);

  await page.goto(
    '/iframe.html?id=fixtures-playerfixture--interaction-youtube&viewMode=story'
  );
  const activationButton = page.getByRole('button', {
    name: 'Play video',
    exact: true
  });
  await expect(activationButton).toBeVisible();
  expect(youtubeRequests).toEqual([]);

  await activationButton.click();

  const play = playButton(page);
  await expect(play).toBeVisible();
  await expect(play).toHaveAttribute('data-state', 'playing');
  await expect(activationButton).toBeHidden();
  const iframe = page.locator('[data-playdeck-part="media"] iframe');
  await expect(iframe).toHaveAttribute(
    'src',
    /^https:\/\/www\.youtube-nocookie\.com\/embed\//
  );
  await expect(iframe).toHaveAttribute(
    'referrerpolicy',
    'strict-origin-when-cross-origin'
  );
  const overlayParts = await page
    .getByTestId('viewport')
    .locator(
      '[data-playdeck-part="activation"], [data-playdeck-part="controls"]'
    )
    .count();
  expect(overlayParts).toBe(0);
});

test('youtube docs example stays dormant while the native fixture is used', async ({
  page
}) => {
  const youtubeRequests = await routeYouTube(page);

  await page.goto(
    '/iframe.html?id=fixtures-playerfixture--native-mp-4&viewMode=story'
  );
  const activationButton = page.getByRole('button', {
    name: 'Watch YouTube example',
    exact: true
  });
  await expect(activationButton).toBeVisible();
  await expect(page.getByLabel('Playdeck media', { exact: true })).toHaveCount(
    1
  );
  expect(youtubeRequests).toEqual([]);

  await activationButton.click();

  await expect
    .poll(
      () => youtubeRequests.filter((url) => url.endsWith('/iframe_api')).length
    )
    .toBeGreaterThan(0);
  await expect(
    page.getByTestId('youtube-example').locator('iframe')
  ).toBeVisible();
});
