import { expect, test, type Page } from '@playwright/test';

/**
 * The site's three theme states, and the one of them a media query alone gets
 * wrong.
 *
 * `DESIGN.md`'s _Themes_ section states the rule: tokens are assigned on
 * `:root`, reassigned under `@media (prefers-color-scheme: dark)` scoped away
 * from `[data-theme="light"]`, and reassigned again under `[data-theme="dark"]`
 * — so an explicit choice beats the operating system **in both directions**,
 * including the case a lone media query cannot express, a reader who picks
 * light on a dark machine. Nothing in the repository checked that. The rule was
 * the kind that is true when it is written, silently falsifiable by any edit to
 * the cascade in `tokens.css`, and read only by people. It is verified here
 * rather than assumed, and stays verified.
 *
 * What is asserted is the painted colour rather than the attribute, because the
 * attribute is what the switch writes and the colour is what the rule is about.
 * A `data-theme` that lands on the root while the cascade ignores it would pass
 * an attribute check and fail every reader.
 *
 * The site is served by the second `webServer` entry in `playwright.config.ts`.
 * The storybook one owns `baseURL`, so this address is written out rather than
 * navigated to as a path.
 */
const SITE = 'http://127.0.0.1:4322';

/**
 * The two fields, as a browser reports them. `--light-field` `#FAFAF8` and
 * `--dark-field` `#08080B` from `tokens.css`, which is the one file allowed to
 * hold either literal — restated here because a test that read the value from
 * the stylesheet it is checking would agree with it whatever it said.
 */
const LIGHT = 'rgb(250, 250, 248)';
const DARK = 'rgb(8, 8, 11)';

/** What the page is actually painted, at the element `base.css` paints. */
const field = (page: Page) =>
  page.evaluate(
    () => getComputedStyle(document.documentElement).backgroundColor
  );

/**
 * Choosing from the theme menu, the way a reader does.
 *
 * Both waits are load-bearing rather than defensive. Radix keeps the menu
 * mounted through its close animation and takes pointer events off the page
 * while it runs, so a second call that pressed the trigger as soon as the first
 * returned pressed a trigger nothing could reach — the press is swallowed, the
 * menu never opens, and the test that chooses twice waits on an item that will
 * not appear until it runs out of time. Waiting for the menu to appear and then
 * for it to leave means each
 * choice starts from the settled state the reader would be pressing from.
 */
const choose = async (page: Page, label: 'Light' | 'Dark' | 'System') => {
  await page.locator('[data-theme-toggle]').click();
  const item = page.getByRole('menuitemradio', { name: label, exact: true });
  await expect(item).toBeVisible();
  await item.click();
  await expect(item).toBeHidden();
};

for (const [os, unchosen] of [
  ['dark', DARK],
  ['light', LIGHT]
] as const) {
  test(`a reader who has chosen nothing follows a ${os} operating system`, async ({
    page
  }) => {
    await page.emulateMedia({ colorScheme: os });
    await page.goto(SITE);

    expect(await field(page)).toBe(unchosen);
  });
}

test('an explicit light choice beats a dark operating system', async ({
  page
}) => {
  // The direction a lone `prefers-color-scheme` block cannot express, and so
  // the one worth naming in its own test.
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.goto(SITE);
  expect(await field(page)).toBe(DARK);

  await choose(page, 'Light');
  expect(await field(page)).toBe(LIGHT);

  // And it survives the reload, applied by the pre-paint script rather than by
  // the island — which is the half of the mechanism a reader would otherwise
  // meet as a flash of the other theme.
  await page.reload();
  expect(await field(page)).toBe(LIGHT);
});

test('an explicit dark choice beats a light operating system', async ({
  page
}) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto(SITE);
  expect(await field(page)).toBe(LIGHT);

  await choose(page, 'Dark');
  expect(await field(page)).toBe(DARK);

  await page.reload();
  expect(await field(page)).toBe(DARK);
});

test('choosing System hands the decision back to the operating system', async ({
  page
}) => {
  // The third state, and the reason a stored `light` is not how "has not
  // chosen" is represented: a reader who returns to System has to start
  // following a machine that switches at sunset again.
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.goto(SITE);

  await choose(page, 'Light');
  expect(await field(page)).toBe(LIGHT);

  await choose(page, 'System');
  expect(await field(page)).toBe(DARK);

  await page.reload();
  expect(await field(page)).toBe(DARK);
});

test('a code block follows an explicit choice in both directions', async ({
  page
}) => {
  // Code is the one thing on this site whose colours are not `--color-*` roles:
  // Shiki writes both themes onto every token as `--shiki-light` and
  // `--shiki-dark`, and `base.css` picks between them with the same three-state
  // selector `tokens.css` uses. The prose of that rule is repeated in two files
  // and was checked by nobody; a reader who forces light on a dark machine and
  // gets a dark block in a light page is what it exists to prevent.
  //
  // The colour read is the block's own foreground — `github-light`'s `#24292e`
  // and `github-dark`'s `#e1e4e8`, which Shiki puts on the `<pre>` — because it
  // is the one syntax colour every block has whatever it contains.
  const LIGHT_CODE = 'rgb(36, 41, 46)';
  const DARK_CODE = 'rgb(225, 228, 232)';
  const code = page.locator('.astro-code').first();

  await page.emulateMedia({ colorScheme: 'dark' });
  await page.goto(`${SITE}/reference/react/`);
  await expect(code).toHaveCSS('color', DARK_CODE);

  await choose(page, 'Light');
  await expect(code).toHaveCSS('color', LIGHT_CODE);

  await choose(page, 'Dark');
  await expect(code).toHaveCSS('color', DARK_CODE);
});

test('the choice holds on a document page as well as on the argument page', async ({
  page
}) => {
  // The theme is the layout's, not the landing page's. A rule scoped to one
  // stance would pass every test above and leave every other page following
  // the machine.
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.goto(SITE);
  await choose(page, 'Light');

  for (const route of [
    '/reference/',
    '/providers/',
    '/archetypes/',
    '/design/'
  ]) {
    await page.goto(`${SITE}${route}`);
    expect(await field(page), route).toBe(LIGHT);
  }
});
