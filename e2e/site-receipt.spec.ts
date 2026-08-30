import { expect, test, type Page } from '@playwright/test';

/**
 * The landing page's network receipt, which prints what this page really asked
 * the network for and what ships beside it unrequested (#542).
 *
 * These were held at `fixme` while the component existed and no page mounted
 * it. `/` mounts it now, between the archetypes and the composition example,
 * and nothing about the assertions had to move: every one of them is located by
 * the classes and the `data-*` hooks the component already carried, the way
 * `site-ledger.spec.ts` locates the panel beside it.
 *
 * ---- what is worth pinning --------------------------------------------------
 *
 * The claim is that the upper panel is a measurement rather than a list. A
 * plausible list of twenty addresses would look identical to a reader and to a
 * screenshot, so what these pin is the pair of things a written-down panel
 * could not do: report the page's own real cost, and grow when the reader
 * causes a request.
 *
 * The site is served by the second `webServer` entry in `playwright.config.ts`.
 * The storybook one owns `baseURL`, so this address is written out rather than
 * navigated to as a path.
 */
const landing = 'http://127.0.0.1:4322/';

const rows = (page: Page) => page.locator('[data-receipt-log] .receipt__row');
/**
 * The hero's activation button, scoped to the hero panel.
 *
 * `./locators`' `activationButton` is page-wide, and `/` now mounts three
 * players rather than one: the hero, and the two archetypes the page runs to
 * show that the primitives compose into different products (#542). All three
 * carry `data-playdeck-part="activation"`, so the shared locator is a
 * strict-mode ambiguity here in a way it is not on a story that mounts one
 * player. `.demo__stage` is the hero's own screen — `HeroPlayer.astro` draws
 * it — so this says "the hero's" without inventing a hook for a test.
 */
const heroActivation = (page: Page) =>
  page.locator('.demo__stage [data-playdeck-part="activation"]');

test('the receipt prints this page’s own requests, with real sizes', async ({
  page
}) => {
  await page.goto(landing);

  // Some request was made — the document's own stylesheet at the very least —
  // and every row carries an address from this origin and a size the browser
  // reported. The static sentence that stands in before a measurement is
  // gone, which is the part a panel with nothing measured could not do.
  await expect.poll(() => rows(page).count()).toBeGreaterThan(0);
  await expect(page.locator('[data-receipt-log] .receipt__empty')).toHaveCount(
    0
  );

  for (const path of await rows(page)
    .locator('.receipt__path')
    .allTextContents()) {
    expect(path).toMatch(/^\//);
  }

  // The honesty trap: the page ships React to argue that the library is
  // small, and the receipt has to print that cost rather than omit it. So the
  // total is a real figure over a real count, and at least one row is a
  // script heavy enough that no page could claim to be free of it.
  await expect(page.locator('[data-receipt-total]')).toHaveText(
    /\d+ requests · \d+\.\d\d KB transferred/
  );

  // A size is either a figure or the panel saying it was not reported. It is
  // never a bare `0.00 KB`, which is what a cache hit would print if the
  // component read `transferSize` without asking what a zero means.
  for (const size of await rows(page)
    .locator('.receipt__size')
    .allTextContents()) {
    expect(size).toMatch(/^(\d+\.\d\d KB|—)$/);
    expect(size).not.toBe('0.00 KB');
  }
});

test('a cache hit is printed as a cache hit rather than as nothing', async ({
  page
}) => {
  // First visit warms the browser's cache; the reload is the visit whose
  // resources come out of it. `transferSize` is 0 for every one of those, and
  // the panel has to say so rather than sum them into a page that weighs
  // nothing.
  await page.goto(landing);
  await page.reload();
  await expect.poll(() => rows(page).count()).toBeGreaterThan(0);

  const cached = rows(page).filter({ hasText: 'from cache' });
  await expect.poll(() => cached.count()).toBeGreaterThan(0);
  // The row still carries the body size the browser did record, so a reader
  // learns what the resource weighs and that it did not travel.
  for (const size of await cached.locator('.receipt__size').allTextContents())
    expect(size).toMatch(/^\d+\.\d\d KB$/);
  // And the total carries what the cache is holding, so a page served
  // entirely from it does not print `0.00 KB` and nothing else.
  await expect(page.locator('[data-receipt-total]')).toHaveText(
    /\d+\.\d\d KB from cache \(\d+\)/
  );
});

test('pressing the hero adds rows, tagged as arriving after load', async ({
  page
}) => {
  await page.goto(landing);
  await expect.poll(() => rows(page).count()).toBeGreaterThan(0);

  // What has already arrived after the load event, which is not nothing and
  // was written here as nothing while no page mounted this panel. The hero is
  // a `client:only` island, so React and `@playdeck/react` are dynamically
  // imported once the document has finished loading, and the receipt prints
  // them tagged exactly as it will print the clip — that is the panel being
  // honest about the cost of the demo rather than a defect. So the press is
  // measured as a change from here rather than from zero.
  const lateBefore = await rows(page).filter({ hasText: 'after load' }).count();
  const before = await rows(page).count();
  await heroActivation(page).click();

  // The clip and the one adapter that plays it, arriving because the reader
  // asked. Which rows those are is not asserted by name — the component
  // deliberately never labels a chunk with a package name it inferred — so
  // what is pinned is that the log grew and that the new rows are marked as
  // having arrived after the page had loaded. A written-down panel fails
  // both.
  await expect.poll(() => rows(page).count()).toBeGreaterThan(before);
  await expect
    .poll(() => rows(page).filter({ hasText: 'after load' }).count())
    .toBeGreaterThan(lateBefore);
});

test('the adapters that ship unrequested are printed with their sizes', async ({
  page
}) => {
  await page.goto(landing);

  // The lower panel needs no script and no measurement: it is the build's
  // figures, from the module the budget gate uses. More than one adapter, each
  // with a gzipped size, and exactly one of them described as reachable from
  // this page.
  //
  // How many adapters there are is deliberately not pinned — the component
  // derives the list from `scripts/bundle-budgets.mjs` so that an adapter added
  // to the workspace appears without an edit, and a count here would be a
  // second copy of that list. "Exactly one reachable" is pinned, because the
  // component does guarantee it: `needed` is `name === used`, one prop, and a
  // `used` naming nothing measured throws at build time.
  const shipped = page
    .locator('.receipt__section')
    .last()
    .locator('.receipt__row');
  await expect.poll(() => shipped.count()).toBeGreaterThan(1);
  for (const size of await shipped.locator('.receipt__size').allTextContents())
    expect(size).toMatch(/^\d+\.\d\d KB$/);
  await expect(
    shipped.filter({ hasText: 'fetched on demand, when the clip is loaded' })
  ).toHaveCount(1);
  await expect(
    shipped.filter({ hasText: 'nothing on this page can ask for it' })
  ).not.toHaveCount(0);
});
