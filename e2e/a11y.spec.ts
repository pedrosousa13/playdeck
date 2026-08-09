import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import {
  captionsTrigger,
  controls,
  pipButton,
  playButton,
  settingsMenu,
  settingsTrigger
} from './locators';

// Mock-only #32 checks: the axe sweep, the reflow/hit-test cases, and the
// tab-order/menu-focus tests. Every state below is a MOCK story: no media, no
// network, and identical on every engine, which is what makes a fixed
// expectation honest here. Real-media checks (shortcut effects against an
// actual `<video>`) live in `e2e/a11y-media.spec.ts` instead — that suite
// depends on video decode timing and is inherently more flake-prone, so it is
// kept separate on purpose: a flake there must never read as a regression
// here, or vice versa. `!test` excludes a story from the Vitest run only —
// Storybook dev serves all of them, so Playwright can drive them too.
const story = (id: string) =>
  `/iframe.html?id=reference-player--${id}&viewMode=story`;

const composition = story('composition');

// The seven states #32 lists. They are seven states over five stories:
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
  // play" surface while idle (position: absolute; inset: 0; z-index: 30) —
  // genuinely rendered and meaningful, unlike LoadingIndicator's empty idle
  // case, so it cannot be visually hidden the same way. It used to carry a
  // color-contrast/bgOverlap entry because the example rendered the control
  // row underneath it; #89 ruled that a composition defect rather than a
  // primitive one — content under a pointer-capturing overlay is unreachable
  // but still tabbable — so the row is no longer rendered there and the
  // state is clean. The focus-reachability test below is what actually pins
  // that; this entry going away is the consequence.
  { name: 'idle', url: story('idle') },
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
  // an error exists (position: absolute; inset: 0; z-index: 40) — by design,
  // above everything else. Same #89 ruling as idle: the control row and the
  // caption layer are no longer rendered beneath it, so nothing is left for
  // axe to fail to resolve a background for.
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
      // The zero-violations claim below is only worth anything for
      // `scrollable-region-focusable` if the region actually scrolls. The
      // example bounds the menu at `max-height: 12rem; overflow-y: auto`, and
      // a rate list plus a quality ladder overflows that — but a CSS edit
      // could quietly take the overflow away and turn this state into a scan
      // of a rule that no longer applies. Pin it.
      const scroll = await settingsMenu(page).evaluate((el) => ({
        scrollHeight: el.scrollHeight,
        clientHeight: el.clientHeight,
        overflowY: getComputedStyle(el).overflowY
      }));
      expect(
        scroll.scrollHeight,
        `the menu must genuinely scroll for this state to exercise ` +
          `scrollable-region-focusable (overflow-y: ${scroll.overflowY})`
      ).toBeGreaterThan(scroll.clientHeight);
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

// WCAG 2.2 SC 2.4.11 Focus Not Obscured, asserted directly rather than
// inferred (#89).
//
// `idle` and `error` are the two states where a full-bleed, *pointer-
// capturing* overlay owns the viewport: `ActivationButton` is a real
// `<button>` at `inset: 0; z-index: 30`, and `ErrorDisplay` is an opaque
// surface at 40. Anything the example renders beneath one of them is
// invisible and unclickable while still being tabbable and still being
// announced — a keyboard user tabs into a play button that a click cannot
// reach.
//
// Axe only ever saw the shadow of this: it reported `color-contrast`
// (`bgOverlap`) on the time row, in `incomplete`, and said nothing about
// focus at all. Both of those entries are gone from `knownIncomplete` above
// now that the composition no longer renders the row underneath — but the
// axe equality alone would go green again if someone re-rendered the row and
// the overlay merely stopped being opaque. So the property is stated here as
// what it actually is: reachability.
//
// `LoadingIndicator` is deliberately not in this set. It sets
// `pointer-events: none`, so controls beneath it stay operable, and
// `elementFromPoint` is blind to it anyway.
for (const state of states.filter(
  (candidate) => candidate.name === 'idle' || candidate.name === 'error'
)) {
  test(`no focusable control is obscured in the ${state.name} state`, async ({
    page
  }) => {
    await page.goto(state.url);
    await expect(page.locator('[data-reely-part="viewport"]')).toBeVisible();

    const obscured = await page.evaluate(() => {
      const viewport = document.querySelector('[data-reely-part="viewport"]')!;
      const focusable = [
        ...viewport.querySelectorAll<HTMLElement>(
          'a[href], button, input, select, textarea, [tabindex]:not([tabindex="-1"])'
        )
      ]
        .filter((node) => !node.hasAttribute('disabled'))
        // Not rendered at all (`display: none`, which is how the example
        // takes the control row out of the page here) means not focusable
        // and nothing to obscure. A zero-size box would also make the
        // hit-test below meaningless rather than informative.
        .filter((node) => {
          const rect = node.getBoundingClientRect();
          return rect.width > 0 && rect.height > 0;
        });

      return focusable
        .map((node) => {
          const rect = node.getBoundingClientRect();
          const hit = document.elementFromPoint(
            rect.left + rect.width / 2,
            rect.top + rect.height / 2
          );
          return {
            part: node.getAttribute('data-reely-part') ?? node.tagName,
            label: node.getAttribute('aria-label'),
            reached: hit !== null && (hit === node || node.contains(hit)),
            resolvedTo:
              hit?.getAttribute('data-reely-part') ?? hit?.tagName ?? null
          };
        })
        .filter((result) => !result.reached);
    });

    expect(
      obscured,
      `every focusable element in the ${state.name} state must hit-test to ` +
        `itself; these did not`
    ).toEqual([]);
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

    // Hit-testable at its own center. Correct geometry is not enough: a
    // control row can have a perfectly unclipped bounding box and still be
    // painted underneath Gestures/Poster/Media, invisible and unclickable, if
    // it is not a *positioned* element (CSS 2.1 always paints in-flow,
    // non-positioned content before positioned content, regardless of
    // z-index or DOM order). That exact regression shipped past every
    // assertion above it in this file, past `toBeVisible()` (attached,
    // non-zero size, not display:none — it does not check what else is
    // painted on top), and past the 320px reflow fix's own author, so it is
    // hit-tested here explicitly rather than trusted to geometry.
    //
    // Note this proves hit-testability, not visual non-occlusion:
    // `elementFromPoint` is blind to `pointer-events: none`, and reely's own
    // overlays (`Player.Poster`, `Player.Captions`, the active
    // `LoadingIndicator`) all set it. A green result here does not mean
    // nothing is painted over the controls — only that the control itself
    // resolves at its own center.
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
  // The menu autofocuses its first item, so the scrollable container's
  // default tabIndex={0} is never the landing spot.
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

// #193. The composition used to carry its own `tabIndex={0}` on
// `SettingsMenuContent` precisely because the primitive shipped none, so the
// menu-open axe state above was green on a workaround rather than on the
// library. `SettingsMenuContent` now defaults it (`tabIndex ?? 0`, the shape
// `Player.Controls` already used) and the composition no longer sets it — this
// test is what stops the default being removed again and the violation
// returning silently: it asserts the attribute is on the element while no
// call site in `reference-player.tsx` supplies one, over both menus in the
// composition. `CaptionsMenu` is a preset over the same content primitive and
// renders it with no props at all, so it is the harder of the two.
test('the menu content root is keyboard-focusable without the composition supplying a tabIndex', async ({
  page
}) => {
  await page.goto(composition);
  await expect(controls(page)).toBeVisible();

  for (const openTrigger of [settingsTrigger, captionsTrigger]) {
    await openTrigger(page).click();
    await expect(settingsMenu(page)).toHaveAttribute('data-reely-menu', 'open');
    await expect(settingsMenu(page)).toHaveJSProperty('tabIndex', 0);
    await page.keyboard.press('Escape');
    await expect(settingsMenu(page)).toHaveCount(0);
  }
});
