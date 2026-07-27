import { expect, test, type Page } from '@playwright/test';

/**
 * The check nothing else in this repo performs: that the composition still
 * *layers* correctly. Every other suite asserts behaviour (`test:storybook`),
 * geometry numbers at two widths (`e2e/reference.spec.ts`) or the stylesheet's
 * text (`packages/react/test/theme.test.ts`). #89 is the bug class this exists
 * for: a control row that painted below `Gestures`, invisible and unclickable,
 * with every behavioural test green.
 *
 * Chromium only, via the `visual` project — Firefox and WebKit render text
 * differently and would triple the baseline maintenance for no extra layering
 * signal. Design: docs/superpowers/specs/
 * 2026-07-27-visual-regression-check-112-design.md
 */

const story = (id: string): string => `/iframe.html?id=${id}&viewMode=story`;

const part = (name: string): string => `[data-reely-part="${name}"]`;

type Box = { x: number; y: number; width: number; height: number };

const boxOf = (page: Page, selector: string): Promise<Box> =>
  page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (el === null) throw new Error(`no element matched ${sel}`);
    const rect = el.getBoundingClientRect();
    return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
  }, selector);

/**
 * Does the element actually paint at its own centre, or is something on top of
 * it?
 *
 * `pointer-events` is lifted for the duration of the measurement because two
 * of the overlays this checks — `Captions` and `LoadingIndicator` — set
 * `pointer-events: none` deliberately (`captionsOverlayStyle`,
 * `loadingOverlayStyle` in `packages/react/src/index.tsx`). `elementFromPoint`
 * honours that and resolves straight through them, so a naive hit-test reports
 * a correctly-stacked overlay as painting below its neighbour. Pointer events
 * do not affect paint order, so lifting the property reads the stacking fact
 * and nothing else, and the inline value is restored inside the same
 * synchronous evaluate — nothing observes the mutated state.
 */
const paintsAtItsCentre = (page: Page, selector: string): Promise<boolean> =>
  page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (el === null) throw new Error(`no element matched ${sel}`);
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0)
      throw new Error(`${sel} has a zero-sized box`);
    const node = el as HTMLElement;
    const inline = node.style.pointerEvents;
    node.style.pointerEvents = 'auto';
    const hit = document.elementFromPoint(
      rect.x + rect.width / 2,
      rect.y + rect.height / 2
    );
    node.style.pointerEvents = inline;
    // `contains`, not identity: a button's centre resolves to the <path> of
    // the icon inside it.
    return hit !== null && el.contains(hit);
  }, selector);

/**
 * The complement of `paintsAtItsCentre`, without the lift: does a click at the
 * element's own centre land on something *else*? True for a decorative layer
 * that must not capture pointer input.
 */
const hitsThrough = (page: Page, selector: string): Promise<boolean> =>
  page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (el === null) throw new Error(`no element matched ${sel}`);
    const rect = el.getBoundingClientRect();
    const hit = document.elementFromPoint(
      rect.x + rect.width / 2,
      rect.y + rect.height / 2
    );
    return hit !== null && !el.contains(hit);
  }, selector);

const overflowOf = (page: Page, selector: string): Promise<number> =>
  page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (el === null) throw new Error(`no element matched ${sel}`);
    return el.scrollWidth - el.clientWidth;
  }, selector);

// Sub-pixel tolerance: layout resolves fractional pixels (the caption row sits
// at y = 403.78125), and this asks about containment, not about exact numbers.
const covers = (outer: Box, inner: Box): boolean =>
  outer.x <= inner.x + 0.5 &&
  outer.y <= inner.y + 0.5 &&
  outer.x + outer.width >= inner.x + inner.width - 0.5 &&
  outer.y + outer.height >= inner.y + inner.height - 0.5;

test('the reference control row paints above the gesture layer', async ({
  page
}) => {
  await page.goto(story('reference-player--composition'));
  await expect(page.locator(part('controls'))).toBeVisible();

  // #89 exactly: the row is a positioned box at z-index 20 above a full-bleed
  // `Gestures`. When it lost its stacking context the row still had a correct
  // bounding box and correct ARIA — only `elementFromPoint` at its own centre
  // could tell, and it resolved to the gestures element.
  expect(await paintsAtItsCentre(page, part('controls'))).toBe(true);

  for (const name of [
    'play-button',
    'mute-button',
    'captions-button',
    'pip-button',
    'airplay-button',
    'fullscreen-button',
    'seek-slider-input'
  ]) {
    expect(
      await paintsAtItsCentre(page, `${part('controls')} ${part(name)}`),
      `${name} is covered by something`
    ).toBe(true);
  }
});

test('the caption cue paints above the control row', async ({ page }) => {
  await page.goto(story('reference-player--composition'));
  await expect(page.locator(part('caption-cue'))).toBeVisible();

  // Measured: the cue's box (150x25 at y 403.78) sits inside the control row's
  // vertical band (109px tall at y 339), so these two boxes overlap by design.
  // What must hold is the paint order — `Captions` is composed *after*
  // `Controls` precisely because they share z-index 20 and the later sibling
  // wins the tie. Caption text under the control bar is a regression this repo
  // has already had once.
  expect(await paintsAtItsCentre(page, part('caption-cue'))).toBe(true);

  const player = await boxOf(page, '.reely-example');
  for (const name of ['poster', 'gestures', 'captions', 'controls']) {
    expect(
      covers(player, await boxOf(page, part(name))),
      `${name} escapes the player`
    ).toBe(true);
  }
});

test('the settings menu paints above the control row it opens from', async ({
  page
}) => {
  await page.goto(story('reference-player--composition'));
  await expect(page.locator(part('controls'))).toBeVisible();

  // Driven from here rather than by a story `play` function: the two stories
  // that open this menu themselves (`--settings-menu-selection`,
  // `--settings-menu-follows-state`) click during `play`, which would race a
  // Playwright click. `--composition`'s own play function is read-only.
  await page
    .locator(`${part('settings-menu-trigger')}[aria-label="Settings"]`)
    .click();
  await expect(page.locator(part('settings-menu'))).toHaveAttribute(
    'data-reely-menu',
    'open'
  );

  expect(await paintsAtItsCentre(page, part('settings-menu'))).toBe(true);

  // The menu opens upward (`bottom: calc(100% + 0.25rem)`), so an off-screen
  // menu is a real failure mode rather than a hypothetical one.
  const menu = await boxOf(page, part('settings-menu'));
  const viewport = page.viewportSize();
  if (viewport === null) throw new Error('no viewport size');
  expect(menu.y).toBeGreaterThanOrEqual(0);
  expect(menu.x).toBeGreaterThanOrEqual(0);
  expect(menu.y + menu.height).toBeLessThanOrEqual(viewport.height);
  expect(menu.x + menu.width).toBeLessThanOrEqual(viewport.width);
});

test('a 320px container keeps every layer inside the player', async ({
  page
}) => {
  // #111's case, and the reason this spec exists. `container-type: inline-size`
  // makes `.reely-example` a containing block for every absolutely-positioned
  // overlay in it and gives it its own stacking context. All 163 e2e tests
  // passed when that landed and none of them could see a layer move.
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto(story('reference-player--composition'));
  // `#storybook-root`, not `.reely-example`: the story injects its stylesheet
  // from the body, so a rule added here loses to it on document order at equal
  // specificity (measured — the player stayed 768px). Constraining the
  // container is also what an embed in a narrow column actually does.
  await page.addStyleTag({ content: '#storybook-root { width: 320px; }' });
  await expect(page.locator(part('controls'))).toBeVisible();

  const player = await boxOf(page, '.reely-example');
  expect(player.width).toBeLessThanOrEqual(320);

  // The container query fires on the player's width while the viewport stays
  // wide — the distinction `e2e/reference.spec.ts` proves behaviourally and
  // this proves structurally.
  await expect(page.locator(part('volume-slider'))).toBeHidden();

  expect(await overflowOf(page, '.reely-example')).toBeLessThanOrEqual(0);
  expect(await overflowOf(page, part('controls'))).toBeLessThanOrEqual(0);
  expect(await paintsAtItsCentre(page, part('controls'))).toBe(true);
  for (const name of ['poster', 'gestures', 'controls']) {
    expect(
      covers(player, await boxOf(page, part(name))),
      `${name} escapes the player`
    ).toBe(true);
  }

  // #114: in flow, over a box that keeps its 16:9 floor. `absolute` here means
  // the box is still ratio-locked and the row is eating the poster.
  expect(
    await page.evaluate(() => {
      const el = document.querySelector('[data-reely-part="controls"]');
      if (el === null) throw new Error('no control row');
      return getComputedStyle(el).position;
    })
  ).toBe('relative');
  expect(Math.round(player.height)).toBe(180);
});

test('the idle and error states hand the whole player to their overlay', async ({
  page
}) => {
  await page.goto(story('reference-player--idle'));
  await expect(page.locator(part('activation'))).toBeVisible();

  const idlePlayer = await boxOf(page, '.reely-example');
  expect(covers(await boxOf(page, part('activation')), idlePlayer)).toBe(true);
  // Above `Poster` and `Gestures`, which is what makes it clickable at all.
  expect(await paintsAtItsCentre(page, part('activation'))).toBe(true);
  // #89's SC 2.4.11 half: the row below a viewport-owning overlay is removed
  // from layout, not merely painted over.
  await expect(page.locator(part('controls'))).toBeHidden();

  await page.goto(story('reference-player--error-state'));
  await expect(page.locator(part('error'))).toBeVisible();

  const errorPlayer = await boxOf(page, '.reely-example');
  expect(covers(await boxOf(page, part('error')), errorPlayer)).toBe(true);
  expect(await paintsAtItsCentre(page, part('error'))).toBe(true);
  await expect(page.locator(part('controls'))).toBeHidden();
  await expect(page.locator(part('captions'))).toBeHidden();
});

test('the loading indicator is a full-bleed overlay while buffering and nothing while idle', async ({
  page
}) => {
  await page.goto(story('player-loadingindicator--buffering'));
  const indicator = page.locator(part('loading-indicator'));
  // #35's debounce: the state is only admitted after 500ms. Wait on the
  // attribute, never on a timeout — measured while planning, a bare `goto`
  // reads the 1x1 idle box and the test would assert the wrong thing.
  await expect(indicator).toHaveAttribute('data-state', 'buffering');

  const viewport = await boxOf(page, part('viewport'));
  expect(covers(await boxOf(page, part('loading-indicator')), viewport)).toBe(
    true
  );
  // Two halves, and they must disagree — that is the whole point of the
  // overlay. WITH the pointer-events lift it paints at its own centre, so it
  // really is the top layer. WITHOUT the lift the hit-test resolves straight
  // through it, so controls beneath a buffering overlay stay operable (#89
  // excluded `LoadingIndicator` from the layer it takes out of the page for
  // exactly this reason). Asserting only the first half proved nothing here:
  // measured by falsification, this story composes nothing under the overlay,
  // so `zIndex: 0` on `loadingOverlayStyle` still passed it.
  expect(await paintsAtItsCentre(page, part('loading-indicator'))).toBe(true);
  expect(await hitsThrough(page, part('loading-indicator'))).toBe(true);

  await page.goto(story('player-loadingindicator--loading-provider'));
  await expect(indicator).toHaveAttribute('data-state', 'loading-provider');

  // And the idle indicator must not own the viewport: it stays mounted so a
  // screen reader announces the transition, but as the 1x1 clipped box
  // `visuallyHiddenStyle` produces, not as a full-bleed layer.
  await page.goto(story('reference-player--composition'));
  await expect(page.locator(part('controls'))).toBeVisible();
  const idle = await boxOf(page, part('loading-indicator'));
  expect(idle.width * idle.height).toBeLessThanOrEqual(1);
});

test('the activation overlay owns the viewport before and after its click', async ({
  page
}) => {
  await page.goto(story('player-activationbutton--dormant'));
  await expect(page.locator(part('activation'))).toBeVisible();

  const viewport = await boxOf(page, part('viewport'));
  expect(covers(await boxOf(page, part('activation')), viewport)).toBe(true);
  expect(await paintsAtItsCentre(page, part('activation'))).toBe(true);

  // The story's own play function clicks it. No `Player.Media` is composed
  // there, so activation stops at `eligible` rather than reaching `ready` and
  // the overlay stays mounted — that is the story's documented point. The
  // post-interaction invariant is therefore that the overlay still owns the
  // viewport, not that it disappeared.
  await page.goto(story('player-activationbutton--activates-on-click'));
  await expect(page.locator(part('activation'))).toHaveAttribute(
    'data-state',
    'eligible'
  );
  const clicked = await boxOf(page, part('viewport'));
  expect(covers(await boxOf(page, part('activation')), clicked)).toBe(true);
  expect(await paintsAtItsCentre(page, part('activation'))).toBe(true);
});

test('the settings menu and the caption cue render as visible boxes', async ({
  page
}) => {
  await page.goto(story('player-settingsmenu--open'));
  await expect(page.locator(part('settings-menu'))).toBeVisible();
  expect(await paintsAtItsCentre(page, part('settings-menu'))).toBe(true);
  const menu = await boxOf(page, part('settings-menu'));
  expect(menu.width).toBeGreaterThan(0);
  expect(menu.height).toBeGreaterThan(0);
  // Three staged radio items, each with a box of its own — a menu that
  // collapsed to zero height would still satisfy the assertions above.
  const items = page.locator(part('menu-radio-item'));
  await expect(items).toHaveCount(3);
  for (let index = 0; index < 3; index += 1) {
    const box = await items.nth(index).boundingBox();
    expect(box?.height ?? 0).toBeGreaterThan(0);
  }

  await page.goto(story('player-captions--one-line'));
  await expect(page.locator(part('caption-cue'))).toBeVisible();
  const cue = await boxOf(page, part('caption-cue'));
  expect(cue.width).toBeGreaterThan(0);
  expect(cue.height).toBeGreaterThan(0);
  expect(covers(await boxOf(page, part('viewport')), cue)).toBe(true);
});

test('a non-recoverable error surface covers the viewport without a retry affordance', async ({
  page
}) => {
  await page.goto(story('player-errordisplay--not-recoverable'));
  await expect(page.locator(part('error'))).toBeVisible();

  expect(
    covers(
      await boxOf(page, part('error')),
      await boxOf(page, part('viewport'))
    )
  ).toBe(true);
  expect(await paintsAtItsCentre(page, part('error'))).toBe(true);
  // `recoverable: false`, so `ErrorDisplay` renders no retry button. Scoped to
  // the story root: Storybook's own chrome puts buttons in the document.
  await expect(page.locator(`${part('viewport')} button`)).toHaveCount(0);
});

test('the themed control row lays out with theme.css mounted', async ({
  page
}) => {
  // The only story that mounts `@reely/react/theme.css`. Deliberately not
  // asserting a background colour: measured, the themed row resolves
  // `rgba(0, 0, 0, 0)` — the theme styles the controls, not the bar.
  await page.goto(story('theme-theme--default'));
  await expect(page.locator(part('controls'))).toBeVisible();

  expect(await paintsAtItsCentre(page, part('controls'))).toBe(true);
  // No overflow assertion here. Measured: this row overflows by 5px at the
  // story's own width — a pre-existing, already-documented defect (see
  // `reference-player.tsx`'s note that "Theme/Theme still admits" a row that
  // overflowed by 49px once AirPlayButton made it six buttons). Asserting it
  // clean would fail on landing; asserting the 5px would freeze a defect as
  // the contract. The reference example, which is the artifact #32 reviews,
  // does carry the overflow assertion — at 320px, in the test above.
  for (const name of [
    'play-button',
    'mute-button',
    'captions-button',
    'pip-button',
    'airplay-button',
    'fullscreen-button'
  ]) {
    expect(
      await paintsAtItsCentre(page, `${part('controls')} ${part(name)}`),
      `${name} is covered by something`
    ).toBe(true);
  }
});

/**
 * The reviewer's-eye half. These five images are the only place anything in
 * this repo compares rendered output to a reference.
 *
 * Linux only, and that is not a preference: there is no docker on the
 * maintainer's machine, CI runs on `ubuntu-latest`, and macOS renders text
 * differently. The baselines are produced where they are compared. On macOS
 * these skip and the invariant layer above — which is what catches the bugs
 * this repo has actually had — still runs. Refresh procedure:
 * `.github/workflows/visual-baselines.yml`, documented in the root README.
 *
 * The stories are mock-decorated: no media element, no network, and a staged
 * `currentTime: 12` / `duration: 120`, so the pixels are deterministic by
 * construction. No masking and no seeking is needed.
 */
test.describe('reference example baselines', () => {
  test.skip(
    process.platform !== 'linux',
    'Baselines are generated on ubuntu-latest; macOS renders text differently. Run the visual-baselines workflow to refresh them.'
  );

  const shot = { animations: 'disabled' } as const;

  test('idle', async ({ page }) => {
    await page.goto(story('reference-player--idle'));
    await expect(page.locator(part('activation'))).toBeVisible();
    await expect(page.locator('.reely-example')).toHaveScreenshot(
      'reference-idle.png',
      shot
    );
  });

  test('composition', async ({ page }) => {
    await page.goto(story('reference-player--composition'));
    await expect(page.locator(part('caption-cue'))).toBeVisible();
    await expect(page.locator('.reely-example')).toHaveScreenshot(
      'reference-composition.png',
      shot
    );
  });

  test('settings menu open', async ({ page }) => {
    await page.goto(story('reference-player--composition'));
    await expect(page.locator(part('controls'))).toBeVisible();
    await page
      .locator(`${part('settings-menu-trigger')}[aria-label="Settings"]`)
      .click();
    await expect(page.locator(part('settings-menu'))).toHaveAttribute(
      'data-reely-menu',
      'open'
    );
    await expect(page.locator('.reely-example')).toHaveScreenshot(
      'reference-menu-open.png',
      shot
    );
  });

  test('narrow container', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto(story('reference-player--composition'));
    await page.addStyleTag({ content: '#storybook-root { width: 320px; }' });
    await expect(page.locator(part('volume-slider'))).toBeHidden();
    await expect(page.locator('.reely-example')).toHaveScreenshot(
      'reference-narrow.png',
      shot
    );
  });

  test('error state', async ({ page }) => {
    await page.goto(story('reference-player--error-state'));
    await expect(page.locator(part('error'))).toBeVisible();
    await expect(page.locator('.reely-example')).toHaveScreenshot(
      'reference-error.png',
      shot
    );
  });
});
