import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page, type Request } from '@playwright/test';

/**
 * #525: search over the documentation, from a static Pagefind index queried in
 * the browser.
 *
 * The shape of this file is unlike the rest of `e2e/`. Everything else here
 * drives `/iframe.html?id=…` on the Storybook server and asserts playdeck's own
 * behaviour; this one drives the *built site*, served as files by
 * `scripts/serve-site.mjs`, because the index only exists after the build —
 * `apps/site/package.json`'s `build` runs Astro and then Pagefind over what
 * Astro emitted. A test against `astro dev` would be a test of a site with no
 * index in it, and it would pass the parts of this file that do not search.
 *
 * ---- the two origins ---------------------------------------------------------
 *
 * Both are the same server. `/` is the shipped build, the one that goes to
 * `playdeck.video`; `/playdeck/` is a second build of the same source made with
 * `--base /playdeck/`, which is the site as a project page would serve it. Every
 * test below runs against both, because the failure this ticket names is the one
 * that only appears at a prefix: a path written as a literal is identical to a
 * derived one at the root, so a root-only test proves nothing about either. Both
 * of the ways it goes wrong are silent — a search box that finds nothing, and a
 * result list of links that 404 — so this file checks that results come back
 * *and* that following one lands on a document.
 */

/** The two builds under test, and where each is mounted. */
const BASES = ['/', '/playdeck/'] as const;

const SITE = 'http://127.0.0.1:4322';

/** A word the documentation uses throughout, so a query for it has answers. */
const QUERY = 'provider';

/**
 * Words taken from the prose of the two pages that are not documentation — the
 * landing page and the design sheet — chosen because each is a heading or a
 * table label there. They are deliberately *not* asserted to return nothing: a
 * word this site uses on its front page is a word its READMEs use too, and a
 * test that demanded an empty result list would be testing the vocabulary
 * rather than the index. What is asserted is where the answers live.
 */
const NON_DOCUMENT_QUERIES = ['budgets', 'ledger', 'gradient', 'wordmark'];

/** Open the dialog with the keyboard and type a query, then wait for a verdict. */
const search = async (page: Page, query: string) => {
  // The shortcut, not a click: the field this focuses is the one the reader is
  // then typing into, so a test that clicked would leave the whole shortcut
  // path unexercised.
  await page.keyboard.press('/');
  const input = page.getByRole('combobox');
  await expect(input).toBeFocused();
  await input.fill(query);
  // The status line is written on every verdict including the empty one, so
  // waiting for it distinguishes "no results" from "not finished yet". Without
  // it a miss and a slow index are the same observation.
  await expect(page.getByRole('status')).not.toBeEmpty();
  return input;
};

for (const base of BASES) {
  const at = base === '/' ? 'at the root' : `under ${base}`;

  test.describe(`docs search ${at}`, () => {
    test(`finds documentation and opens the highlighted result`, async ({
      page
    }) => {
      await page.goto(`${SITE}${base}reference/`);

      await search(page, QUERY);

      const options = page.getByRole('option');
      await expect(options.first()).toBeVisible();

      // Every result has to be addressed under the prefix this build was made
      // for. Pagefind records a page's path inside `dist/`, which is the site
      // root and not the served prefix, so this is the assertion that catches a
      // result list of dead links.
      for (const href of await options.evaluateAll((nodes) =>
        nodes.map((node) => node.getAttribute('href'))
      )) {
        expect(href).toMatch(new RegExp(`^${base}`));
      }

      // Enter opens the highlighted result, and the destination is a real
      // document rather than a 404 page — the other half of the prefix being
      // right. Against the highlighted option's *own* href, read off the DOM,
      // rather than against a path written here: which page Pagefind ranks
      // first for a word is a property of the corpus, so any literal
      // destination is an assertion about today's index that a page added
      // later can invalidate. `aria-selected` is the element `Command`
      // dispatches Enter at, so this is the same result the reader sees
      // highlighted.
      const highlighted = options.and(page.locator('[aria-selected="true"]'));
      const destination = `${SITE}${await highlighted.getAttribute('href')}`;
      // The destination has to differ from the page the search was run from,
      // or the wait below is satisfied by standing still: `waitForURL` is
      // checked against the current URL first, and Enter's navigation has not
      // committed by then, so a destination the page is already on would hold
      // whatever Enter opened.
      expect(destination).not.toBe(page.url());

      await page.keyboard.press('Enter');
      await page.waitForURL((url) => url.href === destination);
      await expect(page.locator('h1')).toBeVisible();
    });

    test(`makes no request off this origin while searching`, async ({
      page
    }) => {
      // The reason this ticket chose Pagefind over a hosted product. Collected
      // from `request`, which fires for every request the page initiates
      // whatever issues it — the document, the index shards, the WebAssembly,
      // and anything a dependency decided to fetch on its own.
      const seen: string[] = [];
      const record = (request: Request) => seen.push(request.url());
      page.on('request', record);

      await page.goto(`${SITE}${base}reference/core/`);
      await search(page, QUERY);
      await expect(page.getByRole('option').first()).toBeVisible();
      // A second query, so the assertion covers a warm index as well as the
      // load: a product that reported usage would have every reason to do it
      // per query rather than once.
      await page.getByRole('combobox').fill('poster');
      await expect(page.getByRole('status')).not.toBeEmpty();

      page.off('request', record);

      // An empty list of foreign requests proves nothing on its own — a
      // listener attached to the wrong page would produce exactly that — so
      // check first that the recorder saw the search actually load. The
      // Pagefind bundle is the request that only happens because a query was
      // typed.
      expect(seen).toContain(`${SITE}${base}pagefind/pagefind.js`);
      expect(seen.filter((url) => !url.startsWith(SITE))).toEqual([]);
    });

    test(`indexes the documentation and nothing else`, async ({ page }) => {
      await page.goto(`${SITE}${base}reference/`);
      const input = await search(page, NON_DOCUMENT_QUERIES[0]);

      for (const query of NON_DOCUMENT_QUERIES) {
        await input.fill(query);
        await expect(page.getByRole('status')).not.toBeEmpty();

        // The landing page is an argument and the design sheet is a token
        // specimen; neither is documentation, and both opt out through
        // `Base.astro`. A regression here is silent in the other direction from
        // most of this file — search keeps working, and starts answering
        // questions about the API with the sales copy.
        for (const href of await page
          .getByRole('option')
          .evaluateAll((nodes) =>
            nodes.map((node) => node.getAttribute('href') ?? '')
          )) {
          expect(href.split('#')[0]).not.toBe(base);
          expect(href).not.toContain(`${base}design/`);
        }
      }
    });

    test(`is operable from the keyboard alone`, async ({ page }) => {
      await page.goto(`${SITE}${base}reference/`);

      // By its data attribute rather than by role and name. Playwright's name
      // matching is a substring match — the rule in `eslint.config.js` that
      // forbids it here has caught real strict-mode failures — and the button's
      // accessible name contains the word this page is full of.
      const opener = page.locator('[data-search-open]');
      await opener.focus();

      const input = await search(page, QUERY);
      const options = page.getByRole('option');
      await expect(options.first()).toBeVisible();

      // The list is a combobox: focus stays in the field and the highlighted
      // option is named by `aria-activedescendant`, which is what a screen
      // reader follows. Assert the name resolves to an element rather than only
      // that the attribute changed — a stale id announces nothing and looks
      // identical from outside.
      const activeId = async () => input.getAttribute('aria-activedescendant');
      const first = await activeId();
      expect(first).not.toBeNull();
      await expect(page.locator(`#${first}`)).toHaveAttribute(
        'aria-selected',
        'true'
      );

      await page.keyboard.press('ArrowDown');
      const second = await activeId();
      expect(second).not.toBe(first);
      await expect(page.locator(`#${second}`)).toHaveAttribute(
        'aria-selected',
        'true'
      );
      await expect(input).toBeFocused();

      await page.keyboard.press('ArrowUp');
      expect(await activeId()).toBe(first);

      // Escape dismisses, and focus goes back to the control that opened the
      // dialog rather than to the body — the platform's own behaviour for a
      // modal `<dialog>`, which is most of why this is one.
      await page.keyboard.press('Escape');
      await expect(input).toBeHidden();
      await expect(opener).toBeFocused();
    });

    test(`has no accessibility violations with results on screen`, async ({
      page
    }) => {
      await page.goto(`${SITE}${base}reference/`);
      await search(page, QUERY);
      await expect(page.getByRole('option').first()).toBeVisible();

      // Axe's default rule set, un-narrowed — `withTags` would drop the
      // best-practice rules, which is a suppression by another name, and this
      // file follows `e2e/a11y.spec.ts` on that.
      //
      // Scoped to the search subtree, and the cost of that is the same one that
      // spec names: page-level rules do not run, so zero violations here is a
      // claim about this control and not about the page around it. That is the
      // right scope — the reference page's own accessibility is not this
      // ticket's, and a failure inherited from it would be a failure nobody
      // could act on from here.
      const { violations } = await new AxeBuilder({ page })
        .include('.search')
        .analyze();
      expect(violations).toEqual([]);
    });

    test(`draws the dialog from the theme's own tokens in both themes`, async ({
      page
    }) => {
      await page.goto(`${SITE}${base}reference/`);
      await page.locator('[data-search-open]').click();

      const dialog = page.getByRole('dialog');
      await expect(dialog).toBeVisible();

      for (const theme of ['light', 'dark'] as const) {
        await page.evaluate((value) => {
          document.documentElement.dataset.theme = value;
        }, theme);

        // Against the role token rather than against a colour written here: the
        // assertion is that the panel re-tunes with the theme, and a literal
        // would only say that today's dark surface is today's dark surface.
        const [surface, painted] = await dialog.evaluate((node) => [
          getComputedStyle(document.documentElement)
            .getPropertyValue('--color-surface')
            .trim(),
          getComputedStyle(node).backgroundColor
        ]);
        expect(painted).toBe(hexToRgb(surface));
      }
    });
  });
}

/**
 * `getComputedStyle` reports a custom property as the *served* stylesheet spells
 * it and a used `background-color` as `rgb(…)`, so the two have to be brought
 * into one spelling before they can be compared. Both hex forms are handled
 * because the minifier in the site's build shortens `#ffffff` to `#fff`, which
 * is a difference between the token file and the file a browser reads.
 */
const hexToRgb = (hex: string) => {
  const match = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex);
  if (match === null) throw new Error(`Not a hex colour: '${hex}'`);
  const digits = match[1];
  const pairs =
    digits.length === 3
      ? [...digits].map((digit) => digit + digit)
      : [digits.slice(0, 2), digits.slice(2, 4), digits.slice(4, 6)];
  const [red, green, blue] = pairs.map((pair) => parseInt(pair, 16));
  return `rgb(${red}, ${green}, ${blue})`;
};
