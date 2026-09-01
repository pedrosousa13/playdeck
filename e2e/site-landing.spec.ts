import { expect, test, type Locator, type Page } from '@playwright/test';
import { activationButton } from './locators';

/**
 * The landing page at `/`, rebuilt for #542 as one instrument rather than six
 * sections. A thesis, the player as the largest element on the page, two groups
 * of switches, what they built, and the close.
 *
 * What this file pins is the set of decisions the page cannot be allowed to
 * quietly lose: the one heading a deploy check identifies this site by, the
 * thesis and the switches being on the page at all, the absence of the
 * workbench, the install line's behaviour with and without a script, the page
 * not going sideways on a phone, the player staying dormant, and the page being
 * settled and readable with no script and under reduced motion.
 *
 * The look is deliberately not pinned. A landing page is meant to be redesigned
 * and a spec full of measurements would fail on every redesign for reasons that
 * are not defects, so what is asserted here is what the page *says* and what it
 * *does*, never how large or how far apart any of it is. The exceptions are the
 * 320px overflow check and the two degrade checks, which are defects rather
 * than taste, and the dormancy of the player, which is the page's central
 * claim.
 *
 * The previous version of this file pinned six `data-section` blocks that no
 * longer exist, and one of the two checks it is worth keeping — the overflow at
 * 320px — was preceded by a count of them, so it never reached its own
 * assertion. That is why the check below waits on an element the page actually
 * has.
 *
 * `site-quiet.spec.ts` holds the page to contacting nobody at rest,
 * `site-bench.spec.ts` covers the switches and what they build, and
 * `site-stance.spec.ts` the site-wide page treatments. Nothing here repeats
 * any of them.
 *
 * The site is served by the second `webServer` entry in `playwright.config.ts`.
 * The storybook one owns `baseURL`, so this address is written out rather than
 * navigated to as a path.
 */
const landing = 'http://127.0.0.1:4322/';

/**
 * The sentence the page argues from. Written out rather than read from the
 * page, because a string derived from the page's own source would agree with it
 * whatever either of them said — and this one is load-bearing: it counts the
 * lines the composition panel prints, and `site-bench.spec.ts` holds the panel
 * to the same number from the other side.
 */
const thesis = 'A video player you compose, not one you configure.';

/**
 * What a reader actually sees, rather than what a class list says. `opacity`
 * and `transform` are the only two properties this system animates, so an
 * element that is readable and settled is one whose opacity is 1 and whose
 * transform is the identity.
 */
const unsettled = (scope: Locator) =>
  scope.evaluateAll((elements) =>
    elements
      .map((element) => {
        const styles = getComputedStyle(element);
        return {
          tag: element.tagName.toLowerCase(),
          opacity: styles.opacity,
          transform: styles.transform
        };
      })
      .filter(
        (seen) =>
          Number(seen.opacity) !== 1 ||
          !['none', 'matrix(1, 0, 0, 1, 0, 0)'].includes(seen.transform)
      )
  );

const readable = async (page: Page) => {
  await expect(page.locator('main')).toBeVisible();
  await expect(page.getByText(thesis, { exact: true })).toBeVisible();
  await expect(page.locator('[data-install-command]').first()).toBeVisible();
  expect(await unsettled(page.locator('main, main *'))).toEqual([]);
};

test('the h1 is exactly Playdeck, and nothing else answers to that name', async ({
  page
}) => {
  await page.goto(landing);

  // `scripts/check-deploy-artifact.mjs` identifies the site's root document in
  // a browser by a heading with this exact accessible name. Two of them would
  // make that identification ambiguous, which is why the header renders no
  // wordmark on `/` — so the count matters as much as the text.
  await expect(page.locator('h1')).toHaveText('Playdeck');
  await expect(
    page.getByRole('heading', { name: 'Playdeck', exact: true })
  ).toHaveCount(1);
});

test('the thesis and both groups of switches are on the page', async ({
  page
}) => {
  await page.goto(landing);

  // The h1 names the document; this is what argues. The display rung was moved
  // onto it for that reason, which `DESIGN.md` records as a deliberate
  // amendment — so a page that lost the sentence would have lost the argument
  // while keeping the heading a build gate looks for.
  await expect(page.getByText(thesis, { exact: true })).toBeVisible();

  // The four features this page sells are delivered by operating the bench
  // rather than by reading about them, so the switches are not decoration on
  // the argument, they are how it is made. `data-bench-switch` is the contract
  // `site-bench.spec.ts` presses through.
  await expect(page.locator('[data-bench-switch="source"]')).toHaveCount(1);
  await expect(page.locator('[data-bench-switch="skin"]')).toHaveCount(1);
});

test('nothing on the page links to the workbench', async ({ page }) => {
  await page.goto(landing);
  // #534 records the decision that the workbench is not to be a public
  // surface, and the maintainer ruled the same on a Storybook link. What that
  // costs this page is every link to it, from the page and from the header
  // above it, so this is asserted over the whole document rather than over
  // `main`.
  await expect(page.locator('a[href*="storybook" i]')).toHaveCount(0);

  expect(
    await page.evaluate(() => document.body.innerText.toLowerCase())
  ).not.toMatch(/storybook|workbench/);
});

test('the word "ledger" appears nowhere', async ({ page }) => {
  // Rejected outright, along with the five-row panel and the ten-by-five grid
  // that were designed to carry the capability argument here. Asserted
  // directly because the temptation to reach for the word sits right beside
  // the one line that survived them.
  await page.goto(landing);
  expect(
    await page.evaluate(() => document.body.innerText.toLowerCase())
  ).not.toContain('ledger');
});

test.describe('with no JavaScript', () => {
  test.use({ javaScriptEnabled: false });

  test('the install command is selectable text and the copy button is absent', async ({
    page
  }) => {
    await page.goto(landing);

    // The command was never behind the button: it is text in the document, so
    // a reader with no script selects and copies it exactly as before.
    const commands = page.locator('[data-install-command]');
    await expect.poll(() => commands.count()).toBeGreaterThan(0);
    for (const text of await commands.allTextContents()) {
      expect(text.trim()).toBe('pnpm add @playdeck/react');
    }
    await expect(commands.first()).toBeVisible();

    // And there is nothing to press. Writing to the clipboard is the whole
    // of what the button does, so a control that swallowed a click would be
    // the "present and disabled" shape this site argues against.
    const buttons = page.locator('[data-install-copy]');
    await expect(buttons).toHaveCount(await commands.count());
    for (const button of await buttons.all()) {
      await expect(button).toBeHidden();
    }
  });

  test('the page is settled and readable', async ({ page }) => {
    /*
     * With JavaScript blocked the island never mounts, so what is left is the
     * static page: the thesis, the frame with the browser's own player in it,
     * the close. What is measured is computed style, not class names — an
     * element could carry every "hidden" class this site writes and still
     * compute to `opacity: 1` if the rule that reads the class needed a script
     * to apply, which is exactly the failure a class-name assertion cannot
     * catch.
     */
    await page.goto(landing);
    await readable(page);
  });
});

test('the copy button appears with a script, and its feedback is a text swap', async ({
  page,
  context,
  browserName
}) => {
  // Chromium gates `clipboard.writeText` behind a permission that a headless
  // context does not grant by default. Firefox has no such permission name and
  // rejects the grant, so it is only asked for where it exists.
  if (browserName === 'chromium') {
    await context.grantPermissions(['clipboard-write'], {
      origin: 'http://127.0.0.1:4322'
    });
  }
  await page.goto(landing);

  const copyButton = page.locator('[data-install-copy]').first();
  await expect(copyButton).toBeVisible();
  await expect(copyButton).toHaveText('Copy');

  await copyButton.click();

  await expect(copyButton).toHaveText('Copied');
  await expect(page.locator('[data-install-status]').first()).toContainText(
    'pnpm add @playdeck/react'
  );

  await expect(copyButton).toHaveText('Copy', { timeout: 5000 });
});

test.describe('under prefers-reduced-motion: reduce', () => {
  /*
   * `test.use({ reducedMotion })` does not work in this environment on
   * Playwright 1.61, so the query is emulated per test and its effect is
   * checked in-page first — `site-stance.spec.ts` has the worked example this
   * follows.
   */
  test.beforeEach(async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
  });

  test('the page is settled and readable', async ({ page }) => {
    await page.goto(landing);

    await expect
      .poll(() =>
        page.evaluate(
          () => matchMedia('(prefers-reduced-motion: reduce)').matches
        )
      )
      .toBe(true);

    // The island mounts here, unlike the no-script case above, so this covers
    // the player and the readout as well as the static page.
    await expect(page.locator('[data-bench-composition]')).toBeVisible();
    await readable(page);
  });
});

test('the page does not go sideways at 320px', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 720 });
  await page.goto(landing);

  // Waited on rather than counted: the composition panel is a block of
  // unwrappable source and the widest thing under the switches, so measuring
  // before the island has put it there would be measuring the wrong page. The
  // previous version of this test waited on a count of sections the page no
  // longer has, which meant it never reached the measurement below at all.
  await expect(page.locator('[data-bench-composition]')).toBeVisible();

  // Scrolled to the foot first, so nothing below the fold is skipped.
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));

  await expect
    .poll(() =>
      page.evaluate(() => {
        const root = document.documentElement;
        return root.scrollWidth - root.clientWidth;
      })
    )
    .toBeLessThanOrEqual(0);
});

test(
  'the player is dormant: no media request before the press @real',
  { tag: '@real' },
  async ({ page }) => {
    // A foreign-origin listener rather than a media-extension filter: with no
    // same-origin position left on the source switch, the default provider's
    // first request is a cross-origin iframe document, not a file matching
    // `.mp4`/`.webm`/`.m3u8`/etc. `site-quiet.spec.ts` defines the same
    // `foreign` filter for the same reason; it is not imported from there
    // because that file's is scoped to its own origin constant.
    const requests: string[] = [];
    page.on('request', (request) => requests.push(request.url()));

    await page.goto(landing);
    // The island is `client:only`, so its arrival is what makes the emptiness
    // of the list below evidence rather than a listener attached before
    // anything could have happened.
    await expect(activationButton(page)).toBeVisible();
    await page.waitForLoadState('networkidle');

    const origin = new URL(landing).origin;
    const foreign = () =>
      requests.filter(
        (url) =>
          !url.startsWith(`${origin}/`) &&
          !url.startsWith('data:') &&
          !url.startsWith('blob:')
      );

    // `loading="interaction"` holds the root dormant: no clip, no provider, no
    // request. This is the page's most falsifiable claim and the reason the
    // player may not be given a preloading directive.
    expect(foreign()).toEqual([]);

    await activationButton(page).click();

    // And the press is what fetches it, which is the other half of the same
    // claim — an empty list from a page that never loads anything would prove
    // nothing. Pressing play now attaches a real hosted provider, which is
    // what makes this test `@real`.
    await expect.poll(() => foreign().length).toBeGreaterThan(0);
  }
);
