import { expect, test, type Page } from '@playwright/test';

/**
 * The library comparison guide at `/guides/comparison/` (#637), which renders
 * `docs/comparison/results.md`, `features.md` and `method.md` whole, composed
 * by `src/comparison-page.mjs` into one page with one `h1`. `/` carries no
 * link to it and makes no claim about another library either way — that rule
 * is unchanged and this spec does not touch `/`.
 *
 * What is pinned here is what a screenshot cannot show: that the three
 * documents render in the order the directory holds them, that the results
 * table names Playdeck and at least one alternative, that the method's
 * fairness section is present rather than trimmed, that the re-run command
 * is on the page, and that the guides index actually links here. The feature
 * table's status icons (scope addition to #637, `src/comparison-icons.mjs`)
 * get their own tests: an icon beside the retained word in a known cell, and
 * every cell in that table carrying both rather than colour alone.
 *
 * The site is served by the second `webServer` entry in `playwright.config.ts`.
 * The storybook one owns `baseURL`, so this address is written out rather than
 * navigated to as a path.
 */
const SITE = 'http://127.0.0.1:4322';
const route = `${SITE}/guides/comparison/`;

const resultsTable = (page: Page) => page.locator('.doc table').first();
const featuresTable = (page: Page) => page.locator('table.cmp-features');

test("the route serves one h1, the guide's own title", async ({ page }) => {
  await page.goto(route);

  const heading = page.getByRole('heading', { level: 1 });
  await expect(heading).toHaveCount(1);
  await expect(heading).toHaveText('React video library comparison');
});

test('the three source documents render in the order the directory holds them', async ({
  page
}) => {
  await page.goto(route);

  // Scoped to `.doc`, the document itself: `DocRail`'s own two `h2` labels
  // ("Guides", "On this page") sit outside it and, on a wide viewport, join
  // the accessibility tree only once the rail's disclosure has hydrated open
  // — a race this assertion has no reason to depend on. Sliced to the first
  // three, because `remark-gfm`'s own footnote section is itself a real `h2`
  // ("Footnotes") appended after `method.md`'s content, which is correct and
  // not one of the three documents this test is ordering.
  const sections = await page
    .locator('.doc')
    .getByRole('heading', { level: 2 })
    .allTextContents();
  expect(sections.slice(0, 3)).toEqual([
    'React video library comparison: measured figures',
    'React video library comparison: features',
    'Comparing Playdeck against other React video libraries: method'
  ]);
});

test('the results table names Playdeck and at least one other library', async ({
  page
}) => {
  await page.goto(route);

  const rows = resultsTable(page).locator('tbody tr');
  await expect(rows.filter({ hasText: 'Playdeck' }).first()).toBeVisible();
  await expect(rows.filter({ hasText: 'react-player' })).toBeVisible();
});

test('the fairness section renders in full', async ({ page }) => {
  await page.goto(route);

  await expect(
    page.getByRole('heading', {
      name: 'Where each alternative measures smaller, or wins on something else',
      exact: true
    })
  ).toBeVisible();
  // Both halves of the features half of the same argument, named in the issue
  // brief by name: neither is cut on the way onto this page.
  await expect(
    page.getByRole('heading', {
      name: 'Where each alternative has something Playdeck does not',
      exact: true
    })
  ).toBeVisible();
  await expect(
    page.getByRole('heading', {
      name: 'Where Playdeck has something no alternative does',
      exact: true
    })
  ).toBeVisible();
});

test('the re-run command is on the page', async ({ page }) => {
  await page.goto(route);

  await expect(
    page.locator('pre', { hasText: 'pnpm compare:libraries' })
  ).toBeVisible();
});

test('the guides index links to the comparison guide', async ({ page }) => {
  await page.goto(`${SITE}/guides/`);

  const link = page.getByRole('link', {
    name: 'React video library comparison',
    exact: true
  });
  await expect(link).toHaveAttribute('href', '/guides/comparison/');
});

test('a known feature cell reads as an icon and the retained word', async ({
  page
}) => {
  await page.goto(route);

  // The features table's first row, `Captions / text tracks`, and its
  // Playdeck column — `docs/comparison/features.md` reads `yes[^1]` there.
  const row = featuresTable(page).locator('tbody tr').first();
  await expect(row.locator('td').first()).toHaveText('Captions / text tracks');

  const cell = row.locator('.cmp-status').first();
  await expect(cell).toHaveAttribute('data-status', 'yes');
  await expect(cell.locator('svg[aria-hidden="true"]')).toHaveCount(1);
  await expect(cell.locator('.cmp-status__word')).toHaveText('yes');
  await expect(cell.locator('.cmp-status__word')).toBeVisible();
});

test('no cell in the features table relies on colour alone', async ({
  page
}) => {
  await page.goto(route);

  const statuses = await featuresTable(page)
    .locator('.cmp-status')
    .evaluateAll((elements) =>
      elements.map((element) => ({
        status: element.getAttribute('data-status'),
        icon: element.querySelector('svg[aria-hidden="true"]') !== null,
        word:
          element.querySelector('.cmp-status__word')?.textContent?.trim() ?? ''
      }))
    );

  expect(statuses.length).toBeGreaterThan(0);
  for (const entry of statuses) {
    expect(['yes', 'partial', 'plugin', 'no', 'n/a']).toContain(entry.status);
    expect(entry.icon, `${entry.status}: icon`).toBe(true);
    expect(entry.word, `${entry.status}: word`).toBe(entry.status);
  }
});
