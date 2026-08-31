import { expect, test, type Page } from '@playwright/test';
import { activationButton } from './locators';

/**
 * The bench on `/`: the switches, the composition they build, and the one line
 * of what the mounted provider refused.
 *
 * This file replaces `site-ledger.spec.ts`, which pinned the five-row browser
 * panel `/` used to carry. The panel is gone; its argument is not. A readout of
 * five plausible-looking claims is identical, to a reader and to a screenshot,
 * to five rows of prose — so what a test pins is the one thing a static readout
 * could not do, which is change. Every assertion below is a change: a
 * composition that rewrites itself when a switch moves, and a line that is
 * absent until a provider says no and then carries that provider's own words.
 *
 * What is deliberately not pinned is *which* capability a given provider
 * refuses. That is the provider's business, it differs by browser, and a test
 * that named one would be a second copy of the library's answer sitting where
 * nobody would think to update it — which is the failure the reason line was
 * designed to be incapable of.
 *
 * The contract is `data-bench-switch`, `data-value`, `data-bench-reason` and
 * `data-bench-composition`, named in #542's plan. The switches are native
 * radios inside a label and `data-value` is on the input, which is what a click
 * lands on.
 *
 * The site is served by the second `webServer` entry in `playwright.config.ts`.
 * The storybook one owns `baseURL`, so this address is written out rather than
 * navigated to as a path.
 */
const landing = 'http://127.0.0.1:4322/';

const composition = (page: Page) => page.locator('[data-bench-composition]');
const reason = (page: Page) => page.locator('[data-bench-reason]');
const position = (page: Page, group: 'source' | 'skin', value: string) =>
  page.locator(`[data-bench-switch="${group}"] [data-value="${value}"]`);

/** The library's one opt-in stylesheet, as a consumer would import it. */
const THEME_IMPORT = "import '@playdeck/react/theme.css';";

/**
 * The six clauses `reasonWords` in `apps/site/src/bench-capabilities.ts` can
 * print, one per `unavailable` reason the `Availability` type defines.
 *
 * Written out rather than imported, the way `site-nav.spec.ts` writes out the
 * navigation: a list read from the page's own source would agree with the page
 * whatever either of them said. What this pins is that the line's second row is
 * the library's vocabulary and not a sentence this page invented — which one of
 * the six lands is the browser's business.
 */
const REASON_CLAUSES = [
  'the browser cannot do it',
  'the provider cannot do it',
  "the provider's plan does not include it",
  'the third-party runtime it was given leaves it out',
  'the source does not offer it',
  'a policy refuses it'
];

/**
 * The lines of the JSX block, from `<Player.Root` to its close.
 *
 * The thesis paragraph says "the same six lines drive all five", so the count
 * is a number the page states in prose and the panel has to keep true. The
 * preamble above it — the theme import, the `const source` line — is not part
 * of it: those are lines a consumer writes above the composition, which is
 * exactly what lets the block below read identically whichever provider is
 * switched on.
 */
const jsxBlock = (printed: string) => {
  const lines = printed.split('\n');
  const open = lines.findIndex((line) => line.startsWith('<Player.Root'));
  const close = lines.findIndex((line) => line.startsWith('</Player.Root>'));
  if (open === -1 || close <= open) {
    throw new Error(`No <Player.Root> block in the composition:\n${printed}`);
  }
  return lines.slice(open, close + 1);
};

const printed = (page: Page) => composition(page).innerText();

/** The `const source` line of the preamble, which is what a source press moves. */
const sourceLine = (printedText: string) => {
  const match = /^const source = '[^']*';$/m.exec(printedText);
  if (match === null) {
    throw new Error(`No source line in the composition:\n${printedText}`);
  }
  return match[0];
};

test('nothing holds space for a reason at rest', async ({ page }) => {
  await page.goto(landing);

  // The island is `client:only`, so the panel's arrival is what makes the
  // count below a fact about the page rather than about a document the island
  // has not reached yet.
  await expect(composition(page)).toBeVisible();
  await expect(activationButton(page)).toBeVisible();

  // Absent, not hidden and not empty. A layout that reserved a row for this
  // line would be the resting placeholder the design removed on purpose — a
  // gap under the switches that stays empty unless a reader is lucky enough to
  // pick a provider that refuses something — and the only way to make that
  // unwritable is for there to be no element at all.
  await expect(reason(page)).toHaveCount(0);
});

test('the composition tracks both switches', async ({ page }) => {
  await page.goto(landing);
  await expect(composition(page)).toBeVisible();

  const atRest = await printed(page);
  expect(atRest).not.toContain(THEME_IMPORT);
  expect(jsxBlock(atRest)).toHaveLength(6);

  // The customisability argument, made by moving a real import rather than by
  // describing one: `theme` is the one stylesheet the library publishes, and
  // the switch loads it into the document as well as printing it here.
  await position(page, 'skin', 'theme').click();
  await expect(composition(page)).toContainText(THEME_IMPORT);

  await position(page, 'skin', 'none').click();
  await expect(composition(page)).not.toContainText(THEME_IMPORT);

  // And the source moves the line above the block rather than a prop inside
  // it. The library detects a provider from the URL, so `source={source}` is
  // the whole of `Player.Root`'s configuration whichever position is pressed —
  // which is the claim the six-line count below is a check on.
  const before = await printed(page);
  await position(page, 'source', 'hls').click();
  await expect
    .poll(async () => sourceLine(await printed(page)))
    .not.toBe(sourceLine(before));

  const after = await printed(page);
  expect(jsxBlock(after)).toEqual(jsxBlock(before));
  expect(jsxBlock(after)).toHaveLength(6);

  // Six lines in every combination the two switches reach, not just the two
  // above. Nothing either of them does may grow the block.
  await position(page, 'skin', 'theme').click();
  await expect(composition(page)).toContainText(THEME_IMPORT);
  expect(jsxBlock(await printed(page))).toHaveLength(6);
});

test("a refusal reaches the line in the provider's own words", async ({
  page
}) => {
  await page.goto(landing);
  await expect(composition(page)).toBeVisible();

  // `hls` is the provider that refuses something on both engines this suite
  // runs, and it is served from this origin, so the line can be produced
  // without contacting anybody. Which capability it refuses is not asserted:
  // that is the provider's answer and this page's job is to relay it.
  await position(page, 'source', 'hls').click();
  await activationButton(page).click();

  // A provider only answers once it has attached, which `loading="interaction"`
  // holds back until the press above.
  await expect(reason(page)).toHaveCount(1);
  const line = reason(page);

  // The line names the provider that is mounted right now, which is the one
  // the reader just pressed. A line that could name a provider nobody asked
  // about would be a table with the labels taken off.
  await expect(line).toContainText('hls');

  // And the clause under it is the library's, out of `reasonWords`. This is
  // what makes the line a report rather than a caption: the page never states
  // a capability fact of its own, and never reads one out of a document.
  const words = await line.innerText();
  expect(
    REASON_CLAUSES.some((clause) => words.includes(clause)),
    `no reasonWords clause in:\n${words}`
  ).toBe(true);

  // The motion the line is given exists because its arrival is the moment the
  // capability argument is made. `data-live` is written in the same React
  // commit as the words, so an element carrying the words without it would be
  // a change the page made silently.
  await expect(line).toHaveAttribute('data-live', '');
});
