import { expect, test, type Page } from '@playwright/test';

/**
 * `/`'s poster is its largest image and its LCP candidate (#611). Three
 * defects, pinned here: the poster was undiscoverable until the `client:only`
 * island hydrated, `sizes="100vw"` overstated the stage's real width, and
 * nothing carried `fetchpriority="high"`.
 *
 * The fix is a `<link rel="preload" as="image">` in the document head, kept
 * in step with what the island and the `<noscript>` fallback actually use —
 * `apps/site/src/bench-sources.ts`'s `POSTER_SIZES` and `defaultBenchSource`
 * are the one place both the preload and the two rendered images read from,
 * so a disagreement between them is a defect in that file rather than
 * something three call sites could drift on independently.
 *
 * The first test parses the served document directly, with no browser
 * involved, because a browser measurement only proves the island's own
 * behaviour after hydration — the preload scanner reads the document before
 * any script runs, and that is the thing #611 says was missing.
 *
 * The site is served by the second `webServer` entry in
 * `playwright.config.ts`; see `e2e/site-quiet.spec.ts` for why the address is
 * written out rather than navigated to as a path.
 */
const landing = 'http://127.0.0.1:4322/';

const posterImage = (page: Page) =>
  page.locator('[data-playdeck-part="poster-image"]');

// The two files `bench-sources.ts` ships for the switch's default position,
// `hls` — see that file's own comment for why it is first and therefore the
// resting default `readySources[0]`/`benchSources.find(ready)` both resolve
// to.
const NARROW_POSTER = '/sprite-fright-hls-poster-960w.webp';
const WIDE_POSTER = '/sprite-fright-hls-poster-1920w.webp';

const posterRequestUrls = (requests: readonly string[]): string[] =>
  requests.filter(
    (url) => url.includes(NARROW_POSTER) || url.includes(WIDE_POSTER)
  );

test('the default poster is preloaded from the served HTML, before any script runs', async ({
  request
}) => {
  const response = await request.get(landing);
  const html = await response.text();

  // Not server-rendered: the island stays `client:only`, so the real poster
  // `<img>` is absent from the document a browser without JavaScript (or the
  // preload scanner, which runs before the island's script has parsed) ever
  // sees.
  expect(html).not.toContain('data-playdeck-part="poster-image"');

  const linkMatch = /<link\b[^>]*rel="preload"[^>]*as="image"[^>]*>/.exec(html);
  expect(linkMatch).not.toBeNull();
  const link = linkMatch?.[0] ?? '';

  const imagesrcset = /imagesrcset="([^"]*)"/.exec(link)?.[1];
  expect(imagesrcset).toBe(`${NARROW_POSTER} 960w, ${WIDE_POSTER} 1920w`);

  const imagesizes = /imagesizes="([^"]*)"/.exec(link)?.[1];
  expect(imagesizes).toBe(
    '(min-width: 72rem) calc(72rem - 3rem), calc(100vw - 3rem)'
  );

  expect(link).toContain('fetchpriority="high"');
});

test('the poster image carries fetchpriority="high"', async ({ page }) => {
  await page.goto(landing);
  await expect(posterImage(page)).toHaveAttribute('fetchpriority', 'high');
});

test('exactly one poster variant is fetched at a mobile width, and it matches the box', async ({
  page
}) => {
  await page.setViewportSize({ width: 375, height: 800 });

  const requests: string[] = [];
  page.on('request', (r) => requests.push(r.url()));

  await page.goto(landing);
  await expect(posterImage(page)).toBeVisible();
  await page.waitForLoadState('networkidle');

  const fetched = posterRequestUrls(requests);
  expect(new Set(fetched).size).toBe(1);

  // The stage is 327px wide at this viewport (100vw - 48px of `.page`
  // gutter); the 960w candidate is the smaller of the two files and already
  // exceeds that, so it is what a correctly-sized `sizes` picks.
  expect(
    await posterImage(page).evaluate((el: HTMLImageElement) => el.currentSrc)
  ).toContain(NARROW_POSTER);
});

test('exactly one poster variant is fetched at a narrow-desktop width, and it matches the box', async ({
  page
}) => {
  /*
   * 1000px, not a round "desktop" number — chosen because it is where the
   * defect this test pins is actually observable. `.page`'s content box at
   * this viewport is 1000 - 48 = 952px, under the 960w candidate; `sizes`
   * claiming the full 1000px viewport instead crosses that candidate and
   * picks the 1920w file. Below 961px the two `sizes` values agree (both
   * still need the 960w file); above 1008px the corrected box width itself
   * exceeds 960px and both need the 1920w file. 1000 sits in the one band
   * where a correct `sizes` and `100vw` disagree for today's default poster
   * pair (960w/1920w).
   */
  await page.setViewportSize({ width: 1000, height: 800 });

  const requests: string[] = [];
  page.on('request', (r) => requests.push(r.url()));

  await page.goto(landing);
  await expect(posterImage(page)).toBeVisible();
  await page.waitForLoadState('networkidle');

  const fetched = posterRequestUrls(requests);
  expect(new Set(fetched).size).toBe(1);
  expect(
    await posterImage(page).evaluate((el: HTMLImageElement) => el.currentSrc)
  ).toContain(NARROW_POSTER);
});
