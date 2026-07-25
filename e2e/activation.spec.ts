import {
  expect,
  test,
  type Locator,
  type Page,
  type Request
} from '@playwright/test';
import { readFile } from 'node:fs/promises';

const providerOrigin = 'https://provider.invalid';
const tracerUrl = `${providerOrigin}/tracer.mp4`;
const sourceAUrl = `${providerOrigin}/source-a.mp4`;
const sourceBUrl = `${providerOrigin}/source-b.mp4`;
const tracerBytes = readFile(
  new URL('../apps/storybook/public/tracer.mp4', import.meta.url)
);

type RecordedRequest = {
  fulfilled: boolean;
  readonly request: Request;
};

const routeProviderMedia = async (
  page: Page,
  beforeFulfill?: Promise<void>
): Promise<RecordedRequest[]> => {
  const requests: RecordedRequest[] = [];
  const body = await tracerBytes;
  await page.route(`${providerOrigin}/**`, async (route) => {
    const request = route.request();
    const recordedRequest = { fulfilled: false, request };
    requests.push(recordedRequest);
    await beforeFulfill;
    await route.fulfill({
      body,
      contentType: 'video/mp4',
      status: 200
    });
    recordedRequest.fulfilled = true;
  });
  return requests;
};

const armClickTimestamp = async (
  button: Locator,
  key: string
): Promise<void> => {
  await button.evaluate((element, datasetKey) => {
    document.documentElement.dataset[datasetKey] = '';
    element.addEventListener(
      'click',
      () => {
        document.documentElement.dataset[datasetKey] = String(
          performance.timeOrigin + performance.now()
        );
      },
      { capture: true, once: true }
    );
  }, key);
};

const readTimestamp = async (page: Page, key: string): Promise<number> =>
  page
    .locator('html')
    .evaluate(
      (element, datasetKey) =>
        Number((element as HTMLElement).dataset[datasetKey]),
      key
    );

const expectRequestsAfter = async (
  page: Page,
  requests: RecordedRequest[],
  clickTime: number,
  expectedUrls: readonly string[]
): Promise<void> => {
  await expect
    .poll(() => requests.every(({ fulfilled }) => fulfilled))
    .toBe(true);
  expect(requests.length).toBeGreaterThan(0);
  expect(
    requests.every(({ request }) => expectedUrls.includes(request.url()))
  ).toBe(true);
  await expect
    .poll(() =>
      page.evaluate(
        (urls) =>
          performance
            .getEntriesByType('resource')
            .filter(({ name }) => urls.includes(name)).length,
        expectedUrls
      )
    )
    .toBeGreaterThan(0);
  const resourceTimings = await page.evaluate(
    (urls) =>
      performance
        .getEntriesByType('resource')
        .filter(({ name }) => urls.includes(name))
        .map(({ name, startTime }) => ({
          startTime: performance.timeOrigin + startTime,
          url: name
        })),
    expectedUrls
  );
  const requestTimings = requests
    .map(({ request }) => ({
      startTime: request.timing().startTime,
      url: request.url()
    }))
    .filter(({ startTime }) => startTime > 0);
  expect(
    [...resourceTimings, ...requestTimings].every(
      ({ startTime }) => startTime >= clickTime
    ),
    JSON.stringify({
      clickTime,
      requestTimings,
      resourceTimings
    })
  ).toBe(true);
};

const countRequests = (requests: RecordedRequest[], url: string): number =>
  requests.filter(({ request }) => request.url() === url).length;

const requestsFor = (
  requests: RecordedRequest[],
  url: string
): RecordedRequest[] => requests.filter(({ request }) => request.url() === url);

test('interaction activation makes no provider request before click', async ({
  page
}) => {
  const providerRequests = await routeProviderMedia(page);

  await page.goto(
    '/iframe.html?id=fixtures-playerfixture--interaction-external&viewMode=story'
  );
  const activationButton = page.getByRole('button', {
    name: 'Play video',
    exact: true
  });
  await expect(activationButton).toBeVisible();
  await expect(page.getByTestId('viewport')).toBeVisible();
  await armClickTimestamp(activationButton, 'activationClick');
  expect(providerRequests).toEqual([]);

  await activationButton.click();

  await expect.poll(() => providerRequests.length).toBeGreaterThan(0);
  const clickTime = await readTimestamp(page, 'activationClick');
  await expectRequestsAfter(page, providerRequests, clickTime, [tracerUrl]);
});

test('interaction source change stays dormant until a second click', async ({
  page
}) => {
  const providerRequests = await routeProviderMedia(page);

  await page.goto(
    '/iframe.html?id=fixtures-playerfixture--interaction-source-change-muted&viewMode=story'
  );
  const activationButton = page.getByRole('button', {
    name: 'Play video',
    exact: true
  });
  await expect(activationButton).toBeVisible();
  await armClickTimestamp(activationButton, 'sourceAClick');
  expect(providerRequests).toEqual([]);

  await activationButton.click();

  await expect
    .poll(() => countRequests(providerRequests, sourceAUrl))
    .toBeGreaterThan(0);
  const sourceAClick = await readTimestamp(page, 'sourceAClick');
  await expectRequestsAfter(page, providerRequests, sourceAClick, [sourceAUrl]);
  await expect(activationButton).toBeHidden();

  await page
    .getByRole('button', { name: 'Switch to source B', exact: true })
    .click();

  await expect(activationButton).toBeVisible();
  await expect(activationButton).toHaveAttribute('data-state', 'dormant');
  expect(requestsFor(providerRequests, sourceBUrl)).toHaveLength(0);
  await armClickTimestamp(activationButton, 'sourceBClick');

  await activationButton.click();

  await expect
    .poll(() => countRequests(providerRequests, sourceBUrl))
    .toBeGreaterThan(0);
  const sourceBClick = await readTimestamp(page, 'sourceBClick');
  const sourceBRequests = requestsFor(providerRequests, sourceBUrl);
  await expectRequestsAfter(page, sourceBRequests, sourceBClick, [sourceBUrl]);
});

test('interaction preload=none plays from the activation click', async ({
  page
}) => {
  let releaseMediaResponse = () => {};
  const playStarted = new Promise<void>((resolve) => {
    releaseMediaResponse = resolve;
  });
  const providerRequests = await routeProviderMedia(page, playStarted);

  await page.goto(
    '/iframe.html?id=fixtures-playerfixture--interaction-preload-none-external-muted&viewMode=story'
  );
  const activationButton = page.getByRole('button', {
    name: 'Play video',
    exact: true
  });
  const documentElement = page.locator('html');
  await expect(activationButton).toBeVisible();
  await expect(page.getByLabel('Reely media', { exact: true })).toHaveCount(0);
  await documentElement.evaluate((element) => {
    element.dataset.mediaPlayCount = '0';
    element.dataset.mediaPlayTime = '';
    document.addEventListener(
      'play',
      (event) => {
        if (!(event.target instanceof HTMLMediaElement)) return;
        element.dataset.mediaPlayCount = String(
          Number(element.dataset.mediaPlayCount) + 1
        );
        element.dataset.mediaPlayTime = String(
          performance.timeOrigin + performance.now()
        );
      },
      { capture: true }
    );
  });
  await armClickTimestamp(activationButton, 'preloadNoneClick');
  expect(providerRequests).toEqual([]);

  await activationButton.click();

  await expect.poll(() => providerRequests.length).toBeGreaterThan(0);
  const media = page.getByLabel('Reely media', { exact: true });
  await expect(media).toHaveAttribute('preload', 'none');
  await expect(media).toHaveJSProperty('muted', true);
  try {
    await expect(media).toHaveJSProperty('paused', false);
  } finally {
    releaseMediaResponse();
  }
  await expect(documentElement).toHaveAttribute(
    'data-media-play-count',
    /^[1-9]\d*$/
  );
  const clickTime = await readTimestamp(page, 'preloadNoneClick');
  const playTime = await readTimestamp(page, 'mediaPlayTime');
  await expectRequestsAfter(page, providerRequests, clickTime, [tracerUrl]);
  expect(playTime).toBeGreaterThanOrEqual(clickTime);
});
