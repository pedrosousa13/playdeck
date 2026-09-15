import { expect, test, type Locator, type Page } from '@playwright/test';

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
 *
 * The switch itself is also pinned here, not only the colours it drives: its
 * trigger carries both a Tooltip and a DropdownMenu, and the tooltip must
 * never render while the menu is open (#642). WebKit cannot launch on the
 * authoring machine (two missing system libraries), so every red recorded
 * below is chromium and firefox only; CI's WebKit run is what covers the
 * third engine.
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
  // selector `tokens.css` uses. That rule is stated in the config that sets it,
  // the transformer that repaints through it and the stylesheet that spends it,
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

/**
 * The DOM element radix-ui@1.6.7 paints for an open tooltip, matched by a CSS
 * role selector rather than fetched through `getByRole('tooltip')`: with the
 * menu open, Radix marks everything outside it `aria-hidden`, which
 * `getByRole` respects and a plain CSS selector does not. Measured (chromium,
 * 2026-09-12): a tooltip left open behind an open menu has `domCount: 1`,
 * `display: block`, and a 109x28 box painted over the first menu item, while
 * `getByRole('tooltip')` counts 0 — a role query here would pass against the
 * unfixed component.
 */
const tooltipLocator = (page: Page) => page.locator('[role="tooltip"]');

/**
 * Asserts the first menu item, not something layered over it, is what a
 * pointer at that item's own centre would reach. The absence of a tooltip
 * element is the cause; this is the consequence the reader actually meets,
 * and it stays true whatever a future overlay is built from.
 *
 * Demonstrated red (docs/agents/demonstrated-red.md): in both tests above,
 * the `toHaveCount(0)` assertion aborts the test before this one runs, so
 * `expect(hit).toBe(true)` below was checked on its own — with
 * `toHaveCount` temporarily removed from the pointer test, against
 * `origin/main`'s component, measured 2026-09-12: it failed on both
 * chromium and firefox, `expect(received).toBe(expected) // Object.is
 * equality / Expected: true / Received: false`.
 */
const expectItemTakesThePointer = async (item: Locator): Promise<void> => {
  const box = (await item.boundingBox())!;
  // `element.contains(hit)`, not `hit.closest(...)`: a `closest` match would
  // pass for *any* menu item, while this has to prove *this* item was
  // reached — the same distinction `e2e/menu-placement.spec.ts`'s
  // `placementOf` draws with the identical call.
  const hit = await item.evaluate(
    (element, { x, y }) => {
      const el = document.elementFromPoint(x, y);
      return el !== null && element.contains(el);
    },
    { x: box.x + box.width / 2, y: box.y + box.height / 2 }
  );
  expect(hit).toBe(true);
};

test('the tooltip never renders while the menu is open, opened by keyboard', async ({
  page
}) => {
  // The trigger carries both a Tooltip and a DropdownMenu through nested
  // `asChild`, and nothing coupled their open states — a tooltip that
  // (re)opened while the menu was open rendered over the first item and
  // took its click (#642).
  //
  // Demonstrated red, measured on 2026-09-12 (chromium): this keyboard path
  // passes against the unfixed component, because Radix's own focus
  // management moves focus into the menu and closes the tooltip on the way.
  // So it carries a substitute mutation instead, per
  // `docs/agents/demonstrated-red.md`: with the gate removed and the
  // tooltip forced open (`open={true}` in `ThemeToggleIsland.tsx`),
  // `toHaveCount(0)` fails — `expect(locator).toHaveCount(expected) failed /
  // Expected: 0 / Received: 1`. `expectItemTakesThePointer` still passes
  // under that same mutation: `elementFromPoint` at the item's centre still
  // returns the `menuitemradio`, because the forced-open tooltip does not
  // cover it here. The hit-test assertion's own red comes from the pointer
  // test below instead.
  //
  // The pointer path below has a real red and needs no substitute: against
  // the component as it stands on `origin/main`, it fails on both chromium
  // and firefox with the same `Expected: 0 / Received: 1`.
  await page.goto(SITE);
  const trigger = page.locator('[data-theme-toggle]');
  const tooltip = tooltipLocator(page);
  const item = page.getByRole('menuitemradio', { name: 'Light', exact: true });

  // Baseline, menu closed: hover still opens the tooltip exactly as before.
  await trigger.hover();
  await expect(tooltip).toBeVisible();
  await page.mouse.move(0, 0);

  // Focus opens the tooltip exactly as hover does — still unchanged, menu
  // still closed — and `ArrowDown` then opens the dropdown directly, without
  // ever moving the pointer.
  await trigger.focus();
  await expect(tooltip).toBeVisible();
  await page.keyboard.press('ArrowDown');
  await expect(item).toBeVisible();
  // Measured (chromium, 2026-09-12): immediately after `ArrowDown`,
  // `[role="tooltip"]` briefly reads count 1 — a `data-state="closed"` node
  // still exit-animating, not one still open. `toHaveCount(0)` passes only
  // because it polls until the animation finishes, not because the node was
  // never there. It never intercepts either way: `elementFromPoint` at the
  // item's centre already returns the `menuitemradio` while that node is
  // still in the DOM, so the intent holds throughout.
  await expect(tooltip).toHaveCount(0);
  await expectItemTakesThePointer(item);
});

test('the tooltip never renders while the menu is open, opened by pointer', async ({
  page
}) => {
  // A tooltip open request that is still pending survives `pointerdown`,
  // and the trigger's own DropdownMenu half needs nothing past
  // `pointerdown` to open the menu — no `click` follows here to cancel the
  // pending tooltip, which is why the sequence below stops one short of a
  // click. A plain `trigger.click()` cannot exercise this: Radix's own
  // trigger closes the tooltip on its own `click` unconditionally, and that
  // only ever cancels a request that has already committed.
  //
  // `page.mouse.move` + `page.mouse.down()` (real input, no `up`) cannot
  // reach that pending state, checked directly rather than assumed: each is
  // its own round trip to the browser, and radix-ui@1.6.7's `TooltipTrigger`
  // schedules its open via a bare `window.setTimeout(handleOpen, 0)`
  // (`delayDuration` is 0 here), which fires in the gap between the two
  // calls. Measured (chromium and firefox, 2026-09-12, against
  // `origin/main`'s component): reading `[role="tooltip"]`'s `data-state`
  // right before `mouse.down()` already shows `"delayed-open"` — the request
  // has committed — so the trigger's own `onPointerDown` (which closes only
  // an *open* tooltip) closes it correctly on both engines, and the bug
  // never reproduces. Dispatching the same events by hand, synchronously,
  // keeps `pointerdown` inside the request's still-pending window instead.
  await page.goto(SITE);
  const trigger = page.locator('[data-theme-toggle]');
  const tooltip = tooltipLocator(page);
  const item = page.getByRole('menuitemradio', { name: 'Light', exact: true });
  // The island is `client:only="react"` (see `ThemeToggleIsland.tsx`'s own
  // header) and is not on the page until it hydrates.
  await trigger.waitFor({ state: 'visible' });

  await page.evaluate(() => {
    const el = document.querySelector(
      '[data-theme-toggle]'
    ) as HTMLElement | null;
    if (!el) throw new Error('theme toggle trigger not found');
    const rect = el.getBoundingClientRect();
    const opts: PointerEventInit = {
      bubbles: true,
      cancelable: true,
      clientX: rect.x + rect.width / 2,
      clientY: rect.y + rect.height / 2,
      pointerId: 1,
      isPrimary: true,
      button: 0
    };
    el.dispatchEvent(new PointerEvent('pointerover', opts));
    el.dispatchEvent(new PointerEvent('pointerenter', opts));
    el.dispatchEvent(new PointerEvent('pointermove', opts));
    el.dispatchEvent(new PointerEvent('pointerdown', opts));
    el.dispatchEvent(new PointerEvent('pointerup', opts));
  });
  await expect(item).toBeVisible();
  // The tooltip's own open timer is scheduled via radix-ui@1.6.7's
  // `window.setTimeout(handleOpen, delayDuration)`, and this file's
  // `TooltipProvider` sets `delayDuration` to 0 — one macrotask is all it
  // needs to settle. 100ms is far more than that macrotask costs; it is a
  // margin against CI scheduling jitter, not a measured requirement, and
  // gives a real reopen every chance it would have before asserting it
  // never rendered.
  await page.waitForTimeout(100);
  await expect(tooltip).toHaveCount(0);
  await expectItemTakesThePointer(item);
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
    '/examples/',
    '/design/'
  ]) {
    await page.goto(`${SITE}${route}`);
    expect(await field(page), route).toBe(LIGHT);
  }
});
