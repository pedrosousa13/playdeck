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
}> = [
  { name: 'idle', url: story('idle') },
  { name: 'playing', url: story('playing') },
  { name: 'paused', url: composition },
  { name: 'captions-on', url: composition },
  { name: 'menu-open', url: composition, open: true },
  { name: 'blocked-autoplay', url: story('blocked-autoplay') },
  { name: 'error', url: story('error-state') }
];

// Scoped to the player. Storybook injects a hidden argstable
// (`div.sb-preparing-docs`) into the story iframe; axe skips it because it is
// display-none, but scoping means this spec never depends on that.
// Axe's DEFAULT rule set, deliberately un-narrowed. Scoping with `withTags`
// to the WCAG tags would silently drop the best-practice rules, which is a
// suppression by another name. If a best-practice rule fires on something
// structurally unfixable in a page fragment, escalate it rather than
// narrowing the tags.
const scan = (page: Page) =>
  new AxeBuilder({ page })
    .include('[data-reely-part="viewport"]')
    .analyze();

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
  });
}
