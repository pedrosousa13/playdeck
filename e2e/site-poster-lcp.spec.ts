import { expect, test, type Browser, type Page } from '@playwright/test';

/**
 * `/`'s poster is its largest image and its LCP candidate. The defects
 * pinned here: the poster was undiscoverable until the `client:only` island
 * hydrated, `sizes="100vw"` overstated the stage's real width, and nothing
 * carried `fetchpriority="high"` (#611).
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
 * any script runs, which is the guarantee a `client:only` island cannot give
 * it on its own (#611).
 *
 * The site is served by the second `webServer` entry in
 * `playwright.config.ts`; see `e2e/site-quiet.spec.ts` for why the address is
 * written out rather than navigated to as a path.
 *
 * ---- why every case states its own device pixel ratio ----------------------
 *
 * A `srcset` candidate is chosen against the `sizes` width multiplied by the
 * device pixel ratio, so a viewport alone does not determine which file a
 * reader gets. A test that leaves the ratio unstated inherits it from
 * whichever device descriptor its project names in `playwright.config.ts`,
 * and those descriptors disagree: `devices['Desktop Safari']` carries
 * `deviceScaleFactor: 2` where `devices['Desktop Chrome']` and
 * `devices['Desktop Firefox']` both carry 1. An earlier version of this file
 * set only the viewport, so the same assertion meant a different thing in
 * the `webkit` project than in the other two, and passed on two engines
 * while failing on the third — for a difference that was never about the
 * engines at all.
 *
 * So each case below opens its own context and names both numbers. Two of
 * them share the 1000px viewport and expect different files, which is the
 * point rather than a contradiction: at that width the stage is 952px, which
 * needs the 960w file at one device pixel and the 1920w file at two.
 *
 * ---- demonstrated red ------------------------------------------------------
 *
 * Measured on chromium, 2026-09-12. Four mutations, because no single one
 * reddens every case: three of the assertions below hold for reasons a
 * revert of this fix does not touch.
 *
 * Reverting the five files this fix touched (`bench-sources.ts`,
 * `Bench.astro`, `BenchIsland.tsx`, `Base.astro`, `index.astro`) to their
 * state on `main` gives 3 failed, 4 passed:
 *
 * - "the default poster is preloaded…" — `linkMatch` is `null`; no
 *   `<link rel="preload">` exists anywhere in the served HTML.
 * - "the poster image carries fetchpriority…" — `toHaveAttribute` times out
 *   against `unexpected value "null"`; the `<img>` carries no such attribute.
 * - "at a narrow-desktop width…" — `Received string:
 *   ".../sprite-fright-hls-poster-1920w.webp"` where the 960w file is
 *   expected. This is the `sizes` defect itself.
 *
 * The other four pass reverted, each for its own reason, so each names a
 * substitute mutation instead:
 *
 * - "at a mobile width…" — 960w is the only candidate either `sizes` value
 *   picks at 375px. Substitute: drop the narrow candidate from the preload's
 *   `imagesrcset` in `index.astro`, so the preload and the island disagree.
 *   `Expected length: 1 / Received length: 2`, the array holding both the
 *   1920w the preload asked for and the 960w the island then asked for —
 *   the double fetch this whole arrangement exists to avoid.
 * - "at a mobile width on a two-pixel screen…" — same reason at DPR2 (654px
 *   is still under 960). Substitute: set `POSTER_SIZES` to
 *   `(min-width: 1009px) 1104px, 960px`, the flat form an earlier attempt at
 *   this fix used and which was rejected for exactly what this shows —
 *   `Received string: ".../sprite-fright-hls-poster-1920w.webp"`, twice the
 *   transfer on the commonest phone there is.
 * - "at the same narrow-desktop width on a two-pixel screen…" and "at
 *   1280px…" — both already expect the wide file, which a revert also
 *   produces. Substitute: halve the stated width, `POSTER_SIZES` =
 *   `calc((100vw - 3rem) / 2)`. Both then read `Received string:
 *   ".../sprite-fright-hls-poster-960w.webp"` where 1920w is expected.
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

/**
 * Loads `/` at one stated viewport and device pixel ratio, and reports both
 * what the page asked the network for and what the `<img>` settled on. The
 * pair is what distinguishes a correct `sizes` from a preload that disagrees
 * with the island: the second fetch is the defect, and only the request log
 * shows it.
 */
const measurePoster = async (
  browser: Browser,
  width: number,
  deviceScaleFactor: number
): Promise<{ variants: string[]; currentSrc: string }> => {
  const context = await browser.newContext({
    viewport: { width, height: 900 },
    deviceScaleFactor
  });
  const page = await context.newPage();

  const requests: string[] = [];
  page.on('request', (r) => requests.push(r.url()));

  await page.goto(landing);
  await expect(posterImage(page)).toBeVisible();
  await page.waitForLoadState('networkidle');

  const currentSrc = await posterImage(page).evaluate(
    (el: HTMLImageElement) => el.currentSrc
  );
  const variants = [...new Set(posterRequestUrls(requests))];

  await context.close();
  return { variants, currentSrc };
};

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

test('at a mobile width, one variant is fetched and it is the narrow file', async ({
  browser
}) => {
  // The stage is 327px wide here (100vw - 48px of `.page` gutter). The 960w
  // candidate is the smaller of the two files and already exceeds that, so
  // it is what a correctly-sized `sizes` picks.
  const { variants, currentSrc } = await measurePoster(browser, 375, 1);

  expect(variants).toHaveLength(1);
  expect(currentSrc).toContain(NARROW_POSTER);
});

test('at a mobile width on a two-pixel screen, the narrow file is still enough', async ({
  browser
}) => {
  // 327px of stage at two device pixels is a 654px target — still under the
  // 960w candidate, so the correct pick is unchanged from the case above.
  // This is the commonest real phone configuration there is, and the one an
  // over-stated `sizes` costs the most: a value that ignored the viewport
  // here would ask for 1920w and double the transfer.
  const { variants, currentSrc } = await measurePoster(browser, 375, 2);

  expect(variants).toHaveLength(1);
  expect(currentSrc).toContain(NARROW_POSTER);
});

test('at a narrow-desktop width, the corrected sizes picks the narrow file', async ({
  browser
}) => {
  /*
   * 1000px, not a round "desktop" number — chosen because it is where the
   * defect this test pins is actually observable. `.page`'s content box at
   * this viewport is 1000 - 48 = 952px, under the 960w candidate; `sizes`
   * claiming the full 1000px viewport instead crosses that candidate and
   * picks the 1920w file. Below 961px the two values agree (both still need
   * the 960w file); above 1008px the corrected box width itself exceeds
   * 960px and both need the 1920w file. 1000 sits in the one band where a
   * correct `sizes` and `100vw` disagree for today's default poster pair.
   */
  const { variants, currentSrc } = await measurePoster(browser, 1000, 1);

  expect(variants).toHaveLength(1);
  expect(currentSrc).toContain(NARROW_POSTER);
});

test('at the same narrow-desktop width on a two-pixel screen, the wide file is correct', async ({
  browser
}) => {
  /*
   * The same 952px stage as the case above, at two device pixels, is a
   * 1904px target — past the 960w candidate, so 1920w is the right answer
   * here and a `sizes` fix cannot and should not change it. Pinning both
   * halves of this pair is what stops a future reader reading the case above
   * as "1000px means the narrow file" and pinning that belief somewhere it
   * is false.
   */
  const { variants, currentSrc } = await measurePoster(browser, 1000, 2);

  expect(variants).toHaveLength(1);
  expect(currentSrc).toContain(WIDE_POSTER);
});

test('at 1280px — the width #611 measured — the fetched variant stays 1920w', async ({
  browser
}) => {
  /*
   * 1280 is the viewport the issue's own Lighthouse run measured. `.page`'s
   * content box is already at its ceiling here — `calc(72rem - 3rem)` =
   * 1104px — so a correct `sizes` and the old `100vw` bug both resolve above
   * 960 and below 1920: today's poster ladder has no candidate in between,
   * and both land on the same 1920w file. That makes 1280 the wrong width to
   * pin the `sizes` defect (the 1000px case owns that), but the right width
   * to pin that this fix does not, and should not, change what a reader on
   * this viewport downloads: re-cutting the poster ladder to add a mid-size
   * rung is out of scope for #611.
   *
   * The assertion names the exact file rather than merely "not the narrow
   * one" so that it stops passing the day a mid-size poster is added between
   * 960w and 1920w — at that point 1280px would newly have a closer
   * candidate, and a reader here should get it, which is exactly the
   * conversation a literal-file assertion forces and a looser one would
   * silently skip.
   */
  const { variants, currentSrc } = await measurePoster(browser, 1280, 1);

  expect(variants).toHaveLength(1);
  expect(currentSrc).toContain(WIDE_POSTER);
});
