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
  // The rule ids `results.incomplete` is expected to carry for this state,
  // asserted by equality below — so a new, undiagnosed rule id fails instead
  // of being silently absorbed alongside a documented one. An entry here
  // means a *diagnosed* finding with a written reason immediately above the
  // state that has it: never something merely unexamined. Absent (the
  // default) means the state is expected fully clean, same as violations.
  readonly knownIncomplete?: readonly string[];
}> = [
  // idle: Player.ActivationButton is a real, full-viewport "tap anywhere to
  // play" surface while idle (position: absolute; inset: 0; z-index: 30, not
  // overridable via its style prop) — genuinely rendered and meaningful,
  // unlike LoadingIndicator's empty idle case, so it cannot be visually
  // hidden the same way. It geometrically outranks the time row underneath
  // it; axe reports this as color-contrast/bgOverlap, a stacking-order
  // determination independent of either element's background color. Not
  // this example's to fix.
  { name: 'idle', url: story('idle'), knownIncomplete: ['color-contrast'] },
  { name: 'playing', url: story('playing') },
  { name: 'paused', url: composition },
  { name: 'captions-on', url: composition },
  // menu-open: axe-core's aria-valid-attr-value check unconditionally flags
  // any aria-controls paired with a non-false aria-haspopup as "needs
  // review" (messageKey: controlsWithinPopup) the instant the attribute is
  // present — it does not attempt to resolve the id first. Every
  // correctly-built aria-haspopup+aria-controls menu trips this; it is a
  // permanent axe-core limitation for the pattern, not specific to reely and
  // not fixable here.
  {
    name: 'menu-open',
    url: composition,
    open: true,
    knownIncomplete: ['aria-valid-attr-value']
  },
  { name: 'blocked-autoplay', url: story('blocked-autoplay') },
  // error: Player.ErrorDisplay is a real, full-viewport error surface while
  // an error exists (position: absolute; inset: 0; z-index: 40, not
  // overridable via its style prop) — by design, above everything else,
  // including the time row underneath it. That is color-contrast/bgOverlap,
  // a stacking-order determination independent of either element's
  // background color, so no CSS change here resolves it. Not this example's
  // to fix.
  {
    name: 'error',
    url: story('error-state'),
    knownIncomplete: ['color-contrast']
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
  }) => {
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
    // conclusively pass or fail. Matching it against `knownIncomplete` (an
    // equality, not a subset check) is what makes the WCAG 1.4.3
    // (color-contrast) claim over this state's text real rather than
    // parked: a new, undiagnosed rule id fails here instead of being
    // silently absorbed alongside a documented one. `Player.LoadingIndicator`
    // used to force a color-contrast entry on every composition-backed state
    // by occupying the full viewport even while idle; that is fixed (#32,
    // `packages/react/src/index.tsx`). The states with a `knownIncomplete`
    // above carry a distinct, diagnosed finding that is not this example's
    // to fix; every other state is expected fully clean.
    expect(results.incomplete.map((incomplete) => incomplete.id)).toEqual(
      state.knownIncomplete ?? []
    );
  });
}
