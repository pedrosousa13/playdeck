# Two player themes over one control bar: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix theme.css's three filed defects (#541, #552, #555), give it an auto-hiding, wrapping, volume-aware control bar, and ship a second, standalone theme, `docked.css`, that lays the same markup out under the picture instead of over it.

**Architecture:** Both themes style the same unchanged primitive markup through `data-playdeck-part` attributes; the only new DOM output is `data-idle` on `Viewport`, written imperatively the way `--playdeck-media-aspect-ratio` already is, so the CSS-only auto-hide costs nothing beyond a timer. `docked.css` shares no `@import` and no token declaration with `theme.css` -- it repeats the parts of the contract both themes need (buttons, sliders, menus) with its own colour defaults, wrapped in a `@media (prefers-color-scheme: dark)` block for the dark half of each token.

**Tech Stack:** `packages/react` (CSS, TSX primitives), Vitest (unit + the parameterised stylesheet contract suite), Playwright (`e2e/`), the Storybook workbench under `apps/storybook`, `scripts/bundle-budgets.mjs` and `scripts/verify-packaging.mjs`.

**Spec:** `docs/superpowers/specs/2026-09-02-player-themes-design.md`. Read it before starting. Every ruling in it has been approved and is not yours to revisit.

---

## Before you start

Two things worth knowing going in:

- **`[data-playdeck-part='controls']` carries no `position` today, and this plan never gives it one.** Neither `theme.css` nor `Controls` (`controls.tsx`) sets one -- the "floating" look comes from wherever a consumer positions the region, not from the theme, and every rule in `theme.css` is a `:where()` selector inside `@layer playdeck`, which loses to any unlayered consumer rule whatever its specificity (rule 1 in the file's own header comment). A `position: static` written there to "cancel" a consumer's own absolute placement would therefore only ever win against another `:where()`-in-a-layer rule, never against the ordinary unlayered CSS a real composition uses to float the bar in the first place -- `apps/storybook/stories/reference/reference-player.tsx`'s own `.playdeck-example-controls { position: absolute; ... }` is exactly that shape, and it is why that file reaches for a `@container` query rather than a theme rule when it needs different layout at a narrow width. `theme.css`'s only job below 48rem is to swap the scrim for a flat surface colour and hide the volume slider; it makes no attempt to move the bar out of an overlay position, above or below that width. Docking the bar for real -- never positioning it over the picture to begin with -- is what `docked.css` is for.
- **`docked.css` and `theme.css` both open `@layer playdeck`.** Two files declaring the same layer name merge into one layer rather than shadowing each other, so a fixture page that imports both at once would have the two files' rules for the same selector competing on source order alone -- not what either the packaging check or a real consumer wants. Task 12's fixture is two separate pages for exactly this reason, one per stylesheet, never both on the same page.

---

## File structure

**Created**

| File | Responsibility |
| --- | --- |
| `packages/react/docked.css` | The second theme: same contract, no overlay, no auto-hide, light/dark tokens |
| `tests/packaging/fixture/docked.html`, `tests/packaging/fixture/src/docked.tsx` | A second packaging fixture page proving `@playdeck/react/docked.css` resolves and paints |

**Modified**

| File | Change |
| --- | --- |
| `packages/react/theme.css` | #541 (`display: block` on the range inputs), #552 (activation min-size floor), #555 (activation fill/border tokens), `flex-wrap` row split, volume hover-expand, auto-hide, the below-48rem scrim/volume fallback |
| `packages/react/src/loading-error.tsx` | `ActivationButton`'s inline style gains `--playdeck-activation-fill`/`--playdeck-activation-border` |
| `packages/react/src/viewport-media.tsx` | `Viewport` gains the idle timer and writes `data-idle` |
| `packages/react/test/theme.test.ts` | Parameterised over a stylesheet fixture list; `docked.css` joins it in task 11 |
| `packages/react/package.json` | `./docked.css` in `exports` and `files` |
| `apps/storybook/stories/seek-slider.stories.tsx` | A second story with a different inherited font, for the #541 vertical-centre check |
| `apps/storybook/.storybook/theme.tsx`, `apps/storybook/.storybook/preview.tsx` | A third toolbar Theme value, `docked`, mounting `docked.css` the same way `themed` already mounts `theme.css` |
| `e2e/thumb-contrast.spec.ts` | The #541 vertical-centre assertion, under both seek-slider stories |
| `e2e/theme-idle.spec.ts` | Auto-hide behaviour: fades after idle, returns on pointermove, never hides while paused, stays visible on focus-within |
| `e2e/a11y.spec.ts` | The nine states scanned again under the `docked` toolbar value |
| `scripts/bundle-budgets.mjs` | A `targets` entry for `@playdeck/react/docked.css` |
| `scripts/verify-packaging.mjs` | A second page load in `smokeTest`, against the new fixture |
| `.changeset/*.md` | One changeset, `@playdeck/react` minor |

---

### Task 1: Parameterise `theme.test.ts` over a stylesheet fixture

`docked.css` does not exist yet, so this task only restructures the file around a one-entry fixture list (`theme.css`); task 11 appends the `docked.css` entry once that file exists. No test's expectations change here, only how they are reached.

**Files:**
- Modify: `packages/react/test/theme.test.ts`

- [ ] **Step 1: Record the baseline**

```bash
pnpm vitest run packages/react/test/theme.test.ts
```

Note the test count (13 tests as of this plan: 10 inside `describe('theme contract', ...)`, 2 inside `describe('slider non-text contrast', ...)`, 1 inside `describe('headless import chain', ...)`). The refactor below must reproduce it.

- [ ] **Step 2: Wrap the file-shaped tests in a fixture loop**

At the top of the file, keep the module-scope `themeSource` read and its `withoutComments` derivation exactly as they are -- `tokenDefault`, below the loop, closes over that module-scope `withoutComments` (not over `themeSource`), and removing it stops the file compiling. Replace only the module-scope `selectorLists` derivation with a fixture type and a one-entry array; `selectorLists` moves inside the loop in step 3 below, derived per fixture instead of once for `theme.css` alone.

```ts
type StylesheetFixture = {
  readonly label: string;
  readonly source: string;
  readonly exportPath: string;
  readonly expected: {
    readonly atRules: readonly string[];
    readonly pseudoFunctions: readonly string[];
    readonly pseudoElements: readonly string[];
    readonly functions: readonly string[];
    // The needle list `leaves every hand-drawn slider rule out of
    // forced-colors mode` checks for, inside and outside the
    // `(forced-colors: none)` query. Per file because a stylesheet that
    // declares a forced-colors rule for a different set of parts needs a
    // different needle list, even where the mechanism is the same CSS.
    readonly forcedColorsSliderNeedles: readonly string[];
  };
};

const themeSource = await readFile(
  new URL('../theme.css', import.meta.url),
  'utf8'
);

const fixtures: readonly StylesheetFixture[] = [
  {
    label: 'theme.css',
    source: themeSource,
    exportPath: './theme.css',
    expected: {
      atRules: ['layer', 'media'],
      pseudoFunctions: ['where'],
      pseudoElements: [
        '-moz-range-progress',
        '-moz-range-thumb',
        '-moz-range-track',
        '-webkit-slider-thumb'
      ],
      functions: ['calc', 'env', 'linear-gradient', 'rgb', 'var'],
      forcedColorsSliderNeedles: [
        '::-moz-range-track',
        '::-moz-range-progress',
        '::-moz-range-thumb',
        'appearance: none',
        ":where([data-playdeck-part='seek-slider-input']) {",
        ":where([data-playdeck-part='seek-progress']) {",
        ":where([data-playdeck-part='seek-slider-input'])::-webkit-slider-thumb"
      ]
    }
  }
  // `docked.css` joins this list in task 11, once the file and its own
  // expected inventory exist.
];
```

- [ ] **Step 3: Move the file-shaped tests inside `describe.each(fixtures)`**

Every test that currently closes over the module-level `themeSource`/`withoutComments`/`selectorLists` moves inside one `describe.each`, deriving `withoutComments` and `selectorLists` per fixture instead of once at module scope:

```ts
describe.each(fixtures)('$label contract', ({ source, exportPath, expected }) => {
  const withoutComments = source.replace(/\/\*[\s\S]*?\*\//g, '');
  const selectorLists = [...withoutComments.matchAll(/([^{}]+)\{/g)]
    .map(([, selector]) => selector.trim())
    .filter((selector) => selector.length > 0 && !selector.startsWith('@'));

  test('every rule lives inside the playdeck cascade layer', () => {
    // unchanged body, reading `withoutComments` from this closure
  });

  test('uses only the CSS features the declared support floor covers', () => {
    const atRules = new Set(
      [...withoutComments.matchAll(/@([a-z-]+)/g)].map(([, name]) => name)
    );
    const pseudoFunctions = new Set(
      [...withoutComments.matchAll(/:([a-z-]+)\(/g)].map(([, name]) => name)
    );
    const pseudoElements = new Set(
      [...withoutComments.matchAll(/::([a-z-]+)/g)].map(([, name]) => name)
    );
    const functions = new Set(
      [...withoutComments.matchAll(/(?<![\w-:])([a-z-]+)\(/g)]
        .map(([, name]) => name)
        .filter((name) => !pseudoFunctions.has(name))
    );
    expect([...atRules].sort()).toEqual(expected.atRules);
    expect([...pseudoFunctions].sort()).toEqual(expected.pseudoFunctions);
    expect([...pseudoElements].sort()).toEqual(expected.pseudoElements);
    expect([...functions].sort()).toEqual(expected.functions);
  });

  test('every selector is specificity-zero via :where()', () => {
    // unchanged body
  });

  test('every button-shaped part is carried by every button rule', () => {
    // unchanged body
  });

  test('declares no !important', () => {
    expect(withoutComments).not.toMatch(/!\s*important/i);
  });

  test('disables nonessential motion under prefers-reduced-motion', () => {
    expect(withoutComments).toMatch(
      /@media\s*\(\s*prefers-reduced-motion\s*:\s*reduce\s*\)/
    );
  });

  test('keeps control states distinguishable in forced-colors mode', () => {
    expect(withoutComments).toMatch(/@media\s*\(\s*forced-colors\s*:\s*active/);
  });

  test('leaves every hand-drawn slider rule out of forced-colors mode', () => {
    // unchanged walk-to-matching-brace body, but using
    // `expected.forcedColorsSliderNeedles` in place of the inline `names`
    // array
  });

  test(`is reachable as @playdeck/react${exportPath} and shipped in the tarball`, async () => {
    const manifest = JSON.parse(
      await readFile(new URL('../package.json', import.meta.url), 'utf8')
    ) as { exports: Record<string, unknown>; files: string[] };
    expect(manifest.exports[exportPath]).toBe(exportPath);
    expect(manifest.files).toContain(exportPath.replace(/^\.\//, ''));
  });
});
```

Everything that is NOT keyed to one file's own source -- `declares every exported stylesheet to have side effects`, the `slider non-text contrast` describe (built on `tokenDefault`, which takes a single token name and closes over the module-scope `withoutComments`, not over `themeSource`), and `headless import chain` -- stays exactly where it is, outside the loop, reading `themeSource`/`withoutComments` from the module-level constants as before.

- [ ] **Step 4: Run and confirm the count is unchanged**

```bash
pnpm vitest run packages/react/test/theme.test.ts
```

Expected: the same test count from step 1, now reported under a `theme.css contract` describe block instead of the old `theme contract` one (the ten tests that lived directly in it were already grouped, just under the file's one implicit fixture rather than a named one). If any test's body silently changed behaviour (a `themeSource` reference left un-renamed to `source`, for instance), it fails here rather than later.

- [ ] **Step 5: Commit**

```bash
git add packages/react/test/theme.test.ts
git commit -m "parameterise theme.test.ts's file-shaped suites over a stylesheet fixture"
```

---

### Task 2: Extract and prove the `:where()` stripper at three levels of nesting

The stripper already loops (`do { ... } while (stripped !== previous)`), stripping one complete, unnested `:where(...)` group per pass and re-scanning until nothing changes -- which already converges on any nesting depth, one layer at a time. What is missing is a name to test it under and a test proving it, not a change to the algorithm.

**Files:**
- Modify: `packages/react/test/theme.test.ts`

- [ ] **Step 1: Write the test**

This is not a red/green step: the stripper's own `do { ... } while (stripped !== previous)` loop already converges at any nesting depth, one layer at a time, so the test below is expected to pass the first time it runs. What is being added is a name for the stripper and a test proving the depth claim, not a behaviour change.

Above the `describe.each` block, extract the stripper into a named, exported-from-the-test-file function and add a unit test for it:

```ts
/**
 * Strips every `:where(...)` group from a selector, including one nested
 * inside another to any depth. One pass removes only the innermost complete
 * group (a `:where(...)` whose contents themselves hold no unstripped
 * `:where(`), so the surrounding loop reruns until nothing more changes --
 * which is what makes depth unbounded rather than fixed at one level.
 */
export const stripWhereGroups = (selector: string): string => {
  let stripped = selector;
  let previous: string;
  do {
    previous = stripped;
    stripped = stripped.replace(/:where\((?:[^()]|\([^()]*\))*\)/g, '');
  } while (stripped !== previous);
  return stripped;
};

test('stripWhereGroups removes :where() nested three deep', () => {
  expect(
    stripWhereGroups(":where(a :where(b :where(c)))").trim()
  ).toBe('');
});
```

- [ ] **Step 2: Run it and confirm it passes**

```bash
pnpm vitest run packages/react/test/theme.test.ts -t "nested three deep"
```

Expected: PASS, on the first run. The loop already handles it; this step confirms that rather than discovering a bug. If it fails, the fix is widening the inner alternation from one level of nested parens (`\([^()]*\)`) to two before the outer loop runs, but the loop's own convergence should make that unnecessary -- read the failure before touching the regex.

- [ ] **Step 3: Point `every selector is specificity-zero via :where()` at the extracted function**

Inside the `describe.each` body, replace the inlined stripping loop in that test with a call to `stripWhereGroups`, so the production logic and the tested logic are the same function rather than two copies that could drift:

```ts
test('every selector is specificity-zero via :where()', () => {
  expect(selectorLists.length).toBeGreaterThan(0);
  const offenders = selectorLists.filter((selector) => {
    let stripped = stripWhereGroups(selector);
    for (const exempt of [
      '::-webkit-slider-thumb',
      '::-moz-range-track',
      '::-moz-range-progress',
      '::-moz-range-thumb'
    ])
      stripped = stripped.split(exempt).join('');
    return /[.#[]|::?[a-z]|[a-z]/i.test(stripped.replace(/[\s,>+~*]/g, ''));
  });
  expect(offenders).toEqual([]);
});
```

- [ ] **Step 4: Run the whole file and commit**

```bash
pnpm vitest run packages/react/test/theme.test.ts
git add packages/react/test/theme.test.ts
git commit -m "extract theme.test.ts's :where() stripper and prove it at three levels of nesting"
```

---

### Task 3: Fix #541 (the seek thumb never sits on its track)

**Files:**
- Modify: `packages/react/theme.css`
- Modify: `apps/storybook/stories/seek-slider.stories.tsx`
- Modify: `e2e/thumb-contrast.spec.ts`

- [ ] **Step 1: Add the second Storybook story, with a different inherited font**

In `apps/storybook/stories/seek-slider.stories.tsx`, add an export after `WithBufferedRanges`. It renders the same fixture but wraps it in a wider inherited font, since the #541 defect scales with the consumer's font size:

```tsx
/**
 * The same fixture as `WithBufferedRanges`, under a deliberately different
 * inherited font. #541: the input sits on a text baseline and gains a
 * descender gap below it, so the offset between `seek-buffered`'s 50% and the
 * input's own centre is a function of the consumer's font -- this is the
 * fixture `e2e/thumb-contrast.spec.ts` points its second measurement at, so
 * the fix is checked at more than one font size and not only Storybook's own
 * default.
 */
export const WithBufferedRangesLargeInheritedFont: Story = {
  render: () => (
    <Player.Viewport
      style={{
        width: 480,
        height: 270,
        background: '#0b0e13',
        fontFamily: 'Georgia, serif',
        fontSize: '32px'
      }}
    >
      <Player.SeekSlider style={{ width: '90%', margin: '2rem auto' }} />
    </Player.Viewport>
  ),
  parameters: ready(
    { seek: available },
    {
      currentTime: 30,
      duration: 100,
      buffered: [
        { start: 0, end: 45 },
        { start: 60, end: 80 }
      ]
    }
  )
};
```

- [ ] **Step 2: Write the failing e2e assertion**

In `e2e/thumb-contrast.spec.ts`, reuse the file's own per-row sampling helper, `centreRow` (already used the same way by `'the seek slider clears 3:1 on both sides of its thumb...'`), rather than comparing `boundingBox()` rectangles directly -- a bounding-box comparison never samples a pixel, so it cannot tell a coincidence in one engine's box model from the fix `display: block` actually makes. Sampling the row through `seek-buffered`'s own centre line and checking the thumb ring is still exactly there is what proves the input's rendered centre, its painted fill, and `seek-buffered` all agree:

```ts
/**
 * #541: `seek-buffered` sits at the container's own 50%, and before the fix
 * the input's rendered box was taller than the container by a font-dependent
 * descender gap, so the input's own centre -- and the thumb painted on it --
 * drifted below that 50% line. Sampling the row through `seek-buffered`'s own
 * centre and looking for the thumb ring there is what tells a coincidence
 * from a fix: if the thumb has drifted off that row, the darkest pixel in the
 * window is whatever the track or the loaded range paints, never the ring's
 * `#000`. After `display: block` the input has no line box and its rendered
 * height equals the container's, so the ring is still exactly on that row --
 * checked under two different inherited fonts, since the drift is a function
 * of the font and one story alone could not tell a coincidence from a fix.
 */
const assertThumbOnTrack = async (page: Page, storyId: string) => {
  await page.goto(themedStory(storyId));
  const row = await centreRow(
    page,
    '[data-playdeck-part="seek-slider-input"]',
    '[data-playdeck-part="seek-buffered"]'
  );
  // Same construction as `'the seek slider clears 3:1...'` below: value 30 of
  // 100, over a thumb `--playdeck-slider-thickness * 4` (16px) wide, so its
  // centre sits at `half + fraction * (width - thumb)`. Reused as a helper
  // rather than restated, since both stories share the same value and only
  // the container width differs.
  const thumbCentre = 8.5 + 0.3 * (row.widthPx - 17);
  const ring = row.darkestAround(thumbCentre, 12);
  expect({
    red: Math.round(ring.red * 255),
    green: Math.round(ring.green * 255),
    blue: Math.round(ring.blue * 255)
  }).toEqual({ red: 0, green: 0, blue: 0 });
};

test('the seek input sits on its own track at the default inherited font', async ({
  page
}) => {
  await assertThumbOnTrack(page, 'player-seekslider--with-buffered-ranges');
});

test('the seek input sits on its own track under a different inherited font', async ({
  page
}) => {
  await assertThumbOnTrack(
    page,
    'player-seekslider--with-buffered-ranges-large-inherited-font'
  );
});
```

- [ ] **Step 3: Run it and watch it fail**

```bash
pnpm exec playwright test e2e/thumb-contrast.spec.ts -g "sits on its own track" --project=chromium
```

Expected: both new tests FAIL (the sampled row misses the ring, so the darkest pixel in the window is the track or loaded range instead of `#000`), the five pre-existing tests in the file still PASS.

- [ ] **Step 4: Apply the fix**

In `packages/react/theme.css`, in the shared range-input rule:

```css
  :where(
    [data-playdeck-part='seek-slider-input'],
    [data-playdeck-part='volume-slider']
  ) {
    display: block;
    inline-size: 100%;
    margin: 0;
    accent-color: var(--playdeck-color-accent, #3ea6ff);
    background-color: transparent;
    cursor: pointer;
  }
```

(Only `display: block;` is new; the rest is unchanged.)

- [ ] **Step 5: Run it and watch it pass**

```bash
pnpm exec playwright test e2e/thumb-contrast.spec.ts --project=chromium
```

Expected: all 7 tests in the file PASS (5 pre-existing plus the 2 added here).

- [ ] **Step 6: Commit**

```bash
git add packages/react/theme.css apps/storybook/stories/seek-slider.stories.tsx e2e/thumb-contrast.spec.ts
git commit -m "fix #541: display:block on the range inputs so the thumb sits on its track"
```

---

### Task 4: Fix #552 (the activation part sized unconditionally)

**Files:**
- Modify: `packages/react/theme.css`
- Modify: `packages/react/test/theme.test.ts`

- [ ] **Step 1: Write the failing test**

Inside the `describe.each` block in `theme.test.ts` (so it runs against every fixture, `docked.css` included once task 11 adds it), add:

```ts
  test('sizes the activation part with a min-* floor, not a fixed size', () => {
    const activationRule = withoutComments.match(
      /:where\(\[data-playdeck-part='activation'\]\)\s*\{[^}]*\}/
    )?.[0];
    expect(activationRule).toBeDefined();
    expect(activationRule).toMatch(/box-sizing:\s*border-box/);
    expect(activationRule).toMatch(
      /min-inline-size:\s*var\(--playdeck-activation-size,\s*4rem\)/
    );
    expect(activationRule).toMatch(
      /min-block-size:\s*var\(--playdeck-activation-size,\s*4rem\)/
    );
    expect(activationRule).toMatch(/padding-inline:\s*var\(--playdeck-space-3/);
    expect(activationRule).not.toMatch(/(?<!min-)inline-size:\s*4rem/);
    expect(activationRule).not.toMatch(/(?<!min-)block-size:\s*4rem/);
  });
```

- [ ] **Step 2: Run it and watch it fail**

```bash
pnpm vitest run packages/react/test/theme.test.ts -t "min-\* floor"
```

Expected: FAIL, the current rule has none of the new declarations.

- [ ] **Step 3: Apply the fix**

In `packages/react/theme.css`:

```css
  :where([data-playdeck-part='activation']) {
    display: grid;
    place-items: center;
    box-sizing: border-box;
    min-inline-size: var(--playdeck-activation-size, 4rem);
    min-block-size: var(--playdeck-activation-size, 4rem);
    padding-inline: var(--playdeck-space-3, 0.75rem);
    border: 0;
    border-radius: 2rem;
    color: var(--playdeck-color-on-surface, #fff);
    background-color: var(--playdeck-color-surface, rgb(0 0 0 / 0.72));
    cursor: pointer;
    transition: opacity var(--playdeck-transition-duration, 150ms)
      var(--playdeck-transition-easing, ease);
  }
```

And in the header comment's token table, under `Controls`, add the new token next to `--playdeck-control-size`:

```
 *                --playdeck-activation-size     4rem
```

- [ ] **Step 4: Run it and watch it pass**

```bash
pnpm vitest run packages/react/test/theme.test.ts
```

Expected: full file green.

- [ ] **Step 5: Commit**

```bash
git add packages/react/theme.css packages/react/test/theme.test.ts
git commit -m "fix #552: floor the activation part's size instead of fixing it"
```

---

### Task 5: Fix #555 (a bare player draws an opaque button over its poster)

**Files:**
- Modify: `packages/react/src/loading-error.tsx`
- Modify: `packages/react/theme.css`
- Modify: `packages/react/test/style-precedence.test.tsx` -- `packages/react/test/loading-error.test.tsx` does not exist. `style-precedence.test.tsx` already carries `ActivationButton`'s geometry test (`'ActivationButton geometry is a default the consumer can override'`, the assertion idiom at that file's line 110-112), so this is the file's real home; add the new test beside that one rather than starting a second file.

- [ ] **Step 1: Write the failing test**

Add to `packages/react/test/style-precedence.test.tsx`:

```tsx
test('replaces the UA default paint with tokens a stylesheet can still reach', async () => {
  render(
    <Player.Root loading="interaction" source="/tracer.mp4">
      <Player.Viewport>
        <Player.ActivationButton />
      </Player.Viewport>
    </Player.Root>
  );
  const button = screen.getByRole('button');
  // happy-dom validates a `background-color`-typed longhand against a fixed
  // colour grammar that does not recognise the two-argument
  // `var(name, fallback)` form and silently drops the whole declaration
  // rather than storing it -- confirmed against this repo's pinned happy-dom
  // (20.8.9): `el.style.backgroundColor = 'var(--x, red)'` leaves
  // `el.style.backgroundColor` at `''` and the declaration list at length 0,
  // even though a real browser stores and serialises it unchanged. `border`,
  // set as the shorthand, does not go through that per-property validation --
  // it copies its raw text into its three longhands verbatim -- so
  // `button.style.borderColor` is what actually observes it; a bare
  // `button.style.border` read (the shorthand itself) does not round-trip
  // either, for the ordinary reason a shorthand getter has to re-serialise
  // from parsed longhands and happy-dom's serialiser does not special-case a
  // `var()`-only value the way a browser's does.
  expect(button.style.borderColor).toBe(
    'var(--playdeck-activation-border, 0)'
  );
  // The fill token has no such longhand to fall back on -- `background-color`
  // is already a leaf property, and every property this test tried on it
  // (`background`, `backgroundColor`, `setProperty`, `cssText`, plain
  // assignment) hit the same validation gap. Checked against the primitive's
  // own source text instead, the same way `theme.test.ts` checks `theme.css`
  // for a declaration a DOM render can't observe in this environment.
  const source = await readFile(
    new URL('../src/loading-error.tsx', import.meta.url),
    'utf8'
  );
  expect(source).toMatch(
    /backgroundColor:\s*['"]var\(--playdeck-activation-fill,\s*transparent\)['"]/
  );
});
```

Add `import { readFile } from 'node:fs/promises';` and `import { URL } from 'node:url';` to this file's imports alongside the existing ones -- neither is there today.

- [ ] **Step 2: Run it and watch it fail**

```bash
pnpm vitest run packages/react/test/style-precedence.test.tsx -t "replaces the UA default"
```

Expected: FAIL, both assertions -- `button.style.borderColor` and the source-text match -- read empty or absent today, since `ActivationButton` writes no `background`/`border` style at all yet.

- [ ] **Step 3: Apply the primitive change**

In `packages/react/src/loading-error.tsx`:

```ts
const activationOverlayStyle: CSSProperties = {
  position: 'absolute',
  inset: 0,
  margin: 'auto',
  zIndex: 30,
  backgroundColor: 'var(--playdeck-activation-fill, transparent)',
  border: 'var(--playdeck-activation-border, 0)'
};
```

- [ ] **Step 4: Declare the two tokens on the theme's activation rule**

In `packages/react/theme.css`, replace the rule's own `border: 0;` and `background-color: var(--playdeck-color-surface, ...)` lines with the two token declarations, so the badge is unchanged in appearance but the colour now comes from the inline style reading them:

```css
  :where([data-playdeck-part='activation']) {
    display: grid;
    place-items: center;
    box-sizing: border-box;
    min-inline-size: var(--playdeck-activation-size, 4rem);
    min-block-size: var(--playdeck-activation-size, 4rem);
    padding-inline: var(--playdeck-space-3, 0.75rem);
    border-radius: 2rem;
    color: var(--playdeck-color-on-surface, #fff);
    --playdeck-activation-fill: var(--playdeck-color-surface, rgb(0 0 0 / 0.72));
    --playdeck-activation-border: 0;
    cursor: pointer;
    transition: opacity var(--playdeck-transition-duration, 150ms)
      var(--playdeck-transition-easing, ease);
  }
```

- [ ] **Step 5: Name the exception in the header comment**

Near rule 3 in `theme.css`'s header comment (the "every token is read as `var(--name, default)` and never declared" rule), add:

```
 *   Two tokens break rule 3 on purpose: `--playdeck-activation-fill` and
 *   `--playdeck-activation-border` are DECLARED on
 *   `[data-playdeck-part='activation']`, not only read. `ActivationButton`
 *   writes its background and border inline as `var()` reads of these two
 *   names so a bare player never paints the UA's own button face over its
 *   poster (#555); declaring them here is what lets a consumer's own
 *   ancestor-set value still lose to a value set on the part itself, the same
 *   way any CSS custom property resolves -- the nearest declaration in the
 *   inheritance chain wins, and a declaration on the element is nearer than
 *   one above it.
```

- [ ] **Step 6: Run everything touched and watch it pass**

```bash
pnpm vitest run packages/react/test/style-precedence.test.tsx packages/react/test/theme.test.ts
```

Expected: green. (`theme.test.ts`'s `slider non-text contrast` describe reads `--playdeck-color-backdrop`/`-track`/etc, none of which moved, so it is unaffected.)

- [ ] **Step 7: Commit**

```bash
git add packages/react/src/loading-error.tsx packages/react/theme.css packages/react/test/style-precedence.test.tsx
git commit -m "fix #555: paint the activation button from tokens instead of the UA default"
```

---

### Task 6: The control bar rows

**Files:**
- Modify: `packages/react/theme.css`
- Modify: `packages/react/test/theme.test.ts`

- [ ] **Step 1: Write the failing tests**

Inside `describe.each`:

```ts
  test('wraps the control bar and gives the seek slider its own row', () => {
    const controlsRule = withoutComments.match(
      /:where\(\[data-playdeck-part='controls'\]\)\s*\{[^}]*\}/
    )?.[0];
    expect(controlsRule).toMatch(/flex-wrap:\s*wrap/);
    const seekRule = withoutComments.match(
      /:where\(\[data-playdeck-part='seek-slider'\]\)\s*\{[^}]*\}/
    )?.[0];
    expect(seekRule).toMatch(/flex:\s*1\s+1\s+100%/);
  });

  test('pushes the trailing controls to the end with the duration Time', () => {
    expect(withoutComments).toMatch(
      /\[data-playdeck-part='time'\]\[data-time-type='duration'\][^{]*\{[^}]*margin-inline-end:\s*auto/
    );
  });
```

- [ ] **Step 2: Run and watch them fail**

```bash
pnpm vitest run packages/react/test/theme.test.ts -t "wraps the control bar"
pnpm vitest run packages/react/test/theme.test.ts -t "pushes the trailing controls"
```

- [ ] **Step 3: Apply the fix**

In `packages/react/theme.css`, add `flex-wrap: wrap;` to the `[data-playdeck-part='controls']` rule (right after `display: flex;`), change the seek slider rule's `flex: 1 1 auto;` to `flex: 1 1 100%;`, and add a new rule after the existing `[data-playdeck-part='time']` rule:

```css
  :where(
    [data-playdeck-part='time'][data-time-type='duration']
  ) {
    margin-inline-end: auto;
  }
```

- [ ] **Step 4: Run and watch them pass, then run the full file**

```bash
pnpm vitest run packages/react/test/theme.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add packages/react/theme.css packages/react/test/theme.test.ts
git commit -m "wrap the control bar, give the seek slider its own row, and push trailing controls to the end"
```

---

### Task 7: Volume -- reserved width, hover/focus-within reveal, coarse pointer hides it

**Files:**
- Modify: `packages/react/theme.css`
- Modify: `packages/react/test/theme.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
  test('hides the volume slider at rest on a fine pointer and reveals it on hover or focus', () => {
    expect(withoutComments).toMatch(
      /@media\s*\(\s*pointer:\s*fine\s*\)\s*\{[^]*?opacity:\s*0;[^]*?pointer-events:\s*none;[^]*?\}/
    );
    expect(withoutComments).toMatch(
      /mute-button'\]:hover \+ \[data-playdeck-part='volume-slider'\]/
    );
    expect(withoutComments).toMatch(
      /volume-slider'\]:focus-within/
    );
  });

  test('hides the volume slider outright on a coarse pointer', () => {
    expect(withoutComments).toMatch(
      /@media\s*\(\s*pointer:\s*coarse\s*\)\s*\{[^]*?volume-slider'\][^]*?display:\s*none/
    );
  });
```

- [ ] **Step 2: Run and watch them fail**

```bash
pnpm vitest run packages/react/test/theme.test.ts -t "volume slider"
```

- [ ] **Step 3: Apply the fix**

In `packages/react/theme.css`, after the sliders section (after the existing `::-moz-range-*` forced-colors block, still inside `@layer playdeck`):

```css
  /* ---- volume reveal --------------------------------------------------- */
  @media (pointer: fine) {
    :where([data-playdeck-part='volume-slider']) {
      opacity: 0;
      pointer-events: none;
      transition: opacity var(--playdeck-transition-duration, 150ms)
        var(--playdeck-transition-easing, ease);
    }

    :where(
      [data-playdeck-part='mute-button']:hover
        + [data-playdeck-part='volume-slider'],
      [data-playdeck-part='mute-button']:focus-within
        + [data-playdeck-part='volume-slider'],
      [data-playdeck-part='volume-slider']:hover,
      [data-playdeck-part='volume-slider']:focus-within
    ) {
      opacity: 1;
      pointer-events: auto;
    }
  }

  @media (pointer: coarse) {
    :where([data-playdeck-part='volume-slider']) {
      display: none;
    }
  }
```

Add `[data-playdeck-part='volume-slider']` to the `prefers-reduced-motion: reduce` selector list too, so the reveal fade collapses under it the way the controls/activation fades already do -- `mute-button` is already in that list, so only `volume-slider` is a new entry.

- [ ] **Step 4: Fix `every button-shaped part is carried by every button rule` for the new selector**

The new hover-adjacency selector,
`[data-playdeck-part='mute-button']:hover + [data-playdeck-part='volume-slider']`,
names `mute-button`, one of the seven button parts `buttonRules` filters on
(`theme.test.ts`, inside `describe.each`) -- so this selector list is now
picked up by that filter, and it fails the "every button part is named"
check because it names only one of the seven, with `volume-slider` on top.
That check exists to catch a button rule that silently drops a control's
hover tint; an adjacency selector whose subject is the slider, not the
button, is not that shape at all, so the filter itself needs to exclude it
rather than the button-rules list growing a `volume-slider` entry it has no
button-shaped semantics for.

Inside the `describe.each` body, change the `buttonRules` filter so a
selector list qualifies only when every `data-playdeck-part` it names is one
of the seven button parts, not merely when it names one of them:

```ts
  test('every button-shaped part is carried by every button rule', () => {
    const buttonParts = [
      'play-button',
      'mute-button',
      'captions-button',
      'fullscreen-button',
      'pip-button',
      'airplay-button',
      'settings-menu-trigger'
    ];
    const buttonRules = selectorLists.filter((selector) => {
      const namedParts = [
        ...selector.matchAll(/data-playdeck-part='([a-z-]+)'/g)
      ].map(([, name]) => name);
      // At least one button part, and -- new -- no OTHER part alongside it.
      // `[data-playdeck-part='mute-button']:hover +
      // [data-playdeck-part='volume-slider']` names `mute-button` and
      // `volume-slider` together; it is an adjacency selector reaching past
      // the button to a slider, not a button-shaped rule that happens to
      // miss six parts, so it is out of scope for this check rather than a
      // failure of it.
      return (
        namedParts.some((name) => buttonParts.includes(name)) &&
        namedParts.every((name) => buttonParts.includes(name))
      );
    });
    expect(buttonRules.length).toBeGreaterThan(0);
    const missing = buttonRules.flatMap((rule) =>
      buttonParts
        .filter((part) => !rule.includes(`data-playdeck-part='${part}'`))
        .map((part) => `${part} missing from: ${rule.replace(/\s+/g, ' ')}`)
    );
    expect(missing).toEqual([]);
  });
```

Run the file and confirm this test still passes (it does, on both `theme.css` and the eventual `docked.css`, since neither's real button rules name a non-button part) and that the two new volume tests from step 1 above pass too:

```bash
pnpm vitest run packages/react/test/theme.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add packages/react/theme.css packages/react/test/theme.test.ts
git commit -m "reveal the volume slider on hover or focus, and hide it outright on a coarse pointer"
```

---

### Task 8: `data-idle` on `Viewport`

**Files:**
- Create: `packages/react/test/viewport-idle.test.tsx`
- Modify: `packages/react/src/viewport-media.tsx`

- [ ] **Step 1: Write the failing tests**

Modelled on `packages/react/test/aspect-ratio.test.tsx`'s `renderPlayer` shape
for standing the player up, and on `packages/react/test/style-precedence.test.tsx`'s
`renderWithProvider` (lines 52-76 there) for driving state through it --
`PlayerController` has no `publishPatch` method; a test attaches a fake
provider adapter and calls the fixture's own `emit`, which is what
`style-precedence.test.tsx` already does and this sketch now matches
exactly, `act()` wrapping included:

```tsx
// @vitest-environment happy-dom

import { act, cleanup, render } from '@testing-library/react';
import { createRef } from 'react';
import { afterEach, expect, test, vi } from 'vitest';
import { PlayerController } from '@playdeck/core';
import {
  INTERNAL_CONTROLLER,
  type InternalControllerAccess
} from '../src/internal-controller';
import * as Player from '../src/index';
import { loadProvider } from '../src/provider-loaders';
import { createFakeProvider } from './fixtures/fake-provider';

vi.mock('../src/provider-loaders', () => ({ loadProvider: vi.fn() }));
const mockedLoadProvider = vi.mocked(loadProvider);

afterEach(() => {
  cleanup();
  mockedLoadProvider.mockReset();
  vi.useRealTimers();
});

const viewport = (): HTMLElement =>
  document.querySelector<HTMLElement>('[data-playdeck-part="viewport"]')!;

const idle = (): string | null => viewport().getAttribute('data-idle');

const renderPlayer = (): PlayerController => {
  const handle = createRef<Player.PlayerHandle>();
  render(
    <Player.Root ref={handle} source="/tracer.mp4">
      <Player.Viewport />
    </Player.Root>
  );
  return (handle.current as unknown as InternalControllerAccess)[
    INTERNAL_CONTROLLER
  ];
};

// Attaches a fake provider and brings it to `ready`, the same shape
// `style-precedence.test.tsx`'s `renderWithProvider` uses -- `fake` is kept
// so later patches (`playback: 'playing'`/`'paused'`) can be emitted on it,
// which discarding the fixture as `createFakeProvider().adapter` would make
// impossible.
const startPlayer = (): {
  controller: PlayerController;
  fake: ReturnType<typeof createFakeProvider>;
} => {
  const controller = renderPlayer();
  const fake = createFakeProvider();
  act(() => {
    controller.setProvider(fake.adapter);
    fake.emit({ lifecycle: 'ready', activation: 'ready', provider: 'native' });
  });
  return { controller, fake };
};

test('starts not idle, and stays not idle while paused', () => {
  vi.useFakeTimers();
  startPlayer();
  expect(idle()).toBe('false');
  act(() => vi.advanceTimersByTime(5000));
  expect(idle()).toBe('false');
});

test('goes idle 2500ms after playback starts with no qualifying event', () => {
  vi.useFakeTimers();
  const { fake } = startPlayer();
  act(() => fake.emit({ playback: 'playing' }));
  expect(idle()).toBe('false');
  act(() => vi.advanceTimersByTime(2499));
  expect(idle()).toBe('false');
  act(() => vi.advanceTimersByTime(1));
  expect(idle()).toBe('true');
});

test.each(['pointermove', 'pointerdown', 'touchstart', 'keydown', 'focusin'])(
  'a %s event resets the timer and clears idle if it was set',
  (type) => {
    vi.useFakeTimers();
    const { fake } = startPlayer();
    act(() => fake.emit({ playback: 'playing' }));
    act(() => vi.advanceTimersByTime(2500));
    expect(idle()).toBe('true');

    act(() => viewport().dispatchEvent(new Event(type, { bubbles: true })));
    expect(idle()).toBe('false');

    act(() => vi.advanceTimersByTime(2499));
    expect(idle()).toBe('false');
    act(() => vi.advanceTimersByTime(1));
    expect(idle()).toBe('true');
  }
);

test('pausing clears idle immediately and disarms the timer', () => {
  vi.useFakeTimers();
  const { fake } = startPlayer();
  act(() => fake.emit({ playback: 'playing' }));
  act(() => vi.advanceTimersByTime(1000));

  act(() => fake.emit({ playback: 'paused' }));
  expect(idle()).toBe('false');

  act(() => vi.advanceTimersByTime(5000));
  expect(idle()).toBe('false');
});
```

`ProviderStatePatch` is `Partial<PlayerState>` (`packages/core/src/types.ts`),
so every `fake.emit` after the initial ready patch above can carry just the
one field it changes.

- [ ] **Step 2: Run and watch them fail**

```bash
pnpm vitest run packages/react/test/viewport-idle.test.tsx
```

Expected: every test fails, `data-idle` is never written today.

- [ ] **Step 3: Write the implementation**

In `packages/react/src/viewport-media.tsx`, add the constant near the top:

```ts
// #556 (the docked/floating themes spec). Local to this file rather than a
// `Root` prop -- see the design doc's "No prop" section for why.
const IDLE_DELAY_MS = 2500;
```

And a second `useEffect` in `Viewport`, alongside the aspect-ratio one:

```tsx
  // The idle timer for the themes' auto-hide rule. Written straight to the
  // node for the same reason the aspect ratio is: only CSS reads it, and a
  // `PlayerState` field would wake every state consumer on every tick.
  // `controller.subscribe` (not `usePlayerState`) so this effect itself never
  // re-renders anything -- it reacts only to a playback transition, gated
  // below, and never to the many-times-a-second ticks the same subscription
  // otherwise carries.
  useEffect(() => {
    const node = viewportNode.current;
    if (!node) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let playing = false;
    const setIdle = (value: boolean) => {
      node.setAttribute('data-idle', value ? 'true' : 'false');
    };
    const clearTimer = () => {
      if (timer !== undefined) {
        clearTimeout(timer);
        timer = undefined;
      }
    };
    const arm = () => {
      clearTimer();
      timer = setTimeout(() => setIdle(true), IDLE_DELAY_MS);
    };
    const reset = () => {
      setIdle(false);
      if (playing) arm();
    };
    const events = [
      'pointermove',
      'pointerdown',
      'touchstart',
      'keydown',
      'focusin'
    ] as const;
    for (const type of events) node.addEventListener(type, reset);
    setIdle(false);
    const unsubscribe = controller.subscribe((state) => {
      const nowPlaying = state.playback === 'playing';
      if (nowPlaying === playing) return;
      playing = nowPlaying;
      if (playing) arm();
      else {
        clearTimer();
        setIdle(false);
      }
    });
    return () => {
      clearTimer();
      for (const type of events) node.removeEventListener(type, reset);
      unsubscribe();
    };
  }, [controller]);
```

- [ ] **Step 4: Run and watch them pass**

```bash
pnpm vitest run packages/react/test/viewport-idle.test.tsx
```

- [ ] **Step 5: Run the whole package suite, to catch a state-change re-render regression**

```bash
pnpm vitest run packages/react/test
```

- [ ] **Step 6: Commit**

```bash
git add packages/react/src/viewport-media.tsx packages/react/test/viewport-idle.test.tsx
git commit -m "write data-idle on Viewport after 2500ms of no input while playing"
```

---

### Task 9: Auto-hide in `theme.css`

**Files:**
- Modify: `packages/react/theme.css`
- Modify: `packages/react/test/theme.test.ts`
- Create: `e2e/theme-idle.spec.ts`

- [ ] **Step 1: Write the failing unit test**

This test is `theme.css`-only: `docked.css` (task 11) deliberately never reads
`data-idle` at all, so a test asserting the auto-hide rule's presence must
not run against it. It does NOT go inside `describe.each` -- placed there it
would run against every fixture once task 11 adds `docked.css`'s entry, and
fail on that fixture forever since the rule is never meant to exist there.
Add a new top-level describe, alongside `theme contract`, `slider non-text
contrast` and `headless import chain`, reading the module-scope
`themeSource`/`withoutComments` the same way those do:

```ts
describe('theme.css auto-hide (not shared with docked.css)', () => {
  test('fades the control surface out while data-idle, and back in on focus-within', () => {
    expect(withoutComments).toMatch(
      /:where\(\[data-idle='true'\] \[data-playdeck-part='controls'\]\)\s*\{[^}]*opacity:\s*0;[^}]*pointer-events:\s*none;/
    );
    expect(withoutComments).toMatch(
      /:where\(\[data-playdeck-part='controls'\]:focus-within\)\s*\{[^}]*opacity:\s*1;/
    );
  });
});
```

- [ ] **Step 2: Run and watch it fail**

```bash
pnpm vitest run packages/react/test/theme.test.ts -t "fades the control surface"
```

- [ ] **Step 3: Apply the fix**

In `packages/react/theme.css`, after the control-surface section:

```css
  /* ---- auto-hide (theme.css only; docked.css never reads data-idle) ---- */
  :where([data-idle='true'] [data-playdeck-part='controls']) {
    opacity: 0;
    pointer-events: none;
  }

  :where([data-playdeck-part='controls']:focus-within) {
    opacity: 1;
    pointer-events: auto;
  }
```

(`transition: opacity` is already on the base `[data-playdeck-part='controls']` rule, and that rule is already listed in the `prefers-reduced-motion: reduce` block, so neither needs restating here.)

- [ ] **Step 4: Run and watch it pass**

```bash
pnpm vitest run packages/react/test/theme.test.ts
```

- [ ] **Step 5: Write the failing e2e spec**

Create `e2e/theme-idle.spec.ts`, driving the same `reference-player--playing` story `e2e/a11y.spec.ts` already uses, themed (`globals=theme:themed`, matching `e2e/thumb-contrast.spec.ts`'s `themedStory` helper). Three cases, matching the spec's own verification section exactly (spec:474-487): the fade-and-return case, the paused case sampled repeatedly across several times the idle delay rather than waited out once, and the focus-within case that keeps the bar visible despite `data-idle` reading `"true"` underneath it:

```ts
import { expect, test, type Page } from '@playwright/test';

const themedStory = (id: string): string =>
  `/iframe.html?id=${id}&viewMode=story&globals=theme:themed`;

const controlsOpacity = async (page: Page) =>
  Number(
    await page
      .locator('[data-playdeck-part="controls"]')
      .evaluate((el) => globalThis.getComputedStyle(el).opacity)
  );

const idleAttribute = async (page: Page) =>
  page.locator('[data-playdeck-part="viewport"]').getAttribute('data-idle');

test('the control bar fades after 2500ms idle while playing, and returns on pointermove', async ({
  page
}) => {
  await page.goto(themedStory('reference-player--playing'));
  await page.mouse.move(200, 200);
  await expect
    .poll(() => controlsOpacity(page), { timeout: 4000 })
    .toBe(0);

  await page.mouse.move(210, 210);
  await expect.poll(() => controlsOpacity(page)).toBe(1);
});

test('the control bar never fades while paused, sampled repeatedly across several idle delays', async ({
  page
}) => {
  await page.goto(themedStory('reference-player--composition'));
  // IDLE_DELAY_MS is 2500ms; sampled eight times over 8s (more than three
  // idle delays) rather than waited out once, so a fade that starts and ends
  // between two samples of a single `waitForTimeout` cannot pass unnoticed --
  // the paused player never arms the timer at all, so every sample should
  // read the same 1.
  for (let sample = 0; sample < 8; sample++) {
    expect(await controlsOpacity(page)).toBe(1);
    await page.waitForTimeout(1000);
  }
});

test('a focused control keeps the bar visible past the idle delay, even once data-idle reads true', async ({
  page
}) => {
  await page.goto(themedStory('reference-player--playing'));
  await page.locator('[data-playdeck-part="mute-button"]').focus();
  await page.waitForTimeout(3000);
  expect(await idleAttribute(page)).toBe('true');
  expect(await controlsOpacity(page)).toBe(1);
});
```

- [ ] **Step 6: Run and watch the first spec fail**

```bash
pnpm exec playwright test e2e/theme-idle.spec.ts --project=chromium
```

Expected: the first test times out waiting for opacity 0 and the third test's `controlsOpacity` reads 0 instead of 1 (task 8 already lands `data-idle`, but nothing in CSS reads it yet before step 3 above -- by this point step 3 has landed, so re-check: if both steps 3 and this one ran in order the first and third tests should now PASS and the second should already PASS too, since task 8's timer already disarms on pause. Run it once before step 3 if you want to see the genuine red; after step 3 all three are expected green.)

- [ ] **Step 7: Run and confirm all three pass**

```bash
pnpm exec playwright test e2e/theme-idle.spec.ts --project=chromium --project=firefox
```

- [ ] **Step 8: Commit**

```bash
git add packages/react/theme.css packages/react/test/theme.test.ts e2e/theme-idle.spec.ts
git commit -m "fade the control bar out while data-idle, keep it while focus-within"
```

---

### Task 10: Below 48rem -- flatten the scrim, drop the volume slider, allow more wrapping

**Files:**
- Modify: `packages/react/theme.css`
- Modify: `packages/react/test/theme.test.ts`

- [ ] **Step 1: Write the failing test**

Not `position: static`. `theme.css`'s rules are all `:where()` inside
`@layer playdeck` (rule 1 in the file's own header comment: unlayered
consumer CSS wins whatever its specificity), so a `position` declared here
can only ever beat another layered `:where()` rule, never the ordinary
unlayered CSS a real composition uses to float the bar in the first place --
see "Before you start" above. A `position: static` rule would be dead CSS in
every real composition and untestable as anything but its own presence in
the source, so this task does not add one; below 48rem `theme.css` only
flattens the scrim and drops the volume slider, and it makes no claim about
position at any width. Docking the bar for real is `docked.css`'s job
(task 11), which never positions it over the picture to begin with.

This test is `theme.css`-only for the same reason task 9's auto-hide test
is: `docked.css` never overlays anything, so it has no scrim to flatten and
no `max-width: 48rem` query at all. It does NOT go inside `describe.each`.
Add it to the same top-level describe task 9 added:

```ts
describe('theme.css auto-hide (not shared with docked.css)', () => {
  // ... task 9's test stays here too ...

  test('flattens the scrim and drops the volume slider below 48rem', () => {
    const query = withoutComments.match(
      /@media\s*\(\s*max-width:\s*48rem\s*\)\s*\{[^]*?\n {2}\}/
    )?.[0];
    expect(query).toBeDefined();
    expect(query).toMatch(
      /background:\s*var\(--playdeck-color-surface,\s*rgb\(0 0 0 \/ 0\.72\)\)/
    );
    expect(query).toMatch(/volume-slider'\][^]*?display:\s*none/);
  });
});
```

Adjust the closing-brace pattern once the real block is written if the indentation differs; the point of the test is the two declarations inside one `max-width: 48rem` query, not the exact regex.

- [ ] **Step 2: Run and watch it fail**

```bash
pnpm vitest run packages/react/test/theme.test.ts -t "flattens the scrim"
```

- [ ] **Step 3: Apply the fix**

In `packages/react/theme.css`:

```css
  /* ---- below 48rem: flatten the scrim, drop the volume slider --------- */
  @media (max-width: 48rem) {
    :where([data-playdeck-part='controls']) {
      background: var(--playdeck-color-surface, rgb(0 0 0 / 0.72));
    }

    :where([data-playdeck-part='volume-slider']) {
      display: none;
    }
  }
```

No `position` declaration here -- see step 1's note.

- [ ] **Step 4: Run and watch it pass, then the full file**

```bash
pnpm vitest run packages/react/test/theme.test.ts
```

- [ ] **Step 5: Confirm the 320px reflow case still passes with a possible third line**

```bash
pnpm exec playwright test e2e/a11y.spec.ts -g "320px at 200% text" --project=chromium
```

Expected: PASS. If it fails on clipping, the bar's own no-shrink 44px targets are producing a fourth line the picture's own box can't hold; re-check that `flex-wrap: wrap` (task 6) is in place on `[data-playdeck-part='controls']` and that nothing here re-introduces a fixed height.

- [ ] **Step 6: Commit**

```bash
git add packages/react/theme.css packages/react/test/theme.test.ts
git commit -m "flatten the scrim and drop the volume slider below 48rem"
```

---

### Task 11: `docked.css`

**Files:**
- Create: `packages/react/docked.css`
- Modify: `packages/react/test/theme.test.ts`
- Modify: `packages/react/package.json`

`docked.css` is standalone: every rule the contract needs is written in this file, none of it shared by `@import` with `theme.css`. It reuses the same shared token *names* and, for everything but the four colours below, the same defaults `theme.css` uses, so a consumer who has already set `--playdeck-control-size` or `--playdeck-space-2` for `theme.css` gets the same effect under `docked.css` with no second override.

- [ ] **Step 1: Write the failing packaging test**

Add the `docked.css` fixture entry from step 3 below to `theme.test.ts`'s `fixtures` array (task 1's placeholder comment names this spot) before the file exists, so it fails on the missing file first:

```ts
import { existsSync } from 'node:fs';
```

Add, right after the `themeSource` read at the top of the file:

```ts
const dockedPath = new URL('../docked.css', import.meta.url);
const dockedSource = existsSync(dockedPath)
  ? await readFile(dockedPath, 'utf8')
  : '';
```

And push a second entry onto `fixtures`:

```ts
  {
    label: 'docked.css',
    source: dockedSource,
    exportPath: './docked.css',
    expected: {
      atRules: ['layer', 'media'],
      pseudoFunctions: ['where'],
      pseudoElements: [
        '-moz-range-progress',
        '-moz-range-thumb',
        '-moz-range-track',
        '-webkit-slider-thumb'
      ],
      // No `linear-gradient` -- docked.css draws no scrim.
      functions: ['calc', 'env', 'rgb', 'var'],
      forcedColorsSliderNeedles: [
        '::-moz-range-track',
        '::-moz-range-progress',
        '::-moz-range-thumb',
        'appearance: none',
        ":where([data-playdeck-part='seek-slider-input']) {",
        ":where([data-playdeck-part='seek-progress']) {",
        ":where([data-playdeck-part='seek-slider-input'])::-webkit-slider-thumb"
      ]
    }
  }
```

- [ ] **Step 2: Run and watch every `docked.css contract` test fail**

```bash
pnpm vitest run packages/react/test/theme.test.ts
```

Expected: the `theme.css contract` describe block still green; the new `docked.css contract` block fails across the board (`selectorLists.length` is 0, the file is empty).

- [ ] **Step 3: Write `packages/react/docked.css`**

```css
/*
 * @playdeck/react/docked.css -- the second optional theme.
 *
 * Same contract as theme.css: every selector lives inside `@layer playdeck`,
 * every selector is wrapped in `:where()`, and every colour is read as
 * `var(--name, default)` and never declared -- except the range-input
 * pseudo-elements, which carry their own (0,0,1) for the reason theme.css's
 * header explains. Standalone: this file shares no `@import` with theme.css,
 * so a consumer who imports only this one never downloads a byte of the
 * other theme's scrim or auto-hide rules, and vice versa.
 *
 * The layout difference from theme.css: nothing here is ever positioned over
 * the picture, so there is no overlay to auto-hide and `data-idle` is never
 * read. The colour difference: every token below carries a light default in
 * the cascade's normal position and a dark default repeated inside a
 * `@media (prefers-color-scheme: dark)` block at the foot of the file, so a
 * page's own light/dark switch (a `data-theme` attribute on `<html>`, say)
 * composes with either default the same way any consumer override already
 * composes with a theme.css token. Every token name is one `theme.css`
 * already declares -- this file never invents a new colour token, only new
 * defaults for the ones that exist, with one exception noted below.
 *
 *   --playdeck-color-surface       #f4f4f2 light / #141416 dark
 *   --playdeck-color-on-surface    #1c1c1e light / #ededed dark
 *   --playdeck-color-accent        #2b52d6 light / #3ea6ff dark
 *   --playdeck-color-focus         #2b52d6 light / #3ea6ff dark  (reuses
 *                                  accent's own value by default; theme.css
 *                                  keeps the two tokens independent and so
 *                                  does this file -- a consumer can still set
 *                                  them apart -- but a blue focus ring on a
 *                                  neutral bar needs no separate colour by
 *                                  default the way theme.css's `#fff` does
 *                                  against its own dark scrim)
 *   --playdeck-color-track         #84847d light / #6d6d70 dark  (paints
 *                                  `seek-buffered`, the unfilled boundary;
 *                                  theme.css's own translucent-white default
 *                                  reads as near-invisible composited onto a
 *                                  light surface, so this file needs its own)
 *   --playdeck-color-buffered      #1c1c1e light / #ededed dark  (paints
 *                                  `seek-buffered-range`, the loaded
 *                                  boundary; reuses on-surface's own values,
 *                                  as an independent token a consumer can
 *                                  still move separately)
 *   --playdeck-color-hairline      #d9d9d6 light / #2a2a2d dark  (new; the
 *                                  only token this file adds. The 1px top
 *                                  border separating the bar from the
 *                                  picture and the settings/captions menu's
 *                                  own border, since there is no scrim here
 *                                  to supply either edge)
 *
 * Non-text contrast (WCAG 2.2 1.4.11's 3:1 floor for a UI component's own
 * boundary, the same rule `theme.css`'s `slider non-text contrast` describe
 * in `theme.test.ts` checks): `--playdeck-color-track` against
 * `--playdeck-color-surface` is 3.42:1 light, 3.57:1 dark;
 * `--playdeck-color-buffered` against `--playdeck-color-track` (composited
 * the same way theme.css composites its own buffered-over-track boundary) is
 * 4.52:1 light, 4.41:1 dark; `--playdeck-color-focus` against
 * `--playdeck-color-surface` is 5.81:1 light, 7.10:1 dark. All four clear the
 * floor with a margin; `docked.css slider non-text contrast` in
 * `theme.test.ts` (task 11 step 5) asserts them.
 *
 * Every other token this file reads keeps theme.css's own default -- spacing,
 * control sizing, typography, motion, safe-area, activation size -- so a
 * consumer who already set one of those for theme.css needs no second
 * override to get the same effect here.
 */

@layer playdeck {
  :where([data-playdeck-part='viewport']) {
    font-family: var(
      --playdeck-font-family,
      system-ui,
      -apple-system,
      'Segoe UI',
      roboto,
      helvetica,
      arial,
      sans-serif
    );
    color: var(--playdeck-color-on-surface, #1c1c1e);
    background-color: var(--playdeck-color-surface, #f4f4f2);
  }

  :where([data-playdeck-part='media']) {
    background-color: var(--playdeck-color-backdrop, #000);
  }

  /* ---- activation and status --------------------------------------------- */
  :where([data-playdeck-part='activation']) {
    display: grid;
    place-items: center;
    box-sizing: border-box;
    min-inline-size: var(--playdeck-activation-size, 4rem);
    min-block-size: var(--playdeck-activation-size, 4rem);
    padding-inline: var(--playdeck-space-3, 0.75rem);
    border-radius: 2rem;
    color: var(--playdeck-color-on-surface, #1c1c1e);
    --playdeck-activation-fill: var(--playdeck-color-surface, #f4f4f2);
    --playdeck-activation-border: 1px solid
      var(--playdeck-color-hairline, #d9d9d6);
    cursor: pointer;
    transition: opacity var(--playdeck-transition-duration, 150ms)
      var(--playdeck-transition-easing, ease);
  }

  :where([data-playdeck-part='loading-indicator']) {
    color: var(--playdeck-color-on-surface, #1c1c1e);
  }

  :where([data-playdeck-part='error']) {
    display: grid;
    gap: var(--playdeck-space-2, 0.5rem);
    place-items: center;
    padding: var(--playdeck-space-3, 0.75rem);
    border-radius: var(--playdeck-radius-large, 0.5rem);
    color: var(--playdeck-color-on-surface, #1c1c1e);
    background-color: var(--playdeck-color-surface, #f4f4f2);
  }

  :where([data-playdeck-part='error-message']) {
    margin: 0;
    font-size: var(--playdeck-font-size, 0.875rem);
    line-height: var(--playdeck-line-height, 1.4);
  }

  :where([data-playdeck-part='error-retry']) {
    padding: var(--playdeck-space-1, 0.25rem) var(--playdeck-space-3, 0.75rem);
    border: 1px solid var(--playdeck-color-on-surface, #1c1c1e);
    border-radius: var(--playdeck-radius, 0.375rem);
    color: var(--playdeck-color-on-surface, #1c1c1e);
    font: inherit;
    background-color: transparent;
    cursor: pointer;
  }

  /* ---- control surface: docked, never overlaid, never hidden ------------ */
  :where([data-playdeck-part='controls']) {
    display: flex;
    flex-wrap: wrap;
    gap: var(--playdeck-space-1, 0.25rem);
    align-items: center;
    padding: var(--playdeck-space-2, 0.5rem);
    padding-bottom: calc(
      var(--playdeck-space-2, 0.5rem) +
        var(--playdeck-safe-bottom, env(safe-area-inset-bottom, 0px))
    );
    padding-left: calc(
      var(--playdeck-space-2, 0.5rem) +
        var(--playdeck-safe-left, env(safe-area-inset-left, 0px))
    );
    padding-right: calc(
      var(--playdeck-space-2, 0.5rem) +
        var(--playdeck-safe-right, env(safe-area-inset-right, 0px))
    );
    color: var(--playdeck-color-on-surface, #1c1c1e);
    background-color: var(--playdeck-color-surface, #f4f4f2);
    border-block-start: 1px solid var(--playdeck-color-hairline, #d9d9d6);
  }

  :where(
    [data-playdeck-part='play-button'],
    [data-playdeck-part='mute-button'],
    [data-playdeck-part='captions-button'],
    [data-playdeck-part='fullscreen-button'],
    [data-playdeck-part='pip-button'],
    [data-playdeck-part='airplay-button'],
    [data-playdeck-part='settings-menu-trigger']
  ) {
    display: inline-grid;
    place-items: center;
    flex: 0 0 auto;
    inline-size: var(--playdeck-control-size, 2.75rem);
    block-size: var(--playdeck-control-size, 2.75rem);
    padding: 0;
    border: 0;
    border-radius: var(--playdeck-radius, 0.375rem);
    color: var(--playdeck-color-on-surface, #1c1c1e);
    background-color: transparent;
    cursor: pointer;
  }

  :where(
    [data-playdeck-part='play-button'],
    [data-playdeck-part='mute-button'],
    [data-playdeck-part='captions-button'],
    [data-playdeck-part='fullscreen-button'],
    [data-playdeck-part='pip-button'],
    [data-playdeck-part='airplay-button'],
    [data-playdeck-part='settings-menu-trigger']
  ):where(:hover) {
    background-color: var(--playdeck-control-hover, rgb(0 0 0 / 0.06));
  }

  :where([data-playdeck-part]):where(:focus-visible) {
    outline: 2px solid var(--playdeck-color-focus, #2b52d6);
    outline-offset: 2px;
  }

  :where([data-playdeck-part] svg) {
    inline-size: var(--playdeck-control-icon-size, 1.25rem);
    block-size: var(--playdeck-control-icon-size, 1.25rem);
  }

  :where([data-playdeck-part='time']) {
    padding-inline: var(--playdeck-space-2, 0.5rem);
    font-size: var(--playdeck-font-size-small, 0.8125rem);
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }

  :where([data-playdeck-part='time'][data-time-type='duration']) {
    margin-inline-end: auto;
  }

  /* ---- sliders ------------------------------------------------------------ */
  :where([data-playdeck-part='seek-slider']) {
    position: relative;
    flex: 1 1 100%;
    min-inline-size: 4rem;
  }

  :where([data-playdeck-part='seek-buffered']) {
    position: absolute;
    inset-inline: 0;
    inset-block-start: 50%;
    block-size: var(--playdeck-slider-thickness, 0.25rem);
    translate: 0 -50%;
    border-radius: calc(var(--playdeck-slider-thickness, 0.25rem) / 2);
    background-color: var(--playdeck-color-track, #84847d);
    pointer-events: none;
  }

  :where([data-playdeck-part='seek-buffered-range']) {
    position: absolute;
    inset-block: 0;
    border-radius: inherit;
    background-color: var(--playdeck-color-buffered, #1c1c1e);
  }

  :where(
    [data-playdeck-part='seek-slider'][data-buffering='true']
      [data-playdeck-part='seek-buffered-range']
  ) {
    opacity: 0.6;
  }

  :where(
    [data-playdeck-part='seek-slider-input'],
    [data-playdeck-part='volume-slider']
  ) {
    display: block;
    inline-size: 100%;
    margin: 0;
    accent-color: var(--playdeck-color-accent, #2b52d6);
    background-color: transparent;
    cursor: pointer;
  }

  @media (pointer: fine) {
    :where([data-playdeck-part='volume-slider']) {
      inline-size: 5rem;
      opacity: 0;
      pointer-events: none;
      transition: opacity var(--playdeck-transition-duration, 150ms)
        var(--playdeck-transition-easing, ease);
    }

    :where(
      [data-playdeck-part='mute-button']:hover
        + [data-playdeck-part='volume-slider'],
      [data-playdeck-part='mute-button']:focus-within
        + [data-playdeck-part='volume-slider'],
      [data-playdeck-part='volume-slider']:hover,
      [data-playdeck-part='volume-slider']:focus-within
    ) {
      opacity: 1;
      pointer-events: auto;
    }
  }

  @media (pointer: coarse) {
    :where([data-playdeck-part='volume-slider']) {
      display: none;
    }
  }

  :where(
    [data-playdeck-part='seek-slider-input'],
    [data-playdeck-part='volume-slider']
  )::-webkit-slider-thumb {
    outline: 2px solid var(--playdeck-color-thumb-ring, #000);
  }

  @media (forced-colors: none) {
    :where(
      [data-playdeck-part='seek-slider-input'],
      [data-playdeck-part='volume-slider']
    )::-moz-range-track {
      block-size: var(--playdeck-slider-thickness, 0.25rem);
      border-radius: calc(var(--playdeck-slider-thickness, 0.25rem) / 2);
      background-color: var(--playdeck-color-hairline, #d9d9d6);
    }

    :where(
      [data-playdeck-part='seek-slider-input'],
      [data-playdeck-part='volume-slider']
    )::-moz-range-progress {
      block-size: var(--playdeck-slider-thickness, 0.25rem);
      border-radius: calc(var(--playdeck-slider-thickness, 0.25rem) / 2);
      background-color: var(--playdeck-color-accent, #2b52d6);
    }

    :where(
      [data-playdeck-part='seek-slider-input'],
      [data-playdeck-part='volume-slider']
    )::-moz-range-thumb {
      box-sizing: border-box;
      inline-size: calc(var(--playdeck-slider-thickness, 0.25rem) * 4);
      block-size: calc(var(--playdeck-slider-thickness, 0.25rem) * 4);
      border: 2px solid var(--playdeck-color-thumb-ring, #000);
      border-radius: 50%;
      background-color: var(--playdeck-color-accent, #2b52d6);
    }

    :where([data-playdeck-part='seek-slider-input']) {
      position: relative;
      appearance: none;
    }

    :where([data-playdeck-part='seek-progress']) {
      inset-block: 0;
      border-radius: inherit;
      background-color: var(--playdeck-color-accent, #2b52d6);
    }

    :where([data-playdeck-part='seek-slider-input'])::-webkit-slider-thumb {
      appearance: none;
      box-sizing: border-box;
      inline-size: calc(var(--playdeck-slider-thickness, 0.25rem) * 4);
      block-size: calc(var(--playdeck-slider-thickness, 0.25rem) * 4);
      outline: none;
      border: 2px solid var(--playdeck-color-thumb-ring, #000);
      border-radius: 50%;
      background-color: var(--playdeck-color-accent, #2b52d6);
    }

    :where([data-playdeck-part='seek-slider-input'])::-moz-range-track,
    :where([data-playdeck-part='seek-slider-input'])::-moz-range-progress {
      background-color: transparent;
    }

    /* Dark-mode overrides for the rules directly above, nested here rather
     * than the other way around (a `(forced-colors: none)` block inside the
     * dark-scheme block) so the file has exactly ONE
     * `@media (forced-colors: none)` occurrence. `theme.test.ts`'s `leaves
     * every hand-drawn slider rule out of forced-colors mode` test finds the
     * FIRST such occurrence with `RegExp.exec` and walks its braces to find
     * where it closes; a second, later occurrence would sit outside that
     * walk entirely; and this file's rules would be a `(forced-colors: none)`
     * block wrapped nested in a `(prefers-color-scheme: dark)` block that the
     * walk cannot see at all, since it starts from the module-scope
     * `(forced-colors: none)` text match, and no logic errors -- the walk
     * just quietly checks the wrong (or only the first) block. AND semantics
     * make the nesting order otherwise unobservable: both conditions still
     * have to hold for these declarations to apply either way. */
    @media (prefers-color-scheme: dark) {
      :where(
        [data-playdeck-part='seek-slider-input'],
        [data-playdeck-part='volume-slider']
      )::-moz-range-track {
        background-color: var(--playdeck-color-track, #6d6d70);
      }

      :where(
        [data-playdeck-part='seek-slider-input'],
        [data-playdeck-part='volume-slider']
      )::-moz-range-progress,
      :where(
        [data-playdeck-part='seek-slider-input'],
        [data-playdeck-part='volume-slider']
      )::-moz-range-thumb,
      :where([data-playdeck-part='seek-progress']),
      :where([data-playdeck-part='seek-slider-input'])::-webkit-slider-thumb {
        background-color: var(--playdeck-color-accent, #3ea6ff);
      }
    }
  }

  /* ---- menus --------------------------------------------------------------- */
  :where([data-playdeck-part='settings-menu-root']) {
    position: relative;
  }

  :where(
    [data-playdeck-part='settings-menu'],
    [data-playdeck-part='captions-menu']
  ) {
    position: absolute;
    inset-block-end: calc(100% + var(--playdeck-space-1, 0.25rem));
    inset-inline-end: 0;
    min-inline-size: 10rem;
    padding: var(--playdeck-space-1, 0.25rem);
    border: 1px solid var(--playdeck-color-hairline, #d9d9d6);
    border-radius: var(--playdeck-radius-large, 0.5rem);
    color: var(--playdeck-color-on-surface, #1c1c1e);
    background-color: var(--playdeck-color-surface, #f4f4f2);
    box-shadow: 0 0.5rem 1.5rem rgb(0 0 0 / 0.15);
  }

  :where(
    [data-playdeck-part='menu-item'],
    [data-playdeck-part='menu-radio-item']
  ) {
    display: flex;
    gap: var(--playdeck-space-2, 0.5rem);
    align-items: center;
    inline-size: 100%;
    min-block-size: var(--playdeck-control-size, 2.75rem);
    padding-inline: var(--playdeck-space-2, 0.5rem);
    border: 0;
    border-radius: var(--playdeck-radius, 0.375rem);
    color: inherit;
    font: inherit;
    font-size: var(--playdeck-font-size, 0.875rem);
    text-align: start;
    background-color: transparent;
    cursor: pointer;
  }

  :where(
    [data-playdeck-part='menu-item'],
    [data-playdeck-part='menu-radio-item']
  ):where(:hover) {
    background-color: var(--playdeck-control-hover, rgb(0 0 0 / 0.06));
  }

  :where([data-playdeck-part='menu-radio-indicator']) {
    display: inline-grid;
    place-items: center;
    inline-size: var(--playdeck-control-icon-size, 1.25rem);
  }

  /* ---- captions ------------------------------------------------------------ */
  :where([data-playdeck-part='caption-cue']) {
    font-family: inherit;
    line-height: var(--playdeck-line-height, 1.4);
  }

  /* ---- reduced motion -------------------------------------------------------
   * No auto-hide here (docked.css never reads data-idle), so only the volume
   * reveal fade and the activation opacity fade need collapsing.
   */
  @media (prefers-reduced-motion: reduce) {
    :where(
      [data-playdeck-part='activation'],
      [data-playdeck-part='volume-slider'],
      [data-playdeck-part='mute-button']
    ) {
      transition-duration: 0.01ms;
    }
  }

  /* ---- forced colors --------------------------------------------------------
   * Same shape as theme.css's block, restated for this file's own selectors.
   */
  @media (forced-colors: active) {
    :where([data-playdeck-part='controls']) {
      background: canvas;
      border-block-start-color: canvastext;
    }

    :where(
      [data-playdeck-part='play-button'],
      [data-playdeck-part='mute-button'],
      [data-playdeck-part='captions-button'],
      [data-playdeck-part='fullscreen-button'],
      [data-playdeck-part='pip-button'],
      [data-playdeck-part='airplay-button'],
      [data-playdeck-part='settings-menu-trigger'],
      [data-playdeck-part='menu-item'],
      [data-playdeck-part='menu-radio-item']
    ) {
      border: 1px solid buttonborder;
      color: buttontext;
      background-color: buttonface;
      forced-color-adjust: none;
    }

    :where(
      [data-playdeck-part='play-button'],
      [data-playdeck-part='mute-button'],
      [data-playdeck-part='captions-button'],
      [data-playdeck-part='fullscreen-button'],
      [data-playdeck-part='pip-button'],
      [data-playdeck-part='airplay-button'],
      [data-playdeck-part='settings-menu-trigger'],
      [data-playdeck-part='menu-item'],
      [data-playdeck-part='menu-radio-item']
    ):where(:hover) {
      color: highlighttext;
      background-color: highlight;
    }

    :where([data-playdeck-part]):where(:focus-visible) {
      outline: 2px solid highlight;
    }

    :where(
      [data-playdeck-part='settings-menu'],
      [data-playdeck-part='captions-menu']
    ) {
      border: 1px solid canvastext;
      background-color: canvas;
    }

    :where([data-playdeck-part='seek-buffered']) {
      border: 1px solid canvastext;
      background-color: canvas;
    }

    :where([data-playdeck-part='seek-buffered-range']) {
      background-color: canvastext;
    }
  }

  /* ---- dark tokens ---------------------------------------------------------
   * Same declarations as their light-default siblings above, reading the same
   * token names with a dark fallback instead. Never a declaration -- see the
   * header comment.
   */
  @media (prefers-color-scheme: dark) {
    :where([data-playdeck-part='viewport']) {
      color: var(--playdeck-color-on-surface, #ededed);
      background-color: var(--playdeck-color-surface, #141416);
    }

    :where([data-playdeck-part='activation']) {
      color: var(--playdeck-color-on-surface, #ededed);
      --playdeck-activation-fill: var(--playdeck-color-surface, #141416);
      --playdeck-activation-border: 1px solid
        var(--playdeck-color-hairline, #2a2a2d);
    }

    :where([data-playdeck-part='loading-indicator']) {
      color: var(--playdeck-color-on-surface, #ededed);
    }

    :where([data-playdeck-part='error']) {
      color: var(--playdeck-color-on-surface, #ededed);
      background-color: var(--playdeck-color-surface, #141416);
    }

    :where([data-playdeck-part='error-retry']) {
      border-color: var(--playdeck-color-on-surface, #ededed);
      color: var(--playdeck-color-on-surface, #ededed);
    }

    :where([data-playdeck-part='controls']) {
      color: var(--playdeck-color-on-surface, #ededed);
      background-color: var(--playdeck-color-surface, #141416);
      border-block-start-color: var(--playdeck-color-hairline, #2a2a2d);
    }

    :where(
      [data-playdeck-part='play-button'],
      [data-playdeck-part='mute-button'],
      [data-playdeck-part='captions-button'],
      [data-playdeck-part='fullscreen-button'],
      [data-playdeck-part='pip-button'],
      [data-playdeck-part='airplay-button'],
      [data-playdeck-part='settings-menu-trigger']
    ) {
      color: var(--playdeck-color-on-surface, #ededed);
    }

    :where([data-playdeck-part] svg) {
      color: inherit;
    }

    :where([data-playdeck-part='time']) {
      color: inherit;
    }

    :where([data-playdeck-part='seek-buffered']) {
      background-color: var(--playdeck-color-track, #6d6d70);
    }

    :where([data-playdeck-part='seek-buffered-range']) {
      background-color: var(--playdeck-color-buffered, #ededed);
    }

    :where(
      [data-playdeck-part='seek-slider-input'],
      [data-playdeck-part='volume-slider']
    ) {
      accent-color: var(--playdeck-color-accent, #3ea6ff);
    }

    :where(
      [data-playdeck-part='settings-menu'],
      [data-playdeck-part='captions-menu']
    ) {
      border-color: var(--playdeck-color-hairline, #2a2a2d);
      color: var(--playdeck-color-on-surface, #ededed);
      background-color: var(--playdeck-color-surface, #141416);
    }

    :where([data-playdeck-part]):where(:focus-visible) {
      outline-color: var(--playdeck-color-focus, #3ea6ff);
    }
  }
}
```

This file has exactly ONE `@media (forced-colors: none)` occurrence -- the
one inside the sliders section above, which now carries its own nested
`@media (prefers-color-scheme: dark)` for the four dark-mode slider
declarations, rather than the other way around. `docked.css` would
otherwise have carried a second `(forced-colors: none)` block nested inside
this dark-scheme block, which `theme.test.ts`'s `leaves every hand-drawn
slider rule out of forced-colors mode` needle walk cannot see: it locates
the FIRST `(forced-colors: none)` text match with `RegExp.exec` and walks
its braces to find where that one block closes, so a second, later
occurrence -- or, worse, this file's slider rules arriving as a
`(forced-colors: none)` block itself nested inside `(prefers-color-scheme:
dark)`, which the walk starting from the top-level match would never reach
at all -- would either sit unguarded outside the walk or read as guarded
when it is not, with no test failure pointing at why. The two `@media`
keywords nested here are still just the one `media` keyword the
feature-inventory test tracks, so this needs no new entry in
`expected.atRules` either way.

- [ ] **Step 4: Run and watch every `docked.css contract` test pass**

```bash
pnpm vitest run packages/react/test/theme.test.ts
```

If the feature inventory (`functions`, `pseudoElements`) disagrees with what step 1 predicted, that is the actual file talking -- update `expected.functions`/`expected.pseudoElements` in the fixture entry to match what this file really contains, and say in the commit message that the guessed inventory was corrected.

- [ ] **Step 5: Add the contrast checks for `docked.css`'s own palette**

At the bottom of `theme.test.ts`, after the existing `slider non-text contrast` describe (which stays theme.css-only), add two describes reusing `parseColor`/`contrast` against `docked.css`'s tokens: text pairs at the AA floor of 4.5:1 (WCAG 1.4.3), and the slider boundaries at the 3:1 floor (WCAG 1.4.11), both defaults, both matching the ratios stated in `docked.css`'s own header comment (task 11 step 3):

```ts
describe('docked.css text contrast', () => {
  const textPairs = [
    { name: 'on-surface vs surface (light)', fg: '#1c1c1e', bg: '#f4f4f2' },
    { name: 'on-surface vs surface (dark)', fg: '#ededed', bg: '#141416' },
    { name: 'accent vs surface (light)', fg: '#2b52d6', bg: '#f4f4f2' },
    { name: 'accent vs surface (dark)', fg: '#3ea6ff', bg: '#141416' }
  ];

  test.each(textPairs)('$name clears 4.5:1', ({ fg, bg }) => {
    const ratio = contrast(parseColor(fg), parseColor(bg));
    expect(ratio).toBeGreaterThanOrEqual(4.5);
  });
});

// A UI component's own boundary (1.4.11), not text (1.4.3), so the floor is
// 3:1 -- the same rule `theme.css`'s own `slider non-text contrast` describe
// checks, above. `track` is `seek-buffered`, the unfilled boundary, checked
// against the surface it sits on; `buffered` is `seek-buffered-range`, the
// loaded boundary, checked against the track it composites over (never the
// surface directly, the same composite order `theme.css`'s own describe uses
// and for the same reason: that is the surface the boundary is actually
// painted against). `focus` is the `:focus-visible` outline, checked against
// the surface it is drawn on.
describe('docked.css slider non-text contrast', () => {
  const nonTextPairs = [
    { name: 'track vs surface (light)', fg: '#84847d', bg: '#f4f4f2' },
    { name: 'track vs surface (dark)', fg: '#6d6d70', bg: '#141416' },
    { name: 'buffered vs track (light)', fg: '#1c1c1e', bg: '#84847d' },
    { name: 'buffered vs track (dark)', fg: '#ededed', bg: '#6d6d70' },
    { name: 'focus vs surface (light)', fg: '#2b52d6', bg: '#f4f4f2' },
    { name: 'focus vs surface (dark)', fg: '#3ea6ff', bg: '#141416' }
  ];

  test.each(nonTextPairs)('$name clears 3:1', ({ fg, bg }) => {
    const ratio = contrast(parseColor(fg), parseColor(bg));
    expect(ratio).toBeGreaterThanOrEqual(3);
  });
});
```

Run them; if any pair is below its floor, that is real information about the chosen defaults, not a test bug -- darken or lighten the failing default in `docked.css` (and in this test's literal, and in the header comment's stated ratios) until it clears, rather than lowering the floor.

```bash
pnpm vitest run packages/react/test/theme.test.ts -t "docked.css"
```

- [ ] **Step 6: Add the two `exports`/`files` entries**

In `packages/react/package.json`:

```json
  "exports": {
    ".": { "...": "..." },
    "./theme.css": "./theme.css",
    "./docked.css": "./docked.css"
  },
```

```json
  "files": [
    "CHANGELOG.md",
    "dist",
    "!dist/**/*.d.ts.map",
    "!dist/.tsbuildinfo*",
    "theme.css",
    "docked.css",
    "esm-only.cjs",
    "esm-only.d.cts"
  ],
```

`sideEffects` already carries `"*.css"`, which matches `docked.css` by basename -- no change needed there, and `theme.test.ts`'s `declares every exported stylesheet to have side effects` test (unchanged, outside the per-file loop) proves it by walking `manifest.exports` generically.

- [ ] **Step 7: Run the whole package test suite**

```bash
pnpm vitest run packages/react/test
```

- [ ] **Step 8: Commit**

```bash
git add packages/react/docked.css packages/react/test/theme.test.ts packages/react/package.json
git commit -m "add docked.css: the same control-bar contract, docked and never hidden"
```

---

### Task 12: Packaging -- exports, a bundle budget, the fixture, a changeset

**Files:**
- Create: `tests/packaging/fixture/docked.html`, `tests/packaging/fixture/src/docked.tsx`
- Modify: `scripts/bundle-budgets.mjs`, `scripts/bundle-budgets.test.mjs`
- Modify: `scripts/verify-packaging.mjs`
- Create: `.changeset/<two-words>.md`

- [ ] **Step 1: Measure `docked.css`'s gzipped rule weight**

```bash
node -e "
const { gzipSync } = require('node:zlib');
const { readFileSync } = require('node:fs');
const { stripCssComments } = require('./scripts/bundle-budgets.mjs');
" 2>&1 || node --input-type=module -e "
import { gzipSync } from 'node:zlib';
import { readFileSync } from 'node:fs';
import { stripCssComments } from './scripts/bundle-budgets.mjs';
const source = readFileSync('packages/react/docked.css', 'utf8');
const stripped = stripCssComments(source);
console.log('shipped KB:', (gzipSync(source).length / 1024).toFixed(2));
console.log('rules KB:  ', (gzipSync(stripped).length / 1024).toFixed(2));
"
```

Round the "rules KB" figure up to the next 0.5 KB -- that is the budget. Do not assume it equals `theme.css`'s 2.5 KB; `docked.css` carries the same range-input pseudo-element weight plus its own dark-mode block, against a smaller overlay/auto-hide section, and the two can land on either side.

- [ ] **Step 2: Write the failing budget test**

In `scripts/bundle-budgets.test.mjs`, alongside the existing `theme.css` assertions, add the same shape for `docked.css` (read the file's existing test to match its exact structure -- it locates the target with `targets.find((target) => target.name === '@playdeck/react/theme.css')` and asserts `measureTarget` against a real read of the file):

```js
const dockedTarget = targets.find(
  (target) => target.name === '@playdeck/react/docked.css'
);
test('docked.css has a bundle budget target', () => {
  assert.ok(dockedTarget);
});
```

- [ ] **Step 3: Run and watch it fail**

```bash
node --test scripts/bundle-budgets.test.mjs
```

- [ ] **Step 4: Add the target**

In `scripts/bundle-budgets.mjs`'s `targets` array, after the `theme.css` entry, using the figure step 1 measured (`<BUDGET>` below is a placeholder -- write the real number):

```js
  {
    // Standalone, like theme.css, and carries the same weight: the shared
    // range-input pseudo-element rules and forced-colors block, this time
    // against a smaller layout section since docked.css never overlays or
    // auto-hides. Measured, not assumed equal to theme.css's 2.5 KB.
    name: '@playdeck/react/docked.css',
    path: 'packages/react/docked.css',
    budget: <BUDGET>,
    budgetedSubset: { label: 'CSS rules', extract: stripCssComments }
  },
```

- [ ] **Step 5: Run and watch it pass**

```bash
node --test scripts/bundle-budgets.test.mjs
pnpm test:budgets
```

- [ ] **Step 6: Add the second packaging fixture page**

Create `tests/packaging/fixture/docked.html`, copied from `index.html` with a different token value and script path:

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Playdeck packaging fixture (docked)</title>
  </head>
  <body>
    <!-- Same mechanism as index.html, a different value so the two pages'
         assertions cannot pass by reading each other's fixture by accident. -->
    <div id="root" style="--playdeck-color-on-surface: rgb(4, 5, 6)"></div>
    <script type="module" src="/src/docked.tsx"></script>
  </body>
</html>
```

Create `tests/packaging/fixture/src/docked.tsx`:

```tsx
import { createRoot } from 'react-dom/client';
import * as Player from '@playdeck/react';
// The docked subpath, resolved the same way theme.css is in src/main.tsx: a
// separate page rather than a second import on the same document, because
// both files declare `@layer playdeck` and would otherwise compete for the
// same selectors on source order alone.
import '@playdeck/react/docked.css';

const Fixture = () => (
  <Player.Root loading="eager" source="/fixture.mp4">
    <Player.Viewport style={{ aspectRatio: '16 / 9', width: '320px' }}>
      <Player.Media />
      <Player.ActivationButton />
    </Player.Viewport>
  </Player.Root>
);

createRoot(document.getElementById('root')!).render(<Fixture />);
```

- [ ] **Step 7: Extend `smokeTest` to check both pages**

In `scripts/verify-packaging.mjs`, factor the body of the existing `smokeTest` page-load-and-assert block into a helper taking the pathname and the expected colour, and call it twice:

```js
/**
 * @param {import('@playwright/test').Page} page
 * @param {string} baseUrl
 * @param {string} pathname
 * @param {string} expectedColor
 */
const assertThemedPage = async (page, baseUrl, pathname, expectedColor) => {
  await page.goto(`${baseUrl}${pathname}`);
  const media = page.locator('[data-playdeck-part="media"]');
  await media.waitFor();
  const source = await media.locator('source').getAttribute('src');
  if (source !== '/fixture.mp4') {
    throw new Error(
      `Expected the smoke player on ${pathname} to request /fixture.mp4, got: ${source}`
    );
  }
  const themedColor = await page
    .locator('[data-playdeck-part="viewport"]')
    .evaluate(
      (/** @type {Element} */ element) =>
        globalThis.getComputedStyle(element).color
    );
  if (themedColor !== expectedColor) {
    throw new Error(
      `${pathname} did not reach the page: the viewport should read its ` +
        `colour from the token the fixture sets, expected ${expectedColor}, got ${themedColor}.`
    );
  }
};
```

Then, inside `smokeTest`, replace the existing inline block with:

```js
    await assertThemedPage(
      page,
      `http://127.0.0.1:${address.port}`,
      '/index.html',
      'rgb(1, 2, 3)'
    );
    await assertThemedPage(
      page,
      `http://127.0.0.1:${address.port}`,
      '/docked.html',
      'rgb(4, 5, 6)'
    );
```

`docked.html` needs its own dist output. `tests/packaging/fixture/vite.config.ts`
is today just:

```ts
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()]
});
```

No `build`/`rollupOptions` key at all -- Vite's default multi-page behaviour
already picks up every `*.html` file in the project root as its own entry
with no config, which is why `index.html` alone works today with nothing
declared. Adding `docked.html` alongside it is enough on its own; nothing in
this file needs to change. If the build does NOT pick up `docked.html` (a
Vite version where the default no longer discovers every root HTML file),
add the entry points explicitly:

```ts
import { resolve } from 'node:path';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// `import.meta.dirname`, not `__dirname` -- this file's own `package.json`
// carries `"type": "module"`.
export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      input: {
        index: resolve(import.meta.dirname, 'index.html'),
        docked: resolve(import.meta.dirname, 'docked.html')
      }
    }
  }
});
```

- [ ] **Step 8: Run the whole packaging check**

```bash
pnpm test:packages
```

No `--update-fixture-lockfile` here: this task adds no dependency, so the
fixture's lockfile is unchanged. That flag is for when the fixture's
`package.json` gains or moves a dependency, which adding `docked.html` and
`docked.tsx` does not do.

This is a real browser build-and-smoke-test pass; expect it to take a few minutes.

- [ ] **Step 9: Write the changeset**

```bash
cat > .changeset/docked-css-and-three-fixes.md <<'EOF'
---
"@playdeck/react": minor
---

Add `@playdeck/react/docked.css`, a second theme that docks the control bar
under the picture instead of overlaying it, never auto-hides, and carries its
own light/dark colour defaults.

Alongside it, three fixes to `theme.css`: the seek and volume thumbs now sit
on their own track instead of drifting with the consumer's inherited font
(#541); the activation part's size is now a floor a consumer's own sizing and
label can grow past, rather than a fixed value that clipped or silently
overrode them (#552); and a bare player with no stylesheet no longer paints
the browser's own button face over its poster (#555).

`theme.css` also gains an auto-hiding, wrapping control bar: the bar splits
onto its own row for the seek slider below 48rem, the volume slider expands on
hover or focus instead of taking up permanent width, and the whole bar fades
after 2500ms of no input while playing.
EOF
git add .changeset/docked-css-and-three-fixes.md
```

- [ ] **Step 10: Commit**

```bash
git add tests/packaging/fixture scripts/bundle-budgets.mjs scripts/bundle-budgets.test.mjs scripts/verify-packaging.mjs
git commit -m "package docked.css: exports, a measured bundle budget, and a second smoke-tested fixture"
```

---

### Task 13: The a11y sweep under `docked.css`

**Files:**
- Modify: `apps/storybook/.storybook/theme.tsx`
- Modify: `apps/storybook/.storybook/preview.tsx`
- Modify: `e2e/a11y.spec.ts`

`apps/storybook/stories/reference/import-rule.contract.test.ts` (its
`rejected` list includes `'../../../packages/react/theme.css'`, and its
`no-restricted-imports` config in `eslint.config.js` scopes `files:
['apps/storybook/stories/reference/**/*.{ts,tsx}']`) forbids any file inside
that directory from importing a stylesheet out of `packages/`, so a new
wrapper story living there -- the shape an earlier draft of this task
offered as one of three options -- cannot import `docked.css` and does not
survive that lint rule. `apps/storybook/.storybook/theme.tsx` and
`preview.tsx` are outside that directory and already import `theme.css` the
same way (`themeCss` from `'../../../packages/react/theme.css?inline'`), so
this task extends that existing, already-working mechanism with a third
value instead of adding a new story file:

- [ ] **Step 1: Add a third toolbar value that mounts `docked.css`**

In `apps/storybook/.storybook/theme.tsx`:

```tsx
import type { Decorator } from '@storybook/react-vite';
import themeCss from '../../../packages/react/theme.css?inline';
import dockedCss from '../../../packages/react/docked.css?inline';

export const withCss =
  (css: string): Decorator =>
  (Story) => (
    <>
      <style>{css}</style>
      <Story />
    </>
  );

const withThemeCss = withCss(themeCss);
const withDockedCss = withCss(dockedCss);

export const withTheme: Decorator = (Story, context) => {
  if (context.globals.theme === 'themed') return withThemeCss(Story, context);
  if (context.globals.theme === 'docked') return withDockedCss(Story, context);
  return <Story />;
};
```

In `apps/storybook/.storybook/preview.tsx`, add the third toolbar item next
to `headless`/`themed`:

```ts
  globalTypes: {
    theme: {
      description: 'Mount the optional @playdeck/react/theme.css or docked.css',
      toolbar: {
        title: 'Theme',
        icon: 'paintbrush',
        items: [
          { value: 'headless', title: 'Headless' },
          { value: 'themed', title: 'Themed' },
          { value: 'docked', title: 'Docked' }
        ],
        dynamicTitle: true
      }
    }
  },
```

`initialGlobals: { theme: 'headless' }` is unchanged -- the default stays
unthemed.

This reaches `Reference/Player` the same way it already reaches every other
story: `reference-player.tsx`'s own header comment records that "the toolbar
Theme toggle DOES apply to this story" even though its `layoutCss` is
unlayered and beats both theme files' `@layer playdeck` rules for any
property `layoutCss` itself sets -- which is why `e2e/theme-idle.spec.ts`
(task 9) can already assert `theme.css`'s auto-hide opacity against this
same story under `globals=theme:themed`: `layoutCss` declares no `opacity`
on `[data-playdeck-part='controls']`, so that one property is free for
whichever theme is mounted to reach. Toggling to `docked` reaches the DOM
structure and ARIA wiring axe scans either way, plus every property
`layoutCss` leaves unset; it does not change `layoutCss`'s own rendered
colours or layout, the same limitation the existing `themed` toggle already
has on this composition.

- [ ] **Step 2: Add the docked story URL and the failing test loop**

In `e2e/a11y.spec.ts`, alongside the existing `story()` helper:

```ts
const dockedStory = (id: string) =>
  `/iframe.html?id=reference-player--${id}&viewMode=story&globals=a11y.manual:!true;theme:docked`;
```

Then, alongside the existing `for (const state of states)` loop:

```ts
for (const state of states) {
  test(`no accessibility violations in the docked ${state.name} state`, async ({
    page
  }) => {
    await page.goto(
      state.url === composition
        ? dockedStory('composition')
        : dockedStory(state.name === 'global-shortcuts' ? 'global-shortcuts' : state.name)
    );
    if (state.open) {
      // same open-menu setup the existing loop above this one uses
    }
    const results = await scan(page);
    expect(results.violations).toEqual([]);
    expect(results.incomplete.map((incomplete) => incomplete.id)).toEqual(
      state.knownIncomplete ?? []
    );
  });
}
```

`states[].url` is already a full URL built by `story()`, not a bare story
id, so `dockedStory` cannot take it directly -- rebuild the id from
`state.name` instead, matching `story()`'s own id-to-url shape; adjust the
mapping above once `states`' real id spellings (`idle`, `playing`,
`composition`, `blocked-autoplay`, `global-shortcuts`, `error-state`) are
checked against the file, since `state.name` and the story id it was built
from are not always the same string (`error` the state name, `error-state`
the story id, is one of the differences already visible above).

- [ ] **Step 3: Run and watch it fail (or pass) honestly**

```bash
pnpm exec playwright test e2e/a11y.spec.ts -g "docked" --project=chromium
```

If `knownIncomplete` entries differ from the floating theme's (a
`color-contrast` finding docked.css doesn't have, say, because its menu
draws a real border instead of relying on an example class), that is real
information -- diagnose it the way the existing `knownIncomplete` comments
do, with a reason written above the entry, never an unexamined absorption.

- [ ] **Step 4: Run the whole file**

```bash
pnpm exec playwright test e2e/a11y.spec.ts --project=chromium
```

- [ ] **Step 5: Commit**

```bash
git add apps/storybook/.storybook/theme.tsx apps/storybook/.storybook/preview.tsx e2e/a11y.spec.ts
git commit -m "mount docked.css from a third toolbar value, and scan the reference composition under it"
```

---

### Task 14: The gate

- [ ] **Step 1: Run everything**

```bash
pnpm typecheck
pnpm lint
pnpm test
pnpm test:packages
pnpm test:budgets
pnpm test:e2e
```

- [ ] **Step 2: If `pnpm typecheck` fails**

Almost certainly the `viewport-media.tsx` idle effect or the packaging fixture's new `docked.tsx`. Check the `controller.subscribe` callback's parameter type against `PlayerState` and that `docked.tsx` imports resolve the same way `main.tsx` does.

- [ ] **Step 3: If `pnpm lint` fails**

Check for an unused import in `theme.test.ts` (`existsSync` if task 11's `dockedSource` guard is later simplified once the file always exists) and for the two-space vs four-space CSS indentation matching the rest of `theme.css`/`docked.css`.

- [ ] **Step 4: If `pnpm test` fails**

Re-run the single failing file alone (`pnpm vitest run <path>`) before assuming a regression -- nothing in this repo's Vitest config shares the CPU-contention flake `playwright.config.ts` documents for e2e, so a Vitest failure here is real.

- [ ] **Step 5: If `pnpm test:packages` fails**

Almost certainly the fixture's Vite config not building `docked.html` as a second entry, or the lockfile replay check (`node scripts/verify-packaging.mjs --update-fixture-lockfile` first, then re-run).

- [ ] **Step 6: If `pnpm test:budgets` fails**

The measured figure from task 12 step 1 was rounded down instead of up, or `docked.css` grew after that measurement was taken. Re-measure with the same command and update the `budget` value in `scripts/bundle-budgets.mjs`.

- [ ] **Step 7: If `pnpm test:e2e` fails**

Re-run the named spec alone with `--project=chromium` first. `webkit` may not be available on this machine; if so, run chromium and firefox and note that CI carries webkit.

```bash
pnpm exec playwright test <spec-file> --project=chromium
```

- [ ] **Step 8: Confirm the dash count and finish**

```bash
git log --oneline -20
```

Confirm every commit message from this plan is imperative, lower case after the first word, no type prefix, and carries no co-author trailer -- matching the rest of this log.
