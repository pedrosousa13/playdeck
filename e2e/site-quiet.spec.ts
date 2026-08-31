import { expect, test, type Page } from '@playwright/test';
import { activationButton } from './locators';

/**
 * `/`'s central claim, which is the one thing on that page a screenshot cannot
 * check: nothing is fetched from anybody before a reader asks for it, and the
 * line under the player never says otherwise once one has been.
 *
 * The page states it in words — "Nothing above has loaded. No request has left
 * this page." — directly under the thing that would falsify it. A sentence
 * printed beside the machinery it describes is worth exactly what the gate
 * behind it is worth, and this file is that gate.
 *
 * Three tests, and the second is what makes the first mean anything. An empty
 * list of foreign requests is also what a listener attached to the wrong page
 * produces, so the at-rest assertion is paired with one that presses a hosted
 * provider and demands the request happen. It is skipped while every hosted
 * provider is still `ready: false`, and the skip is computed rather than
 * written down, so it starts running by itself the day one is turned on.
 *
 * The third is a defect that nearly shipped rather than a property the page
 * was designed for. `bench-quiet.ts` and `apps/site/test/bench-quiet.test.ts`
 * carry it in full; what they cannot carry is the browser, because they drive
 * a pure function and the failure was a sequence of presses against a mounted
 * player. This is that sequence.
 *
 * The site is served by the second `webServer` entry in `playwright.config.ts`.
 * The storybook one owns `baseURL`, so this address is written out rather than
 * navigated to as a path.
 */
const landing = 'http://127.0.0.1:4322/';
const origin = new URL(landing).origin;

const composition = (page: Page) => page.locator('[data-bench-composition]');
const quietLine = (page: Page) => page.locator('.bench__quiet');
const sourcePositions = (page: Page) =>
  page.locator('[data-bench-switch="source"] [data-value]');

/**
 * `data:` and `blob:` are the page addressing itself and reach no host.
 * Everything else has to be this origin: the document, the island's own
 * JavaScript, the fonts, the poster and the clip.
 */
const foreign = (urls: readonly string[]) =>
  urls.filter(
    (url) =>
      !url.startsWith(`${origin}/`) &&
      !url.startsWith('data:') &&
      !url.startsWith('blob:')
  );

/**
 * Whether a line claims the page has fetched nothing.
 *
 * Matched as a claim rather than as a sentence. The words are `bench-quiet.ts`'s
 * and are meant to be editable; what may never come back is the *assertion*,
 * after something has loaded. A copy edit that keeps the meaning keeps this
 * test passing, and one that reintroduces the meaning fails it whatever the
 * wording.
 */
const claimsNothingHasLoaded = (line: string) =>
  /nothing[^.]*loaded/i.test(line) || /no request[^.]*left/i.test(line);

/** The URL the composition panel prints for the position selected right now. */
const printedSource = async (page: Page) => {
  const printed = await composition(page).innerText();
  const match = /const source = '([^']*)';/.exec(printed);
  if (match === null) {
    throw new Error(`No source line in the composition:\n${printed}`);
  }
  return match[1];
};

/**
 * The source positions that reach somebody else's host, discovered by pressing
 * each one and reading the URL the panel prints for it.
 *
 * Derived rather than listed, because the list is `apps/site/src/bench-sources.ts`'s
 * and the whole point of the test below is that it wakes up on its own when
 * that file changes. Read through the page because the panel prints
 * `entry.source(base)` verbatim, so this is the module's own answer with the
 * base path already resolved — which is the form the comparison needs.
 */
const hostedPositions = async (page: Page) => {
  const hosted: { token: string; host: string }[] = [];
  for (const position of await sourcePositions(page).all()) {
    const token = await position.getAttribute('data-value');
    if (token === null) continue;
    await position.click();
    const url = new URL(await printedSource(page), landing);
    if (url.origin !== origin) hosted.push({ token, host: url.host });
  }
  return hosted;
};

test('at rest, / has contacted nobody', async ({ page }) => {
  const requests: string[] = [];
  page.on('request', (request) => requests.push(request.url()));

  await page.goto(landing);

  // The island is `client:only`, so its arrival is what makes the emptiness
  // below evidence rather than a listener attached before anything could have
  // happened. Both halves of it: the player, which is portaled into the frame,
  // and the readout, which renders where the island sits.
  await expect(activationButton(page)).toBeVisible();
  await expect(composition(page)).toBeVisible();
  await page.waitForLoadState('networkidle');

  // The listener saw the navigation itself, so an empty foreign list is a fact
  // about the page rather than about the recorder.
  expect(requests).toContain(landing);
  expect(foreign(requests)).toEqual([]);

  // And the page says so, which is the claim a reader is actually given.
  expect(claimsNothingHasLoaded(await quietLine(page).innerText())).toBe(true);
});

test('pressing a hosted provider does contact it', async ({ page }) => {
  const requests: string[] = [];
  page.on('request', (request) => requests.push(request.url()));

  await page.goto(landing);
  await expect(composition(page)).toBeVisible();

  const hosted = await hostedPositions(page);
  test.skip(
    hosted.length === 0,
    'Every hosted provider in apps/site/src/bench-sources.ts is still `ready: false`, so the source switch offers no position that leaves this origin. This test starts running when one is turned on.'
  );

  const { token, host } = hosted[0];
  await page
    .locator(`[data-bench-switch="source"] [data-value="${token}"]`)
    .click();
  await activationButton(page).click();

  // The other half of the at-rest claim. `DESIGN.md` permits this page to
  // contact a third party once a reader has asked, and never before, so what
  // is asserted here is that asking works — a page that fetched nothing from
  // anybody would pass the test above by doing nothing at all.
  await expect
    .poll(() => requests.filter((url) => new URL(url).host === host))
    .not.toEqual([]);
});

test('the quiet line never claims nothing has loaded once something has', async ({
  page
}) => {
  /*
   * Two presses, no timing trick.
   *
   * Under `loading="interaction"` a source change returns `Player.Root` to
   * `dormant`, so the first version of this line — which read the live
   * activation state — printed the resting sentence again after a fetch had
   * already gone out. The second clause of that sentence is a claim about the
   * page's history, and history does not revert.
   */
  const media: string[] = [];
  page.on('request', (request) => {
    if (/\.(mp4|m3u8|ts)(\?|$)/.test(request.url())) media.push(request.url());
  });

  await page.goto(landing);
  await expect(activationButton(page)).toBeVisible();

  const line = quietLine(page);
  expect(claimsNothingHasLoaded(await line.innerText())).toBe(true);

  await activationButton(page).click();
  await expect.poll(() => media.length).toBeGreaterThan(0);

  // The press that used to undo the sentence.
  await page.locator('[data-bench-switch="source"] [data-value="hls"]').click();

  // Replaced, never removed: a line that vanished would move everything below
  // it, and would also pass an assertion about what it does not say.
  await expect(line).toHaveCount(1);
  expect(claimsNothingHasLoaded(await line.innerText())).toBe(false);
});
