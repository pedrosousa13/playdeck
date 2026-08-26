import { expect, test, type Page } from '@playwright/test';
import {
  captionsTrigger,
  captionsTriggerSelector,
  controls,
  settingsMenu,
  settingsMenuSelector,
  settingsTrigger,
  settingsTriggerSelector
} from './locators';

/**
 * #413: wherever the composition's menus open, the whole box has to land inside
 * the document.
 *
 * The composition anchors both menus upward from their trigger, and the trigger
 * sits at the bottom of a player that is only `56.25cqw` tall — so the narrower
 * the browser viewport, the less room there is above it, while the `@container
 * (max-width: 420px)` fold makes the settings menu its LONGEST at exactly those
 * widths. Measured on main, with the settings menu open: a box top of -124 at
 * 320px, -45 at 375px and -20 at 420px, putting 3 items past the top of the
 * document at 320px. Nothing reaches them — `document.scrollHeight` equals
 * `clientHeight`, so the page does not scroll, and the menu's own `overflow-y`
 * only moves content inside a box that is itself off-screen.
 *
 * Every assertion below is taken from rendered geometry rather than from the
 * rule text: the defect is a placement, and a stylesheet assertion would go
 * green on any rule that merely mentions the right property.
 *
 * The mock `--composition` story, not `--real-sources`: it stages every
 * capability available with no media and no network, so the menu carries its
 * full 12 entries (6 rates, 4 quality rungs, plus the folded PiP and AirPlay)
 * identically on every engine. Both menus are driven, disambiguated by
 * accessible name through `e2e/locators.ts` — `CaptionsMenu` is a preset over
 * the same primitive, so the part attribute alone matches both triggers.
 */
const composition =
  '/iframe.html?id=reference-player--composition&viewMode=story';

// Each menu carries both forms of the same handle: the `Locator` for driving it
// and the selector string `page.evaluate` needs to measure it. Both come from
// `e2e/locators.ts`, which is where the aria-label disambiguation is explained.
const menus = [
  {
    name: 'settings',
    locate: settingsTrigger,
    trigger: settingsTriggerSelector
  },
  {
    name: 'captions',
    locate: captionsTrigger,
    trigger: captionsTriggerSelector
  }
] as const;

type Placement = {
  readonly menu: { readonly top: number; readonly bottom: number };
  readonly trigger: { readonly top: number };
  readonly items: ReadonlyArray<{
    readonly label: string;
    readonly top: number;
    readonly reachable: boolean;
  }>;
};

/**
 * The open menu's box, its trigger's box, and every item measured where the
 * menu's own scroller can actually put it.
 *
 * `scrollIntoView` per item rather than one snapshot of all of them: the
 * settings menu is a bounded scroller by design (`max-height` plus
 * `overflow-y: auto`), so an item below the fold is not a defect — being unable
 * to bring it into view is. Scrolling each item into view and then hit-testing
 * its own centre is that question asked directly, and it also catches a menu
 * that has escaped the player's `overflow: hidden`, where an item can be inside
 * its scroller and still painted nowhere.
 *
 * `paintsAtItsCentre` in `e2e/visual.spec.ts` asks the same hit-test question of
 * one element; this asks it of every item in an open menu, after scrolling each
 * one. The overlap is not extracted because sharing it would mean editing that
 * spec, which is not this issue's to change. What is NOT copied from it is its
 * `pointer-events` lift, and that is measured rather than assumed: every item
 * here computes `pointer-events: auto` and hit-tests to itself without the lift
 * (14 of 14 across both menus at 320px), because these are real buttons rather
 * than the deliberately click-through overlays that helper was written for.
 */
const placementOf = (page: Page, trigger: string): Promise<Placement> =>
  page.evaluate(
    ({ triggerSelector, menuSelector }) => {
      const menu = document.querySelector(menuSelector);
      if (menu === null) throw new Error('no open menu');
      const triggerEl = document.querySelector(triggerSelector);
      if (triggerEl === null)
        throw new Error(`no trigger for ${triggerSelector}`);
      const box = menu.getBoundingClientRect();
      // Hidden items are not reachable and are not meant to be: the fold renders
      // both forms of PiP/AirPlay and lets the container query hide whichever
      // does not apply, and `display: none` takes an entry out of the a11y tree
      // and out of the primitive's roving focus with it.
      const items = [
        ...menu.querySelectorAll<HTMLElement>(
          '[role="menuitem"], [role="menuitemradio"]'
        )
      ].filter((item) => getComputedStyle(item).display !== 'none');
      return {
        menu: { top: box.top, bottom: box.bottom },
        trigger: { top: triggerEl.getBoundingClientRect().top },
        items: items.map((item) => {
          item.scrollIntoView({ block: 'nearest' });
          const rect = item.getBoundingClientRect();
          const hit = document.elementFromPoint(
            rect.left + rect.width / 2,
            rect.top + rect.height / 2
          );
          return {
            label: item.textContent ?? '',
            top: rect.top,
            // `contains`, not identity: an item's centre resolves to the check
            // indicator or the icon inside it.
            reachable: hit !== null && item.contains(hit)
          };
        })
      };
    },
    { triggerSelector: trigger, menuSelector: settingsMenuSelector }
  );

/**
 * The focused element's box, plus enough identity to name it in a failure —
 * polled across `requestAnimationFrame` boundaries until the box is inside the
 * document, or until a 1s wall-clock deadline passes.
 *
 * `placementOf` scrolls every item into view to hit-test it, which leaves the
 * settings menu's own scroller at the bottom: measured, `scrollTop: 244` of a
 * `scrollHeight: 448` in a `clientHeight: 200`. Focus is still on item 1, so the
 * first ArrowDown moves it to an item scrolled out of the top of that scroller,
 * and `settings-menu.tsx` only calls `.focus()` — the scroll that brings the
 * item back is the browser's own. Chromium and Firefox apply it during the key
 * event's dispatch; WebKit defers it, so a read taken right after the press
 * catches the item still scrolled out and reports it above the document. One
 * evaluate caught the whole shape at once: the item's top at -179, the menu box
 * at 16 and 218 against a 640px document, and the scroller still at 244. Those
 * three together say the item is clipped inside a scroller that is itself
 * wholly inside the document — nothing is painted above the viewport, and once
 * the deferred scroll lands the scroller returns to 0 and the item reads 65.
 *
 * Everything below was measured on 2026-08-26 on the maintainer's machine,
 * under `@playwright/test` 1.61.1 driving WebKit 26.5 (Playwright build v2311).
 * The rate is load-dependent, so a bare count would mislead — the pre-fix rate
 * against this file was 2 in 84 with
 * `playwright test e2e/menu-placement.spec.ts --project=webkit
 * --repeat-each=12 --retries=0`, and 1 in 35 at `--repeat-each=5`, both at the
 * default worker count. A harness driving this composition directly, 80
 * attempts per cell, isolated the trap: with all three engine projects running
 * at once webkit failed 16/80 at the 460px shape and 7/80 at the 640px one,
 * chromium and firefox went 0/80 in every cell, and webkit alone on an
 * otherwise idle machine went 0/60. Removing the `scrollIntoView` pass took
 * webkit to 0/80 at both shapes, which is what names the pass as the thing that
 * sets the trap rather than the engine alone. Contention is therefore part of
 * the measurement, not incidental to it.
 *
 * The condition polled on is containment, NOT stability: the stale box is stable
 * too. While the deferred scroll is pending, two reads a frame apart are both
 * the pre-scroll value and agree on the first comparison, so a settle that waits
 * for agreement returns the stale box with confidence — that approach was tried,
 * and under the same command and machine above it still reported this same -179
 * twice in 84 webkit runs.
 *
 * The bound is what keeps this a wait rather than a mask: a genuinely
 * mispositioned menu never comes into view, so the poll runs out, returns its
 * last measurement, and the assertion fails with the real number. Only the
 * keyboard-walk half is polled — the #413 placement guarantee this spec exists
 * for is asserted from `placementOf`'s un-polled read of the menu box taken
 * right after open, which this does not touch.
 */
const focused = (page: Page) =>
  page.evaluate(async () => {
    const measure = () => {
      const el = document.activeElement;
      if (el === null) throw new Error('nothing focused');
      const rect = el.getBoundingClientRect();
      return {
        label: el.textContent ?? '',
        part: el.getAttribute('data-playdeck-part'),
        top: rect.top,
        bottom: rect.bottom,
        documentHeight: document.documentElement.clientHeight
      };
    };
    const nextFrame = () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => resolve());
      });

    const deadline = performance.now() + 1000;
    let box = measure();
    while (
      (box.top < 0 || box.bottom > box.documentHeight) &&
      performance.now() < deadline
    ) {
      await nextFrame();
      box = measure();
    }
    return box;
  });

/**
 * Open, measure, walk the whole item list with ArrowDown, close.
 *
 * The keyboard walk is the WCAG 2.4.11 half of this: `SettingsMenuContent`
 * autofocuses the first item on open and ArrowDown moves through the rest, so
 * an off-document box puts focus on something the user cannot see. The walk
 * stops one short of wrapping — the primitive wraps from the last item back to
 * the first, which would re-measure the item already checked. Each step measures
 * through `focused`, which polls the box into the document first because moving
 * focus is what scrolls the item back into the menu's own scroller.
 */
const assertPlacement = async (
  page: Page,
  menu: (typeof menus)[number],
  { upward }: { readonly upward: boolean }
): Promise<void> => {
  const trigger = menu.locate(page);
  await trigger.click();
  await expect(settingsMenu(page)).toHaveAttribute(
    'data-playdeck-menu',
    'open'
  );

  const placement = await placementOf(page, menu.trigger);

  expect(
    placement.menu.top,
    `the ${menu.name} menu box starts above the top of the document`
  ).toBeGreaterThanOrEqual(0);
  expect(
    placement.items.filter((item) => item.top < 0).map((item) => item.label),
    `these ${menu.name} items start above the top of the document`
  ).toEqual([]);
  expect(
    placement.items.filter((item) => !item.reachable).map((item) => item.label),
    `these ${menu.name} items do not hit-test to themselves once scrolled to`
  ).toEqual([]);

  if (upward) {
    // Sub-pixel tolerance: this asks which side of the trigger the menu is on,
    // not for an exact gap.
    expect(
      placement.menu.bottom,
      `the ${menu.name} menu no longer opens upward from its trigger`
    ).toBeLessThanOrEqual(placement.trigger.top + 0.5);
  }

  for (let step = 1; step < placement.items.length; step += 1) {
    await page.keyboard.press('ArrowDown');
    const item = await focused(page);
    expect(
      item.part,
      `ArrowDown ${step} in the ${menu.name} menu left the item list`
    ).toMatch(/^menu-(item|radio-item)$/);
    expect(
      item.top,
      `ArrowDown ${step} in the ${menu.name} menu focused "${item.label}" above the document`
    ).toBeGreaterThanOrEqual(0);
    expect(
      item.bottom,
      `ArrowDown ${step} in the ${menu.name} menu focused "${item.label}" below the document`
    ).toBeLessThanOrEqual(item.documentHeight);
  }

  await page.keyboard.press('Escape');
  await expect(settingsMenu(page)).toHaveCount(0);
};

// The three widths #413 measured, plus one from the second band. 420 is the
// inclusive edge of the fold, so it is the width where the menu is longest AND
// the room above it is largest.
//
// 460 is in the band the comment on `.playdeck-example-menu` reports and which
// nothing pinned: above the fold the row wraps a second time, and the defect
// comes back. Confirmed by sweeping 320 to 800 in 20px steps with the fix
// removed — the settings box top is negative at every width from 320 to 500
// (440 at -8, 460 at -47, 480 at -36, 500 at -25) and non-negative from 520 up.
// 460 is the worst of that band rather than its edge, so it fails by 47px
// rather than by 8.
for (const width of [320, 375, 420, 460] as const) {
  test(`both menus open inside the document at ${width}px`, async ({
    page
  }) => {
    await page.setViewportSize({ width, height: 640 });
    await page.goto(composition);
    await expect(controls(page)).toBeVisible();

    for (const menu of menus)
      await assertPlacement(page, menu, { upward: false });
  });
}

// The case that rules out fixing this with a width breakpoint, which is why it
// is pinned rather than left as a note: 640px is comfortably above the fold and
// the menu still ran off the top of the document there — measured at -164 on
// main — because `max-height: 12rem` grows with the root font size while the
// player does not. WCAG 1.4.4 makes 200% text a supported state, and
// `e2e/a11y.spec.ts` already reflows the composition at it without opening a
// menu.
test('both menus stay inside the document at 640px with text at 200%', async ({
  page
}) => {
  await page.setViewportSize({ width: 640, height: 720 });
  await page.goto(composition);
  await expect(controls(page)).toBeVisible();
  // Scaled against the measured 16px baseline, the way `e2e/a11y.spec.ts`
  // applies a UA text-only zoom.
  await page.evaluate(() => {
    document.documentElement.style.fontSize = '32px';
  });

  for (const menu of menus)
    await assertPlacement(page, menu, { upward: false });
});

// The half this fix is not allowed to move — #413's "at 640px AND ABOVE"
// criterion, so the band is pinned at both ends rather than only at 640. 900 is
// the far end of it and not an arbitrary second number: `.playdeck-example-frame`
// stops at `max-width: 48rem`, so measured, the player's box is identical at 800
// and at every width above it (432px tall, 768 wide). Pinning one width past the
// cap therefore pins the whole "and above".
//
// Unlike the widths above, neither of these fails without the fix — measured, the
// settings box top is 102 at 640 and 192 at 800 on the pre-fix file. That is the
// point: this is the no-regression half, and what it can catch is a correction
// that moves a menu which was already placed correctly.
for (const width of [640, 900] as const) {
  test(`the settings menu still opens upward from its trigger at ${width}px`, async ({
    page
  }) => {
    await page.setViewportSize({ width, height: 720 });
    await page.goto(composition);
    await expect(controls(page)).toBeVisible();

    // Only the settings menu is asked where it opens. `CaptionsMenu` is a preset
    // that renders `SettingsMenuContent` itself and takes no className from the
    // composition, so no placement rule reaches it at any width: it is a static,
    // in-flow box inside the control row. That is why it satisfies #413's
    // containment criteria for free, and it is not this issue's to change.
    for (const menu of menus)
      await assertPlacement(page, menu, { upward: menu.name === 'settings' });
  });
}
