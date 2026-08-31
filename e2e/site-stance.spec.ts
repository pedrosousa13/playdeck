import { expect, test, type Locator, type Page } from '@playwright/test';

/**
 * The site's two page treatments, and the entry motion one of them permits.
 *
 * A marketing page and a reference document have different jobs, so `Base.astro`
 * takes a `stance`: `argument` for `/`, `document` for every other route. The
 * stance is written to the `<body>` as `data-stance`, which is what the entry
 * motion's CSS is keyed off — so a document page cannot grow scattered reveals
 * by accident, and that is the property `a document-stance page animates
 * nothing` pins.
 *
 * The two tests that run with the motion suppressed — the one under
 * `with no JavaScript` and the one under `prefers-reduced-motion: reduce` — are
 * the ones a reviewer checks first, and they are about what happens when the
 * motion does *not* run. The animated elements rest visible: the observer
 * applies the from-state and then releases it, so a reader whose script never
 * arrives — or who asked for reduced motion — reads the page rather than a
 * blank column. Both failure modes are checked by measuring the elements
 * themselves rather than by trusting the absence of a class.
 *
 * The site is served by the second `webServer` entry in `playwright.config.ts`.
 * The storybook one owns `baseURL`, so these addresses are written out rather
 * than navigated to as paths.
 */
const landing = 'http://127.0.0.1:4322/';
const document_ = 'http://127.0.0.1:4322/reference/';

// The entry-motion targets on `/`: the three columns of the three-state
// comparison, which is the one moment below the hero that takes any motion at
// all. Located by the classes the page already carries.
const targets = (page: Page) => page.locator('.truths .truth-card');

// What a reader actually sees, rather than what a class list says. `opacity`
// and `transform` are the only two properties this system animates, so a
// target that is readable and settled is one whose opacity is 1 and whose
// transform is the identity.
const settled = async (locator: Locator) =>
  locator.evaluateAll((elements) =>
    elements.map((element) => {
      const styles = getComputedStyle(element);
      return { opacity: styles.opacity, transform: styles.transform };
    })
  );

test('/ is served in the argument stance', async ({ page }) => {
  await page.goto(landing);
  await expect(page.locator('body')).toHaveAttribute('data-stance', 'argument');
});

test.describe('with no JavaScript', () => {
  test.use({ javaScriptEnabled: false });

  test('the entry-motion targets on / are visible', async ({ page }) => {
    await page.goto(landing);

    // The stance is written by the template, so it survives a page with no
    // script at all — and the targets are the markup's own, visible because
    // nothing has hidden them. The observer is what applies the from-state,
    // so a script that never runs leaves the resting state on screen.
    await expect(page.locator('body')).toHaveAttribute(
      'data-stance',
      'argument'
    );
    await expect(targets(page)).toHaveCount(3);
    await expect(page.locator('[data-enter]')).toHaveCount(0);
    expect(await settled(targets(page))).toEqual([
      { opacity: '1', transform: 'none' },
      { opacity: '1', transform: 'none' },
      { opacity: '1', transform: 'none' }
    ]);
  });
});

test.describe('under prefers-reduced-motion: reduce', () => {
  test('the targets are visible, and nothing sits mid-transition', async ({
    page
  }) => {
    // `page.emulateMedia` rather than the `reducedMotion` context option:
    // measured on Playwright 1.61, `test.use({ reducedMotion: 'reduce' })`
    // leaves `matchMedia('(prefers-reduced-motion: reduce)')` reporting false
    // in the page, which would make this test pass while proving nothing. This
    // call is checked below by asserting the query the site's own script asks.
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto(landing);
    expect(
      await page.evaluate(
        () => matchMedia('(prefers-reduced-motion: reduce)').matches
      )
    ).toBe(true);
    await expect(targets(page)).toHaveCount(3);

    // The observer is never constructed, so the from-state is never applied to
    // anything. Nothing here relies on the site-wide duration collapse: an
    // element that was never given the from-state cannot be caught part-way
    // through leaving it.
    await targets(page).first().scrollIntoViewIfNeeded();
    await expect(page.locator('[data-enter]')).toHaveCount(0);
    expect(await settled(targets(page))).toEqual([
      { opacity: '1', transform: 'none' },
      { opacity: '1', transform: 'none' },
      { opacity: '1', transform: 'none' }
    ]);
  });
});

test('the motion runs on / and settles on the resting state', async ({
  page
}) => {
  // A short viewport, set before navigation, so the truth cards are reliably
  // below the fold on arrival regardless of how tall the hero happens to be
  // at the default 1280x720: the split hero (#542 phase 3) is deliberately
  // compact enough to fit close to one screen, which on a taller default
  // viewport could otherwise leave the first target already in view before
  // the observer ever runs. What is being proved is that the vocabulary
  // fires on arrival and releases on scroll, not any particular hero height.
  await page.setViewportSize({ width: 800, height: 420 });
  await page.goto(landing);
  await expect(targets(page)).toHaveCount(3);

  // The targets sit below the hero, so they are outside the viewport on
  // arrival and still carry the from-state the observer gave them. That is the
  // evidence that the vocabulary is applied at all rather than being a class
  // nothing reads.
  await expect(page.locator('.truths .truth-card[data-enter]')).toHaveCount(3);

  // Each of them, rather than the first alone. They are a column inside the
  // capability section's body rather than a row of three (#542 phase 4), so
  // they no longer all cross the fold together on a 420px-tall viewport, and
  // scrolling only the first in would leave the last still waiting for its own
  // observer — which is the vocabulary working, not failing.
  for (const target of await targets(page).all()) {
    await target.scrollIntoViewIfNeeded();
  }

  // And it is released when they enter. `data-enter` is removed rather than
  // rewritten, so the resting state is the one the CSS gives the element.
  await expect(page.locator('[data-enter]')).toHaveCount(0);
  await expect
    .poll(() => settled(targets(page)))
    .toEqual([
      { opacity: '1', transform: 'none' },
      { opacity: '1', transform: 'none' },
      { opacity: '1', transform: 'none' }
    ]);
});

test('a document-stance page animates nothing', async ({ page }) => {
  await page.goto(document_);

  await expect(page.locator('body')).toHaveAttribute('data-stance', 'document');
  // No target, no from-state, and nothing on the page mid-travel: the entry
  // motion is keyed off the argument stance, so a document page could not
  // reveal anything even if a class were pasted onto it.
  await expect(page.locator('.u-enter')).toHaveCount(0);
  await expect(page.locator('[data-enter]')).toHaveCount(0);
  expect(await settled(page.locator('main *'))).not.toContainEqual(
    expect.objectContaining({ opacity: '0' })
  );
});
