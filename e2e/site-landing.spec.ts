import { expect, test, type Page } from '@playwright/test';
import { activationButton } from './locators';

/**
 * The landing page at `/`, rebuilt for #542.
 *
 * What this file pins is the set of decisions the page cannot be allowed to
 * quietly lose: the spine and its order, the one heading a deploy check
 * identifies this site by, the absence of the workbench, the install line's
 * behaviour with and without a script, the sentence that discloses what loads
 * on scroll, the page not going sideways on a phone, and the hero staying
 * dormant.
 *
 * The look is deliberately not pinned. A landing page is meant to be redesigned
 * and a spec full of measurements would fail on every redesign for reasons that
 * are not defects — so what is asserted here is what the page *says* and what
 * it *does*, never how large or how far apart any of it is. The two exceptions
 * are the 320px overflow check, which is a defect rather than a taste, and the
 * dormancy of the hero, which is the page's central claim.
 *
 * `site-stance.spec.ts` covers the entry motion, `site-ledger.spec.ts` the
 * hero's capability panel, `site-receipt.spec.ts` the request log and
 * `site-provider-truth.spec.ts` the provider comparison. Nothing here repeats
 * any of them.
 *
 * The site is served by the second `webServer` entry in `playwright.config.ts`.
 * The storybook one owns `baseURL`, so this address is written out rather than
 * navigated to as a path.
 */
const landing = 'http://127.0.0.1:4322/';

/**
 * The spine, top to bottom, as the sections' own `data-section` attributes.
 * Written out rather than read from the page, because a list derived from the
 * page's source would agree with the page whatever either of them said.
 *
 * Seven of these are the spine #542 settled. `receipt` is the eighth and is
 * placed deliberately: a receipt is what you read after a transaction, so it
 * follows the hero a reader may have pressed and the archetypes that just
 * disclosed what they fetched.
 */
const sections = [
  'hero',
  'weight',
  'archetypes',
  'receipt',
  'composition',
  'truth',
  'states',
  'start'
];

const copyButton = (page: Page) => page.locator('[data-install-copy]').first();

test('the sections are present, in order', async ({ page }) => {
  await page.goto(landing);

  await expect
    .poll(() =>
      page
        .locator('main [data-section]')
        .evaluateAll((elements) =>
          elements.map((element) => element.getAttribute('data-section'))
        )
    )
    .toEqual(sections);
});

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

test('nothing on the page links to the workbench', async ({ page }) => {
  await page.goto(landing);
  // #534 records that the workbench is not a public surface, and the
  // maintainer ruled the same on a Storybook link. It is absent from the page
  // and from the header above it, so this is asserted over the whole document
  // rather than over `main`.
  await expect(page.locator('a[href*="storybook" i]')).toHaveCount(0);

  // And neither word is written anywhere in the rendered document. Read out of
  // the page rather than through `getByText`, whose substring matching is what
  // this repository's own eslint rule forbids for locating anything — here the
  // question really is "does this string appear at all", which is a text
  // question rather than a locator one.
  expect(
    await page.evaluate(() => document.body.innerText.toLowerCase())
  ).not.toMatch(/storybook|workbench/);
});

test.describe('with no JavaScript', () => {
  test.use({ javaScriptEnabled: false });

  test('the install command is selectable text and the copy button is absent', async ({
    page
  }) => {
    await page.goto(landing);

    // The command was never behind the button: it is text in the document, so
    // a reader with no script selects and copies it exactly as before. Both
    // copies of it — the hero's and the closing section's — say the same
    // thing, because the page renders one string twice.
    const commands = page.locator('[data-install-command]');
    await expect.poll(() => commands.count()).toBeGreaterThan(0);
    for (const text of await commands.allTextContents()) {
      expect(text.trim()).toBe('pnpm add @playdeck/react');
    }
    await expect(commands.first()).toBeVisible();

    // And there is nothing to press — at either of the two install lines.
    // Writing to the clipboard is the whole of what the button does, so a
    // control that swallowed a click would be the "present and disabled" shape
    // this site argues against; the pattern `DocsSearch.astro` already uses.
    const buttons = page.locator('[data-install-copy]');
    await expect(buttons).toHaveCount(await commands.count());
    for (const button of await buttons.all()) {
      await expect(button).toBeHidden();
    }
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

  await expect(copyButton(page)).toBeVisible();
  await expect(copyButton(page)).toHaveText('Copy');

  await copyButton(page).click();

  // A text swap, and not an icon that animates: `DESIGN.md` puts the site's
  // animation count at two and neither of them is this.
  await expect(copyButton(page)).toHaveText('Copied');
  // The same words said once where assistive technology will hear them — a
  // button whose own name changes under a reader who already pressed it is
  // announced by nothing.
  await expect(page.locator('[data-install-status]').first()).toContainText(
    'pnpm add @playdeck/react'
  );

  // And it settles back, so a reader who returns to the page later finds a
  // control that says what it will do rather than what it did.
  await expect(copyButton(page)).toHaveText('Copy', { timeout: 5000 });
});

test('the scroll-loading disclosure is visible copy', async ({ page }) => {
  await page.goto(landing);

  // A sceptic who opens devtools and finds requests the page never mentioned
  // has caught the site doing the exact thing it claims not to do. The two
  // archetypes are mounted on scroll, so the page says so — in the document,
  // visible, not in a comment.
  const disclosure = page.locator('.disclosure');
  await expect(disclosure).toBeVisible();
  await expect(disclosure).toContainText('when you scroll to them');
  await expect(disclosure).toContainText('until you press it');
});

test('the page does not go sideways at 320px', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 720 });
  await page.goto(landing);
  await expect(page.locator('main [data-section]')).toHaveCount(
    sections.length
  );

  // Everything wider than a phone on this page — the budget table, the
  // provider comparison, the printed example — scrolls inside a box of its
  // own. Scrolled to the foot first, so the two archetypes have mounted and
  // are measured rather than skipped: they are the elements most likely to
  // push the page out, and they do not exist until a reader reaches them.
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await expect
    .poll(() => page.locator('[data-playdeck-part="viewport"]').count())
    .toBeGreaterThan(1);

  await expect
    .poll(() =>
      page.evaluate(() => {
        const root = document.documentElement;
        return root.scrollWidth - root.clientWidth;
      })
    )
    .toBeLessThanOrEqual(0);
});

test('the hero is dormant: no media request before the press', async ({
  page
}) => {
  const media: string[] = [];
  page.on('request', (request) => {
    if (/\.(mp4|webm|m3u8|ogv|mpd|ts)(\?|$)/.test(request.url())) {
      media.push(request.url());
    }
  });

  await page.goto(landing);
  // The island is `client:only`, so its arrival is what makes the emptiness of
  // the list below evidence rather than a listener attached before anything
  // could have happened.
  await expect(activationButton(page).first()).toBeVisible();
  await page.waitForLoadState('networkidle');

  // `loading="interaction"` holds the root dormant: no clip, no provider, no
  // request. This is the page's most falsifiable claim and the reason the hero
  // may not be given a poster or a preloading directive.
  expect(media).toEqual([]);

  await activationButton(page).first().click();

  // And the press is what fetches it, which is the other half of the same
  // claim — an empty list from a page that never loads anything would prove
  // nothing.
  await expect.poll(() => media.length).toBeGreaterThan(0);
});
