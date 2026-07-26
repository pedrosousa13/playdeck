import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { settingsMenu, settingsTrigger } from './locators';

// #32's verification target. Every state below is a MOCK story: no media, no
// network, and identical on every engine, which is what makes a fixed
// expectation honest here. `!test` excludes a story from the Vitest run only —
// Storybook dev serves all of them, so Playwright can drive them too.
const story = (id: string) =>
  `/iframe.html?id=reference-player--${id}&viewMode=story`;

const composition = story('composition');

// The seven states #32 lists. They are seven states over six stories:
// `composition` is genuinely both paused and captions-on, and menu-open is
// that same story with the settings menu opened by this spec rather than by a
// story play function — whether Storybook runs play functions on a plain
// iframe render is not something this spec should depend on.
const states: ReadonlyArray<{
  readonly name: string;
  readonly url: string;
  readonly open?: boolean;
  // Set only for a state with a diagnosed, structural `incomplete` finding
  // that is NOT this example's to fix (see the reason given at each use, and
  // the fix report for #32). Never used to park something merely unexamined.
  readonly knownIncomplete?: string;
}> = [
  {
    name: 'idle',
    url: story('idle'),
    knownIncomplete:
      'Player.ActivationButton is a real, full-viewport "tap anywhere to play" surface while idle (position: absolute; inset: 0; z-index: 30, not overridable via its style prop) — genuinely rendered and meaningful, unlike LoadingIndicator\'s empty idle case, so it cannot be visually hidden the same way. It geometrically outranks the time row underneath it, which axe reports as color-contrast/bgOverlap regardless of either element\'s background color.'
  },
  { name: 'playing', url: story('playing') },
  { name: 'paused', url: composition },
  { name: 'captions-on', url: composition },
  {
    name: 'menu-open',
    url: composition,
    open: true,
    knownIncomplete:
      'axe-core\'s aria-valid-attr-value check unconditionally flags any aria-controls paired with a non-false aria-haspopup as "needs review" (messageKey: controlsWithinPopup) the instant the attribute is present — it does not attempt to resolve the id first. Every correctly-built aria-haspopup+aria-controls menu trips this; it is not specific to reely.'
  },
  { name: 'blocked-autoplay', url: story('blocked-autoplay') },
  {
    name: 'error',
    url: story('error-state'),
    knownIncomplete:
      'Player.ErrorDisplay is a real, full-viewport error surface while an error exists (position: absolute; inset: 0; z-index: 40, not overridable via its style prop) — by design, above everything else, including the time row underneath it. Making its own background fully opaque (this task) resolved the separate color-contrast/imgNode finding on its own text, but bgOverlap on the time row is a pure stacking-order determination in axe (independent of any color), so it persists regardless.'
  }
];

// Scoped to the player. Storybook injects a hidden argstable
// (`div.sb-preparing-docs`) into the story iframe; axe skips it because it is
// display-none, but scoping means this spec never depends on that.
// Axe's DEFAULT rule set, deliberately un-narrowed. Scoping with `withTags`
// to the WCAG tags would silently drop the best-practice rules, which is a
// suppression by another name. If a best-practice rule fires on something
// structurally unfixable in a page fragment, escalate it rather than
// narrowing the tags.
//
// The scoping itself has a cost, and it's worth naming: `.include(...)` sets
// axe's context to this subtree, so page-level rules (`bypass`) never run,
// and `region`/`landmark-one-main`/`page-has-heading-one` downgrade to
// inapplicable instead of running and passing. Those three are properties of
// Storybook's bare iframe document (no `<main>`, no `<h1>`, no landmarks) —
// not of reely — and a consumer's real page owns them, not a story fragment.
// "Zero violations" below is therefore a claim about this subtree, not about
// the host page.
const scan = (page: Page) =>
  new AxeBuilder({ page }).include('[data-reely-part="viewport"]').analyze();

for (const state of states) {
  test(`no accessibility violations in the ${state.name} state`, async ({
    page
  }, testInfo) => {
    await page.goto(state.url);
    // The idle state renders no controls at all, so wait on the viewport.
    await expect(page.locator('[data-reely-part="viewport"]')).toBeVisible();

    if (state.open) {
      await settingsTrigger(page).click();
      await expect(settingsMenu(page)).toHaveAttribute(
        'data-reely-menu',
        'open'
      );
    }

    const results = await scan(page);
    // The full violation objects, not just a count — a bare length assertion
    // tells whoever reads the CI log nothing about what broke.
    expect(results.violations).toEqual([]);

    // `results.incomplete` is axe's needs-review bucket: rules it could not
    // conclusively pass or fail. An empty one is what makes the WCAG 1.4.3
    // (color-contrast) claim over this state's text real, rather than
    // parked. `Player.LoadingIndicator` used to force this on every
    // composition-backed state by occupying the full viewport even while
    // idle; that is fixed (#32, `packages/react/src/index.tsx`). A few
    // states still carry a distinct, diagnosed `incomplete` entry that is
    // not this example's or this task's to fix — see `knownIncomplete`
    // above. Those are surfaced as a visible, non-failing annotation
    // instead of silently dropped, so CI stays honest without staying red
    // on findings outside this task's scope.
    if (state.knownIncomplete) {
      testInfo.annotations.push({
        type: 'known-incomplete (#32)',
        description: `${state.knownIncomplete} Actual: ${JSON.stringify(results.incomplete)}`
      });
    } else {
      expect(results.incomplete).toEqual([]);
    }
  });
}
