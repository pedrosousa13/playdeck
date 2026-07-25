import { expect, test, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';

type CapabilityValue = {
  readonly status: string;
  readonly reason?: string;
};

declare global {
  interface Window {
    reelyHandle?: {
      getState: () => {
        activation: string;
        capabilities: Record<string, CapabilityValue>;
        captionRendering: string;
        textTracks: ReadonlyArray<{
          id: string;
          label: string;
          language: string | null;
          kind: string;
          readiness: string;
        }>;
      };
      selectTextTrack: (track: string | null) => Promise<{ ok: boolean }>;
    };
  }
}

const embedHtml = readFile(
  new URL('./fixtures/vimeo-embed.html', import.meta.url),
  'utf8'
);

const isVimeoHostname = (hostname: string): boolean =>
  /(^|\.)(vimeo\.com|vimeocdn\.com)$/i.test(hostname);

const routeVimeo = async (
  page: Page,
  accountType = 'pro'
): Promise<string[]> => {
  const requests: string[] = [];
  const body = await embedHtml;
  await page.route(/vimeo/i, async (route) => {
    const url = new URL(route.request().url());
    if (!isVimeoHostname(url.hostname)) {
      await route.fallback();
      return;
    }
    requests.push(route.request().url());
    if (url.hostname === 'vimeo.com' && url.pathname === '/api/oembed.json') {
      await route.fulfill({
        body: JSON.stringify({ account_type: accountType }),
        contentType: 'application/json',
        headers: { 'access-control-allow-origin': '*' },
        status: 200
      });
      return;
    }
    if (
      url.hostname === 'player.vimeo.com' &&
      url.pathname.startsWith('/video/')
    ) {
      await route.fulfill({ body, contentType: 'text/html', status: 200 });
      return;
    }
    await route.fulfill({ status: 204, body: '' });
  });
  return requests;
};

const customControls = (page: Page): Promise<CapabilityValue | undefined> =>
  page.evaluate(
    () => window.reelyHandle?.getState().capabilities.customControls
  );

test('interaction loading contacts no Vimeo domain before one click plays', async ({
  page
}) => {
  const requests = await routeVimeo(page);
  await page.goto(
    '/iframe.html?id=fixtures-playerfixture--vimeo-interaction&viewMode=story'
  );
  const activation = page.getByRole('button', { name: 'Play video' });
  await activation.waitFor();
  expect(requests, 'no Vimeo request may start before activation').toEqual([]);

  await activation.click();
  const iframe = page.locator('[data-reely-part="media"] iframe');
  await expect(iframe).toHaveAttribute(
    'src',
    /^https:\/\/player\.vimeo\.com\/video\/76979871\?/
  );
  const src = (await iframe.getAttribute('src')) ?? '';
  expect(src).toContain('controls=0');
  expect(src).toContain('dnt=1');

  await expect(page.getByRole('button', { name: 'Pause' })).toBeVisible();
  expect(requests.length).toBeGreaterThan(0);
  await expect
    .poll(() => customControls(page))
    .toEqual({
      status: 'available'
    });
});

test('viewport loading mounts the Vimeo embed without interaction', async ({
  page
}) => {
  await routeVimeo(page);
  await page.goto(
    '/iframe.html?id=fixtures-playerfixture--vimeo-viewport&viewMode=story'
  );
  const iframe = page.locator('[data-reely-part="media"] iframe');
  await expect(iframe).toHaveAttribute(
    'src',
    /^https:\/\/player\.vimeo\.com\/video\/76979871\?/
  );
  await expect
    .poll(() => page.evaluate(() => window.reelyHandle?.getState().activation))
    .toBe('ready');
});

test('unlisted embeds carry the privacy hash end to end', async ({ page }) => {
  const requests = await routeVimeo(page);
  await page.goto(
    '/iframe.html?id=fixtures-playerfixture--vimeo-unlisted-interaction&viewMode=story'
  );
  await page.getByRole('button', { name: 'Play video' }).click();

  const iframe = page.locator('[data-reely-part="media"] iframe');
  await expect(iframe).toHaveAttribute('src', /h=abc123hash/);
  await expect(page.getByRole('button', { name: 'Pause' })).toBeVisible();
  const oembedRequest = requests.find((url) =>
    url.startsWith('https://vimeo.com/api/oembed.json')
  );
  expect(oembedRequest).toContain(
    encodeURIComponent('https://vimeo.com/76979871/abc123hash')
  );
});

test('plan-gated chromeless controls report provider-plan', async ({
  page
}) => {
  await routeVimeo(page, 'basic');
  await page.goto(
    '/iframe.html?id=fixtures-playerfixture--vimeo-interaction&viewMode=story'
  );
  await page.getByRole('button', { name: 'Play video' }).click();
  await expect(page.getByRole('button', { name: 'Pause' })).toBeVisible();
  await expect
    .poll(() => customControls(page))
    .toEqual({
      status: 'unavailable',
      reason: 'provider-plan'
    });
});

test('caption tracks discovered from the embed are selectable', async ({
  page
}) => {
  await routeVimeo(page);
  await page.goto(
    '/iframe.html?id=fixtures-playerfixture--vimeo-interaction&viewMode=story'
  );
  await page.getByRole('button', { name: 'Play video' }).click();
  await expect(page.getByRole('button', { name: 'Pause' })).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(
        () => window.reelyHandle?.getState().capabilities.selectTextTrack
      )
    )
    .toEqual({ status: 'available' });
  // Vimeo hands its cues over rather than drawing them (the track is enabled
  // with `showing: false`), so Reely owns rendering and reports `custom`.
  // Tracks are addressed by their normalized id.
  const state = await page.evaluate(() => window.reelyHandle?.getState());
  expect(state?.captionRendering).toBe('custom');
  expect(state?.textTracks).toEqual([
    {
      id: 'vimeo:en',
      label: 'English',
      language: 'en',
      kind: 'subtitles',
      readiness: 'loaded'
    }
  ]);
  const result = await page.evaluate(() =>
    window.reelyHandle?.selectTextTrack('vimeo:en')
  );
  expect(result).toEqual({ ok: true });
});
