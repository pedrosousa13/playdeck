import { expect, test, type Page } from '@playwright/test';

/**
 * The site navigation in the shared header (#542).
 *
 * The links to the site's own sections used to sit at the foot of `/` and
 * nowhere else, which is the one place a reader who has just finished a README
 * will not look. They are in `SiteHeader.astro` now, so they are on every page.
 *
 * What is pinned here is the part of that a screenshot cannot see: that the
 * three destinations exist on both kinds of page, that following one lands on a
 * real document rather than on a 404, that the section the reader is in is the
 * only one marked, and that three more names in a strip that already holds a
 * trail, search and a switch do not push a 320px page sideways.
 *
 * The workbench is deliberately absent and asserted absent: #534 records that it
 * is not a public surface, and it is the link most likely to be added back by
 * someone who reads this header as a list of everything the repo builds.
 *
 * The site is served by the second `webServer` entry in `playwright.config.ts`.
 * The storybook one owns `baseURL`, so these addresses are written out rather
 * than navigated to as paths.
 */
const SITE = 'http://127.0.0.1:4322';

/** The landing page, and a document page — the two page shapes the site has. */
const landing = `${SITE}/`;
const document_ = `${SITE}/reference/`;

/**
 * The destinations, in the order the header prints them, with the section each
 * one is the entrance to. Written out rather than read from the component: a
 * list derived from the header's own source would agree with the header
 * whatever either of them said.
 */
const destinations = [
  { label: 'Reference', href: `${SITE}/reference/` },
  { label: 'Providers', href: `${SITE}/providers/` },
  { label: 'Archetypes', href: `${SITE}/archetypes/` }
];

/** The header's navigation landmark, by the name it announces itself with. */
const nav = (page: Page) =>
  page.getByRole('navigation', { name: 'Site', exact: true });

/** What a 320px reader would have to scroll sideways to read. */
const overflow = (page: Page) =>
  page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth
  }));

for (const [where, url] of [
  ['/', landing],
  ['a document page', document_]
] as const) {
  test(`the navigation carries the three destinations on ${where}`, async ({
    page
  }) => {
    await page.goto(url);

    const links = nav(page).getByRole('link');
    await expect(links).toHaveText(destinations.map(({ label }) => label));
    for (const { label, href } of destinations) {
      await expect(
        nav(page).getByRole('link', { name: label, exact: true })
      ).toHaveAttribute('href', new URL(href).pathname);
    }
  });

  test(`the header on ${where} does not link to the workbench`, async ({
    page
  }) => {
    await page.goto(url);

    // Scoped to the header rather than to the page: whether `/` itself keeps a
    // link to the workbench is that page's decision and its own tests', and
    // `scripts/check-deploy-artifact.mjs` follows the one it has. What is
    // settled here is the strip that appears on every page — three site
    // destinations, and not a fourth pointing at a surface #534 says is not
    // public.
    const header = page.locator('header');
    await expect(header.locator('a[href*="storybook" i]')).toHaveCount(0);
    await expect(header.locator('a[href*="workbench" i]')).toHaveCount(0);
    // And by what the links say, not only by where they point: a link reading
    // "Workbench" that resolved through some other path is the same addition.
    await expect(
      header.locator('a').filter({ hasText: /storybook|workbench/i })
    ).toHaveCount(0);
  });

  test(`the header does not overflow 320px on ${where}`, async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 640 });
    await page.goto(url);

    await expect(nav(page)).toBeVisible();
    const measured = await overflow(page);
    expect(measured.scrollWidth).toBeLessThanOrEqual(measured.clientWidth);
  });
}

test('every destination resolves to a real page', async ({ page }) => {
  // Followed rather than merely listed: a nav full of 404s is the failure that
  // matters most here, and it is invisible from the page holding the links.
  for (const { label, href } of destinations) {
    const response = await page.goto(href);
    expect(response?.status(), `${label} → ${href}`).toBe(200);
    // A document, not an error page the server happened to answer 200 with.
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    // And the destination is reachable from the page it landed on, so the
    // navigation is present on the pages it points at as well.
    await expect(nav(page).getByRole('link')).toHaveCount(destinations.length);
  }
});

test('aria-current marks the section the reader is in, and only that one', async ({
  page
}) => {
  await page.goto(document_);
  await expect(nav(page).locator('a[aria-current="page"]')).toHaveText([
    'Reference'
  ]);

  // A page inside the section, not only its index: the marker says which
  // section, so it holds a level down.
  await page.goto(`${SITE}/reference/core/`);
  await expect(nav(page).locator('a[aria-current="page"]')).toHaveText([
    'Reference'
  ]);

  await page.goto(`${SITE}/providers/`);
  await expect(nav(page).locator('a[aria-current="page"]')).toHaveText([
    'Providers'
  ]);

  await page.goto(`${SITE}/archetypes/`);
  await expect(nav(page).locator('a[aria-current="page"]')).toHaveText([
    'Archetypes'
  ]);

  // `/` is in none of the three sections, so nothing in the strip claims to be
  // the page the reader is on.
  await page.goto(landing);
  await expect(nav(page).locator('a[aria-current="page"]')).toHaveCount(0);
});

test("/'s heading is still exactly Playdeck, and there is one of it", async ({
  page
}) => {
  // `scripts/check-deploy-artifact.mjs` identifies the site's root document in
  // a browser by a heading named exactly `Playdeck`. A second element answering
  // to that role and name — a wordmark promoted to a heading in the header, say
  // — would make that identification ambiguous without failing anything else.
  await page.goto(landing);

  const wordmark = page.getByRole('heading', { name: 'Playdeck', exact: true });
  await expect(wordmark).toHaveCount(1);
  await expect(wordmark).toBeVisible();
  expect(await wordmark.evaluate((element) => element.tagName)).toBe('H1');
});
