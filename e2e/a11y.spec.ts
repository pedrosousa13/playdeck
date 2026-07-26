import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import {
  activationButton,
  captionsButton,
  controls,
  media,
  muteButton,
  pipButton,
  playButton,
  settingsMenu,
  settingsTrigger
} from './locators';

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

// WCAG 1.4.4 (resize text to 200%) and 1.4.10 (reflow at 320 CSS px) are two
// different criteria and passing one does not imply the other, so both are
// asserted — plus the combination. No single WCAG criterion demands 320px AND
// 200% together, but a mobile user at 320px with 200% text is a real user, and
// that combination is where this composition actually broke: measured on main,
// the 179px control row was clipped 35px by a 144px `aspect-ratio: 16/9`,
// `overflow: hidden` box.
const reflowCases = [
  { name: '200% text at 1280px (WCAG 1.4.4)', width: 1280, fontSize: '32px' },
  {
    name: '320px-equivalent width (WCAG 1.4.10)',
    width: 320,
    fontSize: '16px'
  },
  { name: '320px at 200% text', width: 320, fontSize: '32px' }
] as const;

for (const reflow of reflowCases) {
  test(`the composition reflows without loss of content: ${reflow.name}`, async ({
    page
  }) => {
    await page.setViewportSize({ width: reflow.width, height: 720 });
    await page.goto(composition);
    await expect(controls(page)).toBeVisible();

    // 200% text as a UA text-only zoom applies it: scale the root font size
    // against the measured 16px baseline. The example's layout is rem-based
    // (`max-width: 48rem`, buttons at `1.125rem`), so it scales with this.
    await page.evaluate((fontSize) => {
      document.documentElement.style.fontSize = fontSize;
    }, reflow.fontSize);

    // No two-dimensional scrolling.
    const doc = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth
    }));
    expect(doc.scrollWidth).toBeLessThanOrEqual(doc.clientWidth);

    // No clipping. This is the assertion the existing 320px test in
    // reference.spec.ts lacks: it measures horizontal overflow only, which is
    // why a 35px vertical clip survived it.
    const clip = await page.evaluate(() => {
      const viewport = document.querySelector('[data-reely-part="viewport"]')!;
      const row = document.querySelector('[data-reely-part="controls"]')!;
      const v = viewport.getBoundingClientRect();
      const r = row.getBoundingClientRect();
      return {
        clippedTopBy: Math.round(v.top - r.top),
        clippedBottomBy: Math.round(r.bottom - v.bottom),
        rowHeight: Math.round(r.height),
        viewportHeight: Math.round(v.height)
      };
    });
    expect(clip.clippedTopBy).toBeLessThanOrEqual(0);
    expect(clip.clippedBottomBy).toBeLessThanOrEqual(0);

    // No occlusion. Correct geometry is not enough: a control row can have a
    // perfectly unclipped bounding box and still be painted underneath
    // Gestures/Poster/Media, invisible and unclickable, if it is not a
    // *positioned* element (CSS 2.1 always paints in-flow, non-positioned
    // content before positioned content, regardless of z-index or DOM order).
    // That exact regression shipped past every assertion above it in this
    // file, past `toBeVisible()` (attached, non-zero size, not display:none —
    // it does not check what else is painted on top), and past the 320px
    // reflow fix's own author, so it is hit-tested here explicitly rather
    // than trusted to geometry.
    const playHandle = await playButton(page).elementHandle();
    if (playHandle === null) throw new Error('play button not found');
    const hit = await page.evaluate((play: Element) => {
      const r = play.getBoundingClientRect();
      const el = document.elementFromPoint(
        r.left + r.width / 2,
        r.top + r.height / 2
      );
      return {
        isPlayButtonOrDescendant:
          el !== null && (el === play || play.contains(el)),
        resolvedTag: el?.tagName ?? null,
        resolvedPart: el?.getAttribute('data-reely-part') ?? null
      };
    }, playHandle);
    expect(
      hit.isPlayButtonOrDescendant,
      `expected the play button's own center to hit-test to itself, but ` +
        `resolved to <${hit.resolvedTag}> data-reely-part="${hit.resolvedPart}" instead`
    ).toBe(true);
  });
}

// Measured identical on Chromium, Firefox and WebKit. `Player.Controls`
// defaults to `tabIndex={0}`, which is why the region itself is the first
// stop. Both the CaptionsMenu and the SettingsMenu trigger carry
// `data-reely-part="settings-menu-trigger"` — CaptionsMenu is a preset over
// SettingsMenu — so the two consecutive entries are not a duplicate.
const tabOrder = [
  'controls',
  'seek-slider-input',
  'play-button',
  'mute-button',
  'volume-slider',
  'captions-button',
  'settings-menu-trigger',
  'settings-menu-trigger',
  'pip-button',
  'airplay-button',
  'fullscreen-button'
] as const;

const focusedPart = (page: Page) =>
  page.evaluate(
    () => document.activeElement?.getAttribute('data-reely-part') ?? null
  );

test('every control in the composition is reachable by Tab, in composed order', async ({
  page
}) => {
  await page.goto(composition);
  await expect(controls(page)).toBeVisible();
  await page.evaluate(() => (document.body as HTMLElement).focus());

  const observed: Array<string | null> = [];
  for (let i = 0; i < tabOrder.length; i += 1) {
    await page.keyboard.press('Tab');
    observed.push(await focusedPart(page));
  }

  // Stops at `fullscreen-button` deliberately. Past the last control the
  // engines diverge — Chromium and WebKit move focus out of the page to the
  // browser chrome, Firefox under Playwright stays put — which is harness
  // behaviour, not a focus trap in the composition.
  expect(observed).toEqual([...tabOrder]);
});

test('the settings menu takes focus on open and gives it back on Escape', async ({
  page
}) => {
  await page.goto(composition);
  await expect(controls(page)).toBeVisible();

  await settingsTrigger(page).focus();
  await page.keyboard.press('ArrowDown');
  await expect(settingsMenu(page)).toHaveAttribute('data-reely-menu', 'open');
  // The menu autofocuses its first item, so the scrollable container's own
  // tabIndex={0} is never the landing spot.
  await expect(
    page.getByRole('menuitemradio', { name: '0.5×', exact: true })
  ).toBeFocused();

  await page.keyboard.press('Escape');
  await expect(settingsMenu(page)).toHaveCount(0);
  await expect(settingsTrigger(page)).toBeFocused();

  // Focus went back to the trigger, not to <body>, so the Tab walk resumes
  // from where it left off rather than restarting.
  await page.keyboard.press('Tab');
  await expect(pipButton(page)).toBeFocused();
});

// The `RealSources` story: real providers, real media. Driven on the local MP4
// leg only — the YouTube and Vimeo legs are @real and grep-inverted out of CI.
const realSources = story('real-sources');

// Both local fixtures are ~1 second long, so `data-state="playing"` is a state
// the clip leaves on its own and asserting it is a race. `currentTime > 0` is
// race-free: it stays true once ended.
const played = (page: Page) =>
  expect
    .poll(() => media(page).evaluate((el: HTMLVideoElement) => el.currentTime))
    .toBeGreaterThan(0);

test('keyboard shortcuts reach the media element, not just the DOM', async ({
  page
}) => {
  await page.goto(realSources);
  await activationButton(page).click();
  await played(page);

  // Shortcuts are scoped to the controls region, so focus must be inside it.
  await controls(page).focus();

  await page.keyboard.press('m');
  await expect(muteButton(page)).toHaveAttribute('data-state', 'muted');
  await expect(
    media(page).evaluate((el: HTMLVideoElement) => el.muted)
  ).resolves.toBe(true);

  await page.keyboard.press('m');
  await expect(muteButton(page)).toHaveAttribute('data-state', 'unmuted');

  // The <track> the example declares through Media's children; its `default`
  // flag selects it on load, so the first press turns captions off. The
  // custom caption renderer keeps a selected track's native mode `hidden`
  // (the overlay draws it, not the browser) and an unselected one `disabled`
  // — read here off the real `TextTrack`, not just the button's own label.
  const trackMode = () =>
    media(page).evaluate(
      (el: HTMLVideoElement) => el.textTracks[0]?.mode ?? null
    );
  await expect(captionsButton(page)).toHaveAttribute('data-state', 'on');
  await expect.poll(trackMode).toBe('hidden');
  await page.keyboard.press('c');
  await expect(captionsButton(page)).toHaveAttribute('data-state', 'off');
  await expect.poll(trackMode).toBe('disabled');
  await page.keyboard.press('c');
  await expect(captionsButton(page)).toHaveAttribute('data-state', 'on');
  await expect.poll(trackMode).toBe('hidden');
});

test('arrow-key seeking moves the media element', async ({ page }) => {
  await page.goto(realSources);
  await activationButton(page).click();
  await played(page);
  await controls(page).focus();

  // Pause first. While the clip is still playing, seeking to 0 does not
  // settle there — playback resumes forward from 0 in real time, and on a
  // poll long enough it re-reaches the natural end (observed: currentTime
  // lands back at 1, not 0). `k` pauses through the same shortcut handler
  // this test exercises, giving seekBy(-5)'s clamp-at-0 a floor that holds.
  await page.keyboard.press('k');
  await expect
    .poll(() => media(page).evaluate((el: HTMLVideoElement) => el.paused))
    .toBe(true);

  // The fixture is ~1s and `seekBy(-5)` clamps at 0, so seeking BACKWARD to a
  // known floor is the deterministic direction on a clip this short —
  // seeking forward races the clip ending on its own.
  await page.keyboard.press('ArrowLeft');
  await expect
    .poll(() => media(page).evaluate((el: HTMLVideoElement) => el.currentTime))
    .toBe(0);
});
