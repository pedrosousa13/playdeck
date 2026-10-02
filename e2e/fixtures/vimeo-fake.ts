import type { Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';

const embedHtml = readFile(
  new URL('./vimeo-embed.html', import.meta.url),
  'utf8'
);

export const isVimeoHostname = (hostname: string): boolean =>
  /(^|\.)(vimeo\.com|vimeocdn\.com)$/i.test(hostname);

export const routeVimeo = async (
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
