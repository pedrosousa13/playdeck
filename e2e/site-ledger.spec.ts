import { expect, test, type Page } from '@playwright/test';

/**
 * The landing page's capability ledger, which reports what Playdeck says about
 * the browser running this test (#522).
 *
 * The claim the panel makes is that every row is read from the player beside
 * it. A panel of five plausible rows would look identical to a reader and to a
 * screenshot, so what these tests pin is the one thing a static panel could not
 * do: change. The rows open `unknown`, because `loading="interaction"` leaves
 * the root dormant and nothing has been asked of a provider yet, and at least
 * one of them moves once a provider has attached and answered.
 *
 * Located by the classes and the `data-status` the panel already carries —
 * `data-status` is what selects each row's colour — rather than through hooks
 * added for a test. Nothing here is a second description of the markup.
 *
 * The site is served by the second `webServer` entry in `playwright.config.ts`.
 * The storybook one owns `baseURL`, so this address is written out rather than
 * navigated to as a path.
 */
const landing = 'http://127.0.0.1:4322/';

// The five rows, in the order the panel prints them. Written out rather than
// read from `PlayerCapabilities`: a list derived from the page's own source
// would agree with the page whatever either of them said.
const capabilities = [
  'fullscreen',
  'pictureInPicture',
  'airPlay',
  'selectQuality',
  'selectTextTrack'
];

const rows = (page: Page) => page.locator('.ledger__rows .row');
/**
 * The hero's activation button, scoped to the hero panel.
 *
 * `./locators`' `activationButton` is page-wide, and `/` now mounts three
 * players rather than one: the hero, and the two archetypes the page runs to
 * show that the primitives compose into different products (#542). All three
 * carry `data-playdeck-part="activation"`, so the shared locator is a
 * strict-mode ambiguity here in a way it is not on a story that mounts one
 * player. `.demo__stage` is the hero's own screen — `HeroPlayer.astro` draws
 * it — so this says "the hero's" without inventing a hook for a test.
 */
const heroActivation = (page: Page) =>
  page.locator('.demo__stage [data-playdeck-part="activation"]');

test('the ledger opens unknown for the five capabilities it reports', async ({
  page
}) => {
  await page.goto(landing);

  // The island is `client:only`, so there is nothing in the document to assert
  // on until it mounts — which is also what makes the count meaningful.
  await expect(rows(page)).toHaveCount(capabilities.length);
  await expect(rows(page).locator('.row__capability')).toHaveText(capabilities);

  // Dormant is not "no answer". Every capability reads `unknown` and the
  // reason line says why, which is the state a visitor meets before pressing
  // anything and the state the page is only honest if it prints.
  await expect(rows(page).locator('.row__status')).toHaveText(
    capabilities.map(() => 'unknown')
  );
  for (const row of await rows(page).all()) {
    await expect(row).toHaveAttribute('data-status', 'unknown');
    await expect(row.locator('.row__reason')).toContainText('not-ready');
  }
});

test('the ledger leaves unknown once a provider has answered', async ({
  page
}) => {
  await page.goto(landing);
  await expect(rows(page)).toHaveCount(capabilities.length);

  await heroActivation(page).click();

  // Which rows resolve, and to what, is a property of the browser running this
  // — that is the whole point of the panel — so what is asserted is that the
  // ledger follows the controller at all, not that a named capability lands on
  // a named answer. A static panel fails this, and no browser-specific
  // expectation is smuggled in with it.
  await expect
    .poll(() =>
      rows(page).evaluateAll(
        (elements) =>
          elements.filter(
            (element) => element.getAttribute('data-status') !== 'unknown'
          ).length
      )
    )
    .toBeGreaterThan(0);

  // And an answer of `unavailable` carries the reason for it, which is the
  // substance of the row rather than a decoration on it. Vacuous on a browser
  // that refuses nothing, which is why it is not the assertion above.
  const reasons = await rows(page).evaluateAll((elements) =>
    elements
      .filter(
        (element) => element.getAttribute('data-status') === 'unavailable'
      )
      .map(
        (element) =>
          element.querySelector('.row__reason')?.textContent?.trim() ?? ''
      )
  );
  for (const reason of reasons) expect(reason).not.toBe('');
});
