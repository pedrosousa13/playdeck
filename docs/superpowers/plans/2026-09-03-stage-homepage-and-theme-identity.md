# A stage for the player, and a new identity for both themes: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redraw `theme.css` and `docked.css` with a new visual identity (deeper scrim, thicker/growing seek bar, a gradient fill, a hover/pressed control state, dimmed duration), give `theme.css` a real docked layout below 48rem, and rebuild `/` as "The Stage": a lit player under one big line, a restyled bench, a highlight on the changed composition line and a crossfade on the stage when a switch flips, four advertising feature cards, and a rewritten close — all within the rulings the spec fixed.

**Architecture:** The two package stylesheets (`packages/react/theme.css`, `packages/react/docked.css`) stay standalone — no shared `@import`, shared rules duplicated — and keep every token name a consumer may already be overriding, so this is a redraw of defaults and additions of new tokens, not a rename. The site changes are layout and motion on top of markup that already exists: `Bench.astro` keeps deciding what the instrument looks like, `BenchIsland.tsx` keeps composing primitives, and `CompositionPanel.tsx`/`BenchSwitches.tsx` change only their own presentation. `index.astro` gets a new hero and close and one CSS-only entrance animation gated on a script-set attribute, matching the site's own "no default hides an element" rule. A new `FeatureCards.astro` component owns the four advertising cards, highlighted at build time through the same `shiki.ts` config the composition panel already uses.

**Tech Stack:** `@playdeck/react` (CSS, no new components), Vitest (`packages/react/test/theme.test.ts`), Astro + React islands (`apps/site`), Tailwind-less scoped `<style>` blocks reading `apps/site/src/styles/tokens.css` roles, Playwright (`e2e/`), `scripts/bundle-budgets.mjs` / `scripts/check-bundle-budgets.mjs`.

**Spec:** `docs/superpowers/specs/2026-09-03-stage-homepage-and-theme-identity-design.md`. Read it before starting. Every ruling in it has been approved and is not yours to revisit.

---

## Before you start

### The rulings that are not open for debate (restated from the spec's header)

- No capability table, grid, list, or one-line report on `/`. The word "ledger" appears nowhere.
- No autoplay demonstration on `/`. Autoplay recovery is **advertised** in a feature card with its real prop name (`autoplay="audible-then-muted"`), never demonstrated.
- No claim about any other library, named or implied.
- The archetypes stay on `/archetypes`. Nothing brings them back to `/`.
- The two sheets (`theme.css`, `docked.css`) stay standalone: no shared `@import`, shared rules duplicated verbatim into both.
- The two sheets differ in layout on desktop, not only in colour (`docked.css` still docks below the picture; `theme.css` still floats over it).
- **Nothing is pushed until the maintainer has seen the page running** — Task 9 is a local screenshot pass, not a merge.

### Selectors and contracts every task must preserve

Grep for these after every task; a task that breaks one is not done, whatever its own tests say.

| Contract | Owner | Consumed by |
| --- | --- | --- |
| `h1` text exactly `Playdeck`, exactly one on the page | `index.astro` | `scripts/check-deploy-artifact.mjs`, `e2e/site-nav.spec.ts`, `e2e/site-landing.spec.ts` |
| `data-install`, `data-install-command`, `data-install-copy`, `data-install-status` | `index.astro` | `e2e/site-landing.spec.ts`'s copy tests |
| `data-bench-switch="source"` / `="skin"`, `data-value` | `BenchSwitches.tsx` | `e2e/site-bench.spec.ts`, `e2e/site-quiet.spec.ts` |
| `data-bench-composition` on the printed `<pre>` | `Bench.astro`'s Shiki transformer | `e2e/site-bench.spec.ts`, `e2e/site-landing.spec.ts` |
| `.bench__quiet` | `BenchIsland.tsx`'s `QuietLine`, `Bench.astro`'s `<noscript>` | `e2e/site-quiet.spec.ts` |
| `[data-playdeck-part="viewport"|"controls"|"media"|...]` | the library primitives | `e2e/locators.ts`, `e2e/site-bench.spec.ts`'s grid-shape tests |
| `data-bench-skin` on `#bench-stage` and on `[data-playdeck-part='viewport']` | `BenchIsland.tsx`'s `StagePortal` | `Bench.astro`'s docked-only CSS, `e2e/site-bench.spec.ts` |
| `<Player.Root` opening the printed tree, the four-line preamble | `bench-composition.ts` | `e2e/site-bench.spec.ts`'s `tree`/`preambleLines` helpers |
| No `a[href*="storybook" i]`, no text `storybook`/`workbench`/`ledger` | whole page | `e2e/site-landing.spec.ts` |

### Two non-obvious technical findings from reading the source, both load-bearing

1. **`tokenDefault()` in `theme.test.ts` throws if a token is read with more than one distinct fallback anywhere in the file.** Task 2 gives `--playdeck-color-track` and `--playdeck-color-buffered` a *second*, phone-only fallback inside the new `@media (max-width: 48rem)` block (they need an opaque default there — the existing translucent-white default is built for a dark video backdrop and is close to invisible on the new flat surface). Left alone this breaks every test in the `slider non-text contrast` describe block with a thrown error, not a red assertion. Task 2 changes `tokenDefault()` to read only the text **outside** that media query block, so the "one fallback" invariant still means what it always meant — the *desktop* default — while the phone block is free to diverge the way `docked.css` already does.
2. **`theme.css` never gives `[data-playdeck-part='controls']` a `position`, and cannot.** Every rule in the file is `:where()`-in-a-layer, which loses to *any* unlayered rule regardless of specificity — including `Bench.astro`'s own `place-self: end stretch` rule for the `theme` skin, which has no width query and is not touched by this plan. So the docking CSS Task 2 adds is real and testable in isolation (a bare consumer, Storybook, or the theme test's own text assertions), but **inert on the real bench**, where `skin='theme'` is unreachable below 48rem anyway (`BenchIsland` defaults to `docked` there and the switch is `hidden` under `md:`). This matches the spec's own ruling ("The bench is unchanged") and is not a bug to chase.

### The stale-server trap

Both `theme.css` and `docked.css` ship through the Storybook workbench (`pnpm --filter @playdeck/storybook exec storybook dev`) and through the built site (`scripts/serve-site.mjs`). Playwright's `webServer` config has `reuseExistingServer: !process.env.CI` for both entries, so a Storybook or `serve-site.mjs` process left running from an earlier `pnpm test:e2e` invocation is silently reused and **does not pick up a new build**. If an e2e assertion fails against CSS you just changed, first run `pkill -f "storybook dev"` and `pkill -f "serve-site.mjs"` (or check `lsof -i :4173` / `:4322`) before re-running — a green run against a stale server is not evidence, and a red run against one looks exactly like a real regression.

### The `@real` tag

`e2e/site-bench.spec.ts` and `e2e/site-quiet.spec.ts` have tests tagged `@real` that contact `youtube.com`/`vimeo.com` for real. They are excluded from the default `pnpm test:e2e` run (`grepInvert` on `/@real/` unless `PLAYDECK_REAL_PROVIDERS=1` is set). Task 6's new test does **not** need `@real` — it only needs the composition panel and the switches, neither of which requires activation. Do not tag it `@real`.

---

## File structure

**Created**

| File | Responsibility |
| --- | --- |
| `apps/site/src/components/FeatureCards.astro` | The four advertising cards: Compose, Style, Query, Recover |

**Modified**

| File | Change |
| --- | --- |
| `packages/react/theme.css` | New identity (Tasks 1–2): scrim, seek bar, thumb, buttons, times, docking below 48rem |
| `packages/react/docked.css` | Same identity (Task 3), plus the gradient fill's new pinned function |
| `packages/react/test/theme.test.ts` | `tokenDefault()` scoped outside the phone-docking block; the 48rem test rewritten; a new phone-docking test; `docked.css`'s fixture gains `linear-gradient` |
| `apps/site/src/pages/index.astro` | New hero (install block + Start link moved up), entrance script/CSS, new close |
| `apps/site/src/components/Bench.astro` | `.bench__frame` glow/ring, stage crossfade rule |
| `apps/site/src/components/BenchIsland.tsx` | Drops the two-column grid; diffs compositions for the changed-line highlight; drives the crossfade |
| `apps/site/src/components/BenchSwitches.tsx` | Segmented-pill restyle, groups laid out for the new one-row layout |
| `apps/site/src/components/CompositionPanel.tsx` | Sets/clears `data-changed` on the changed `.line`s |
| `apps/site/src/styles/base.css` | `.line[data-changed]` highlight rule |
| `apps/site/DESIGN.md` | This spec's rulings, the new tokens, the budget rule, the capability-argument amendment, the entry-motion amendment |
| `e2e/site-bench.spec.ts` | New test: changed-line highlight appears and clears |
| `e2e/site-landing.spec.ts` | New test: the four cards, in order |

---

### Task 1: `theme.css`'s new identity (desktop)

**Files:**
- Modify: `packages/react/theme.css`
- Test: `packages/react/test/theme.test.ts` (verify only — no assertion in this task changes)

Every change below is desktop/default CSS: no media query, no token whose *fallback* changes here participates in the pinned "slider non-text contrast" ratios (`--playdeck-color-track`, `-buffered`, `-accent`, `-thumb-ring`, `-backdrop`, `-focus` are untouched). Confirm that before starting: the ratio table in `theme.test.ts`'s `states the composited ratio of every slider boundary` test is expected to be **byte-identical** before and after this task.

- [ ] **Step 1: Record the baseline**

```bash
pnpm vitest run packages/react/test/theme.test.ts
```

All tests pass. Note this — Task 1 has no red step of its own, because nothing in this task is asserted yet; the check at the end of the task is that everything **still** passes with the new CSS in place.

- [ ] **Step 2: Deepen and lengthen the scrim**

In the header comment's token table (`* Overlays --playdeck-overlay-scrim bottom-up black gradient`), no literal to change. In the `controls` rule:

```css
    background: var(
      --playdeck-overlay-scrim,
      linear-gradient(to top, rgb(0 0 0 / 0.72), rgb(0 0 0 / 0))
    );
```

becomes

```css
    background: var(
      --playdeck-overlay-scrim,
      linear-gradient(to top, rgb(0 0 0 / 0.78), rgb(0 0 0 / 0) 65%)
    );
```

- [ ] **Step 3: Move the seek bar's thickness, and add its hover/focus growth**

Every `var(--playdeck-slider-thickness, 0.25rem)` read becomes `var(--playdeck-slider-thickness, 0.375rem)` — 10 occurrences in the CSS and 1 in the header comment table. Verify the count first, then replace:

```bash
grep -c -- "--playdeck-slider-thickness, 0.25rem" packages/react/theme.css   # expect 10
sed -i 's/--playdeck-slider-thickness, 0\.25rem/--playdeck-slider-thickness, 0.375rem/g' packages/react/theme.css
sed -i 's/--playdeck-slider-thickness    0\.25rem/--playdeck-slider-thickness    0.375rem/' packages/react/theme.css
```

Then add growth-on-hover/focus immediately after the `[data-playdeck-part='seek-slider']` rule (the one with `flex: 1 1 100%`), before `seek-buffered`:

```css
  /* Growth by custom-property redeclaration, not by a hover-scoped copy of
   * every rule below that reads the thickness: every one of them already
   * reads `--playdeck-slider-thickness` with a fallback, and a custom
   * property set here is inherited by all of them, so overriding the
   * inherited value is what makes "every rule that reads it follows" true.
   * `:focus-within` rather than `:focus`, because the element carrying focus
   * is `seek-slider-input`, a descendant of this part and not this part
   * itself. */
  :where([data-playdeck-part='seek-slider']:hover),
  :where([data-playdeck-part='seek-slider']:focus-within) {
    --playdeck-slider-thickness: 0.5rem;
  }
```

- [ ] **Step 4: Gradient fill**

Header token table: add a row under `Color`, immediately after `--playdeck-color-accent`:

```
 *                --playdeck-color-accent-tint   #9dd0ff
```

Inside the `@media (forced-colors: none)` block, the `seek-progress` rule:

```css
    :where([data-playdeck-part='seek-progress']) {
      inset-block: 0;
      border-radius: inherit;
      background-color: var(--playdeck-color-accent, #3ea6ff);
    }
```

becomes (shorthand `background`, never `background-image` — `e2e/poster.spec.ts`'s `cssBackgroundImageViolations` text-scans every `.css` file under `packages/**` for the literal string `background-image`, and would fail the build on that spelling):

```css
    :where([data-playdeck-part='seek-progress']) {
      inset-block: 0;
      border-radius: inherit;
      background: linear-gradient(
        to right,
        var(--playdeck-color-accent, #3ea6ff),
        var(--playdeck-color-accent-tint, #9dd0ff)
      );
    }
```

Leave `::-moz-range-progress`'s own `background-color: var(--playdeck-color-accent, ...)` alone — the rule two above `seek-progress` sets `seek-slider-input`'s own `::-moz-range-track`/`::-moz-range-progress` to `transparent` later in the same block (the existing rule at the very end of the `forced-colors: none` query), so the combined rule's accent fill only ever paints for `volume-slider`, which is not part of this redraw.

- [ ] **Step 5: Hide the thumb at rest, grow it on hover/focus**

Still inside `@media (forced-colors: none)`. The Gecko thumb rule:

```css
    :where(
      [data-playdeck-part='seek-slider-input'],
      [data-playdeck-part='volume-slider']
    )::-moz-range-thumb {
      box-sizing: border-box;
      inline-size: calc(var(--playdeck-slider-thickness, 0.375rem) * 4);
      block-size: calc(var(--playdeck-slider-thickness, 0.375rem) * 4);
      border: 2px solid var(--playdeck-color-thumb-ring, #000);
      border-radius: 50%;
      background-color: var(--playdeck-color-accent, #3ea6ff);
    }
```

Leave this one alone — it still paints `volume-slider`'s thumb, which keeps its old size. The **seek-only** WebKit thumb rule, further down (quoted here with its own existing comment, so the match below is against the real file):

```css
    :where([data-playdeck-part='seek-slider-input'])::-webkit-slider-thumb {
      appearance: none;
      box-sizing: border-box;
      inline-size: calc(var(--playdeck-slider-thickness, 0.375rem) * 4);
      block-size: calc(var(--playdeck-slider-thickness, 0.375rem) * 4);
      /* The ring is this border; the `outline` above also applies, and the two
       * together draw a 20px thumb beside Gecko's 16px. */
      outline: none;
      border: 2px solid var(--playdeck-color-thumb-ring, #000);
      border-radius: 50%;
      background-color: var(--playdeck-color-accent, #3ea6ff);
    }
```

changes its `inline-size`/`block-size` to `0`, and folds the existing ring comment together with the new hiding behaviour rather than stacking two comments that would otherwise say adjacent things:

```css
    :where([data-playdeck-part='seek-slider-input'])::-webkit-slider-thumb {
      appearance: none;
      box-sizing: border-box;
      /* Hidden at rest, 16px on hover/focus below. Zero size rather than
       * `opacity: 0` — a zero-size box has no hit area of its own, so a
       * press lands on the track underneath it; an invisible-but-full-size
       * thumb would still eat that click. Opacity stays at its default 1, on
       * purpose: nothing here relies on opacity to hide it.
       *
       * The ring is still this border, and the `outline` above still also
       * applies: on hover/focus the two together draw a 20px thumb beside
       * Gecko's 16px, the same figure as before this task -- unchanged
       * because the 16px content box plus this 2px border each side is the
       * same total the old `calc(thickness * 4)` formula gave at the old
       * 0.25rem thickness. */
      inline-size: 0;
      block-size: 0;
      opacity: 1;
      outline: none;
      border: 2px solid var(--playdeck-color-thumb-ring, #000);
      border-radius: 50%;
      background-color: var(--playdeck-color-accent, #3ea6ff);
    }
```

Gecko's own seek-only thumb rule needs the *first* occurrence you see (the one at `seek-slider-input, volume-slider`) left untouched (volume keeps its size) — there is no seek-only `::-moz-range-thumb` rule today, so add one, directly after the `::-webkit-slider-thumb` rule above but still inside `forced-colors: none`, mirroring it:

```css
    :where([data-playdeck-part='seek-slider-input'])::-moz-range-thumb {
      inline-size: 0;
      block-size: 0;
      opacity: 1;
    }
```

This is a second, more specific rule than the shared `seek-slider-input, volume-slider` Gecko thumb rule above it (same specificity via `:where()`, later in source order, so it wins on the seek input alone — matching how the file already overrides Gecko's track/progress per-input at the foot of this block).

Then, immediately after both (still inside `forced-colors: none`), the hover/focus growth:

```css
    /* 16px on hover or focus of the seek-slider part, a literal rather than
     * a `calc()` off the thickness token — the two are deliberately
     * decoupled now that hovering also grows the thickness to 0.5rem, which
     * would make the old `calc(thickness * 4)` formula 32px. Grown by size,
     * not `transform: scale()`: `scale` is not in this file's pinned
     * function list and there is no reason to add one. The existing ring
     * (the unconditional `::-webkit-slider-thumb { outline: ... }` rule
     * above this query) is untouched and keeps drawing around whatever
     * geometry is current. */
    :where(
      [data-playdeck-part='seek-slider']:hover,
      [data-playdeck-part='seek-slider']:focus-within
    )
      :where([data-playdeck-part='seek-slider-input'])::-moz-range-thumb,
    :where(
      [data-playdeck-part='seek-slider']:hover,
      [data-playdeck-part='seek-slider']:focus-within
    )
      :where([data-playdeck-part='seek-slider-input'])::-webkit-slider-thumb {
      inline-size: 1rem;
      block-size: 1rem;
    }
```

Both new rules stay **inside** `@media (forced-colors: none)`: their selector text contains the literal substrings `::-moz-range-thumb` and `::-webkit-slider-thumb`, which are two of the pinned `forcedColorsSliderNeedles` — `theme.test.ts`'s `leaves every hand-drawn slider rule out of forced-colors mode` test fails if either string appears **outside** that query.

- [ ] **Step 6: Button radius and pressed state**

The button box rule's `border-radius`:

```css
    border-radius: var(--playdeck-radius, 0.375rem);
```

(the one inside the 7-part button selector group, **not** the ones in `error-retry` or `menu-item` — leave those at `0.375rem`) becomes:

```css
    border-radius: var(--playdeck-radius, 0.625rem);
```

Header token table: add a row under `Controls`, after `--playdeck-slider-thickness`:

```
 *                --playdeck-control-pressed     rgb(255 255 255 / 0.2)
```

Immediately after the existing `:where(:hover) { background-color: var(--playdeck-control-hover, ...); }` rule for the 7 button parts, add the pressed state with the same 7-part selector group:

```css
  :where(
    [data-playdeck-part='play-button'],
    [data-playdeck-part='mute-button'],
    [data-playdeck-part='captions-button'],
    [data-playdeck-part='fullscreen-button'],
    [data-playdeck-part='pip-button'],
    [data-playdeck-part='airplay-button'],
    [data-playdeck-part='settings-menu-trigger']
  ):where(:active) {
    background-color: var(--playdeck-control-pressed, rgb(255 255 255 / 0.2));
  }
```

This keeps `theme.test.ts`'s `every button-shaped part is carried by every button rule` test green without editing it: the test scans every selector list naming *only* button parts and requires all seven names in each, and this new rule is the same seven names as its neighbour.

- [ ] **Step 7: Dim the duration time**

```css
  :where([data-playdeck-part='time'][data-time-type='duration']) {
    margin-inline-end: auto;
  }
```

becomes

```css
  :where([data-playdeck-part='time'][data-time-type='duration']) {
    margin-inline-end: auto;
    /* The current time stays full ink; only the total dims, which is what
     * reads as "less important" without a second colour. `theme.css` has no
     * selector that can reach a *consumer's* separator text between the two
     * `Player.Time`s (it carries no `data-playdeck-part` and there is no
     * previous-sibling combinator in CSS), so a composition that wants its
     * own separator dimmed to match does that itself — see `BenchIsland.tsx`
     * if this page's own separator should follow suit. */
    opacity: 0.64;
  }
```

`font-variant-numeric: tabular-nums` is already on the base `[data-playdeck-part='time']` rule — nothing to add there.

- [ ] **Step 8: Verify**

```bash
pnpm vitest run packages/react/test/theme.test.ts
```

Expect: every test still passes, including `states the composited ratio of every slider boundary` with **unchanged** literals — that is the assertion that nothing in this task touched a ratio-tested token's default. If any of the five asserted boundaries fails, you changed a token this task was not supposed to touch; revert and re-check Steps 2–7.

- [ ] **Step 9: Measure the budget**

```bash
pnpm --filter @playdeck/react build
node scripts/check-bundle-budgets.mjs
```

Read the `@playdeck/react/theme.css` row's `CSS rules` figure. The spec's floor is 2.5 kB and the 2026-09-03 baseline was 2.00 kB; this task is not expected to cross it, but if it does, raise the budget for `theme.css` to `3.0` in `scripts/bundle-budgets.mjs`'s `targets` array **in this same commit**, with the reason in the commit message (see the design's Budget section — the design is not thinned to fit).

- [ ] **Step 10: Commit**

```bash
git add packages/react/theme.css
git commit -m "redraw theme.css: deeper scrim, growing seek bar, gradient fill, pressed state, dimmed duration"
```

---

### Task 2: `theme.css` docking below 48rem

**Files:**
- Modify: `packages/react/theme.css`, `packages/react/test/theme.test.ts`

- [ ] **Step 1: Write the failing tests**

Two changes to `theme.test.ts`. First, `tokenDefault()` (the module-scope helper used by the `slider non-text contrast` describe) is scoped to skip the new phone block. Find:

```ts
const tokenDefault = (name: string): string => {
  const reads = new RegExp(`var\\(\\s*${name}\\s*,\\s*`, 'g');
  const defaults = new Set<string>();
  for (
    let read = reads.exec(withoutComments);
    read !== null;
    read = reads.exec(withoutComments)
  ) {
```

Add, directly above the `tokenDefault` declaration, a derivation of the text with the phone-docking block removed, walking braces the same way `leaves every hand-drawn slider rule out of forced-colors mode` already does for the forced-colors query:

```ts
/**
 * `withoutComments` with the `@media (max-width: 48rem)` block's contents
 * removed, so `tokenDefault` reads only the desktop default of a token that
 * this block deliberately gives a second phone-only fallback -- a third,
 * nested inside its own dark-scheme query -- for `-track` and `-buffered`,
 * so far. Without this, `tokenDefault` finds more than one distinct
 * fallback for the same token and throws -- correctly, since agreement is
 * what makes it a trustworthy reading of what ships, but the phone block is
 * an intentional divergence and not a defect for it to catch.
 */
const withoutPhoneDockingBlock = (() => {
  const query = /@media\s*\(\s*max-width:\s*48rem\s*\)/.exec(withoutComments);
  if (query === null) return withoutComments;
  const start = query.index;
  let depth = 0;
  let end = withoutComments.indexOf('{', start);
  for (; end < withoutComments.length; end++) {
    if (withoutComments[end] === '{') depth++;
    else if (withoutComments[end] === '}' && --depth === 0) break;
  }
  return withoutComments.slice(0, start) + withoutComments.slice(end + 1);
})();

const tokenDefault = (name: string): string => {
  const reads = new RegExp(`var\\(\\s*${name}\\s*,\\s*`, 'g');
  const defaults = new Set<string>();
  for (
    let read = reads.exec(withoutPhoneDockingBlock);
    read !== null;
    read = reads.exec(withoutPhoneDockingBlock)
  ) {
```

and inside the loop body, the two remaining reads of `withoutComments` (the brace-walk that finds each `var()`'s closing paren) become `withoutPhoneDockingBlock`:

```ts
    const start = read.index + read[0].length;
    let depth = 1;
    let end = start;
    for (; end < withoutPhoneDockingBlock.length && depth > 0; end++) {
      if (withoutPhoneDockingBlock[end] === '(') depth++;
      else if (withoutPhoneDockingBlock[end] === ')') depth--;
    }
    defaults.add(withoutPhoneDockingBlock.slice(start, end - 1).trim());
```

Second, in `describe('theme.css overlay rules (not shared with docked.css)', ...)`, replace the existing test **and the six-line comment directly above it**, which explained the old rule (no `position` written there at all) and is now misleading — this file's `@media (max-width: 48rem)` block does write `position: static` as of this task:

```ts
  // Two declarations inside one `max-width: 48rem` query, and no third: the
  // narrow fallback flattens the scrim and drops the volume slider, and says
  // nothing about where the bar sits. A `position` written here would be
  // layered `:where()` CSS, which the unlayered rule a real composition uses to
  // float the bar beats whatever this file said — so the query claims only what
  // it can deliver. Moving the bar out of the overlay is `docked.css`'s job,
  // and that theme never puts it there to begin with.
  test('flattens the scrim and drops the volume slider below 48rem', () => {
    const query = withoutComments.match(
      /@media\s*\(\s*max-width:\s*48rem\s*\)\s*\{[^]*?\n {2}\}/
    )?.[0];
    expect(query).toBeDefined();
    expect(query).toMatch(
      /background:\s*var\(--playdeck-color-surface,\s*rgb\(0 0 0 \/ 0\.72\)\)/
    );
    expect(query).toMatch(/volume-slider'\][^]*?display:\s*none/);
    expect(query).not.toMatch(/position:/);
  });
```

with:

```ts
  // A real `position` now, unlike the comment this replaces: `controls`
  // takes `position: static` and its own `grid-row` inside this query, and
  // the viewport becomes `display: grid` to give it one. That is real,
  // testable CSS for a bare consumer -- but inert on `/`'s own bench, where
  // `Bench.astro`'s own unlayered `place-self: end stretch` rule for the
  // `theme` skin carries no width query and beats this whatever the
  // viewport, per header rule 1. See this plan's "Before you start" section
  // for the fuller account; the short version is that `theme` is unreachable
  // below 48rem on the real bench anyway, so the two never actually collide.
  /**
   * The whole `@media (max-width: 48rem)` block's text, walked by brace depth
   * rather than matched by a fixed-line regex -- the block now nests a second
   * `@media (prefers-color-scheme: dark)` query, so its own closing brace is
   * not the first `\n  }` after the opener any more.
   */
  const phoneDockingBlock = (): string => {
    const query = /@media\s*\(\s*max-width:\s*48rem\s*\)/.exec(
      withoutComments
    );
    expect(query).not.toBeNull();
    const start = query!.index;
    let depth = 0;
    let end = withoutComments.indexOf('{', start);
    for (; end < withoutComments.length; end++) {
      if (withoutComments[end] === '{') depth++;
      else if (withoutComments[end] === '}' && --depth === 0) break;
    }
    return withoutComments.slice(start, end + 1);
  };

  test('docks the control surface below the picture, in the scheme tokens, below 48rem', () => {
    const query = phoneDockingBlock();

    // The scrim is gone: a flat surface colour, not the gradient the base
    // rule reads, and not the old translucent-black fallback either.
    expect(query).toMatch(
      /background:\s*var\(--playdeck-color-surface,\s*#f4f4f2\)/
    );
    expect(query).toMatch(
      /color:\s*var\(--playdeck-color-on-surface,\s*#1c1c1e\)/
    );
    expect(query).toMatch(
      /border-block-start:\s*1px solid var\(--playdeck-color-hairline,\s*#d9d9d6\)/
    );

    // The track and the loaded range get an opaque phone-only fallback: the
    // base rule's translucent white is built for a dark video backdrop and
    // is close to invisible on a flat light surface.
    expect(query).toMatch(
      /--playdeck-color-track,\s*#84847d/
    );
    expect(query).toMatch(
      /--playdeck-color-buffered,\s*#1c1c1e/
    );

    // Nothing hides on a phone: idle no longer fades the bar.
    expect(query).toMatch(
      /:where\(\[data-idle='true'\] \[data-playdeck-part='controls'\]\)\s*\{[^}]*opacity:\s*1;[^}]*pointer-events:\s*auto;/
    );

    expect(query).toMatch(/volume-slider'\][^]*?display:\s*none/);

    // The dark repeat, nested inside the same query -- the file's second
    // `@media` occurrence, which the feature-inventory test does not pin
    // (it asserts the *set* of at-rule names, and 'media' was already in it).
    const darkQuery = /@media\s*\(\s*prefers-color-scheme:\s*dark\s*\)/.exec(
      query
    );
    expect(darkQuery).not.toBeNull();
    expect(query).toMatch(
      /background:\s*var\(--playdeck-color-surface,\s*#141416\)/
    );
    expect(query).toMatch(
      /color:\s*var\(--playdeck-color-on-surface,\s*#ededed\)/
    );
    expect(query).toMatch(
      /border-block-start-color:\s*var\(--playdeck-color-hairline,\s*#2a2a2d\)/
    );
    expect(query).toMatch(/--playdeck-color-track,\s*#6d6d70/);
    expect(query).toMatch(/--playdeck-color-buffered,\s*#ededed/);
  });

  test('places the control surface in a grid row of its own below 48rem', () => {
    const query = phoneDockingBlock();
    expect(query).toMatch(
      /:where\(\[data-playdeck-part='viewport'\]\)\s*\{[^}]*display:\s*grid;[^}]*grid-template-rows:\s*1fr auto;/
    );
    expect(query).toMatch(
      /:where\(\[data-playdeck-part='controls'\]\)\s*\{[^}]*position:\s*static;[^}]*grid-row:\s*2;/
    );
  });
```

- [ ] **Step 2: Run the tests, confirm they fail**

```bash
pnpm vitest run packages/react/test/theme.test.ts
```

Expected: the two new tests fail (`docks the control surface...` and `places the control surface...`) against the still-unmodified CSS; every other test still passes, including `slider non-text contrast`, because `tokenDefault` on the current file (no phone-only fallback yet) reads the same single default either way.

- [ ] **Step 3: Rewrite the CSS**

Replace the entire `/* ---- below 48rem ... */ @media (max-width: 48rem) { ... }` block (the comment plus the rule) with:

```css
  /* ---- below 48rem --------------------------------------------------------
   * Real docking now, not only a flatter scrim: the bar leaves the overlay
   * position and takes a row of its own under the picture, in the scheme's
   * own surface tokens rather than a translucent black built for a video
   * backdrop.
   *
   * This is real CSS and it is testable in isolation -- a bare consumer with
   * no positioning of their own, a Storybook story, this file's own tests --
   * but it is inert on `/`'s own bench. `Bench.astro`'s
   * `[data-playdeck-part='controls']` rule for the `theme` skin sets
   * `place-self: end stretch` with no width query of its own, and that rule
   * is unlayered: header rule 1 means it beats anything here whatever the
   * viewport. In practice this never collides on the bench anyway, because
   * `BenchIsland` only rests on `docked` below 48rem and the skin switch is
   * `hidden` there, so `theme` is unreachable at this width on the real page.
   * What this buys is every OTHER consumer -- Storybook, the docs examples,
   * a real app that ships no positioning CSS of its own -- getting a real
   * docked bar below 48rem from `theme.css` alone.
   *
   * `display: grid` on the viewport is what gives `controls` a row to sit
   * in; `media`, `poster` and `activation` are all positioned `absolute`
   * inline by the primitives that render them (documented at the top of this
   * file), so switching the viewport from block to grid does not move them
   * -- an absolutely positioned box is excluded from grid track sizing and
   * still resolves its offsets against the same containing block either way.
   * Reserving height for the picture itself is not this rule's job and was
   * never theme.css's job at any width: "Layer geometry is deliberately NOT
   * here" at the top of this file already says so, and a bare consumer needs
   * their own sizing (an aspect-ratio wrapper, most simply) at every width,
   * not only this one.
   */
  @media (max-width: 48rem) {
    :where([data-playdeck-part='viewport']) {
      display: grid;
      grid-template-rows: 1fr auto;
    }

    :where([data-playdeck-part='controls']) {
      position: static;
      grid-row: 2;
      background: var(--playdeck-color-surface, #f4f4f2);
      color: var(--playdeck-color-on-surface, #1c1c1e);
      border-block-start: 1px solid var(--playdeck-color-hairline, #d9d9d6);
    }

    /* The scrim's translucent-white track/buffered defaults are built for a
     * dark video backdrop and read as close to invisible on this flat light
     * surface -- the same reasoning `docked.css`'s own header comment gives
     * for carrying its own opaque defaults. These two declarations are why
     * `tokenDefault()` in `theme.test.ts` is scoped to skip this block: it is
     * a deliberate second fallback, not disagreement. */
    :where([data-playdeck-part='seek-buffered']) {
      background-color: var(--playdeck-color-track, #84847d);
    }

    :where([data-playdeck-part='seek-buffered-range']) {
      background-color: var(--playdeck-color-buffered, #1c1c1e);
    }

    /* Nothing hides on a phone: there is no overlay to auto-hide over the
     * picture any more, so idle no longer fades this part. */
    :where([data-idle='true'] [data-playdeck-part='controls']) {
      opacity: 1;
      pointer-events: auto;
    }

    :where([data-playdeck-part='volume-slider']) {
      display: none;
    }

    @media (prefers-color-scheme: dark) {
      :where([data-playdeck-part='controls']) {
        background: var(--playdeck-color-surface, #141416);
        color: var(--playdeck-color-on-surface, #ededed);
        border-block-start-color: var(--playdeck-color-hairline, #2a2a2d);
      }

      :where([data-playdeck-part='seek-buffered']) {
        background-color: var(--playdeck-color-track, #6d6d70);
      }

      :where([data-playdeck-part='seek-buffered-range']) {
        background-color: var(--playdeck-color-buffered, #ededed);
      }
    }
  }
```

Also add `--playdeck-color-hairline` to the header token table, under `Color`, after `--playdeck-color-backdrop`:

```
 *                --playdeck-color-hairline      #d9d9d6 (phone docking only)
```

- [ ] **Step 4: Run the tests, confirm they pass**

```bash
pnpm vitest run packages/react/test/theme.test.ts
```

Expected: all tests pass, `slider non-text contrast`'s ratios unchanged from Task 1 (the phone block is excluded from `tokenDefault`'s scan by construction).

- [ ] **Step 5: Measure the budget**

```bash
pnpm --filter @playdeck/react build
node scripts/check-bundle-budgets.mjs
```

Read `@playdeck/react/theme.css`'s `CSS rules` row. The docking rules are a real cost (the design's own 2026-09-03 measurement already priced `docked.css`'s equivalent at 2.15 kB against the same 2.5 kB floor). If this task's cumulative total (Task 1 + Task 2) crosses 2.5 kB, raise `theme.css`'s budget to `3.0` in `scripts/bundle-budgets.mjs` in this commit, with the reason ("phone docking") in the commit message.

- [ ] **Step 6: Commit**

```bash
git add packages/react/theme.css packages/react/test/theme.test.ts
git commit -m "dock theme.css's control surface below the picture under 48rem"
```

---

### Task 3: `docked.css`'s same new identity

**Files:**
- Modify: `packages/react/docked.css`, `packages/react/test/theme.test.ts`

Same redraw as Task 1, applied to `docked.css`'s own rules, with light/dark defaults instead of one. No docking changes here — `docked.css` already docks; only the identity (scrim has no meaning here, so it is skipped) moves.

- [ ] **Step 1: Write the failing test**

`docked.css`'s fixture in `theme.test.ts` currently reads:

```ts
      // No `linear-gradient` -- docked.css draws no scrim.
      functions: ['calc', 'env', 'rgb', 'var'],
```

Change to:

```ts
      // `linear-gradient` joins the list once the seek fill becomes a
      // two-stop gradient like theme.css's own (#594's follow-up spec) --
      // docked.css still draws no scrim, which is a different rule.
      functions: ['calc', 'env', 'linear-gradient', 'rgb', 'var'],
```

- [ ] **Step 2: Run, confirm it fails**

```bash
pnpm vitest run packages/react/test/theme.test.ts
```

Expected: `docked.css contract > uses only the CSS features the declared support floor covers` fails (`functions` has no `linear-gradient` yet).

- [ ] **Step 3: Implement**

All edits are inside `packages/react/docked.css`.

**Thickness token + hover/focus growth.** Same 10 occurrences as `theme.css`:

```bash
grep -c -- "--playdeck-slider-thickness, 0.25rem" packages/react/docked.css   # expect 10
sed -i 's/--playdeck-slider-thickness, 0\.25rem/--playdeck-slider-thickness, 0.375rem/g' packages/react/docked.css
```

Add the growth rule directly after the `[data-playdeck-part='seek-slider']` rule (line ~244–248), before `seek-buffered`:

```css
  :where([data-playdeck-part='seek-slider']:hover),
  :where([data-playdeck-part='seek-slider']:focus-within) {
    --playdeck-slider-thickness: 0.5rem;
  }
```

**Gradient fill, both schemes.** In `@media (forced-colors: none)`, the light `seek-progress` rule:

```css
    :where([data-playdeck-part='seek-progress']) {
      inset-block: 0;
      border-radius: inherit;
      background-color: var(--playdeck-color-accent, #2b52d6);
    }
```

becomes:

```css
    :where([data-playdeck-part='seek-progress']) {
      inset-block: 0;
      border-radius: inherit;
      background: linear-gradient(
        to right,
        var(--playdeck-color-accent, #2b52d6),
        var(--playdeck-color-accent-tint, #8fb0f0)
      );
    }
```

The dark repeat currently groups `seek-progress` with the two Gecko rules and the WebKit thumb into one selector list sharing `background-color: var(--playdeck-color-accent, #3ea6ff);`:

```css
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
```

Pull `seek-progress` out into its own rule, since it alone now needs `background` instead of `background-color`:

```css
      :where(
        [data-playdeck-part='seek-slider-input'],
        [data-playdeck-part='volume-slider']
      )::-moz-range-progress,
      :where(
        [data-playdeck-part='seek-slider-input'],
        [data-playdeck-part='volume-slider']
      )::-moz-range-thumb,
      :where([data-playdeck-part='seek-slider-input'])::-webkit-slider-thumb {
        background-color: var(--playdeck-color-accent, #3ea6ff);
      }

      :where([data-playdeck-part='seek-progress']) {
        background: linear-gradient(
          to right,
          var(--playdeck-color-accent, #3ea6ff),
          var(--playdeck-color-accent-tint, #9dd0ff)
        );
      }
```

(`::-moz-range-progress`'s own accent fill is unchanged for the same reason as `theme.css`: the seek input's own Gecko track/progress are set `transparent` further down, so this shared rule only ever paints `volume-slider`.)

**Hidden thumb at rest, 16px on hover/focus.** The seek-only WebKit thumb rule:

```css
    :where([data-playdeck-part='seek-slider-input'])::-webkit-slider-thumb {
      appearance: none;
      box-sizing: border-box;
      inline-size: calc(var(--playdeck-slider-thickness, 0.375rem) * 4);
      block-size: calc(var(--playdeck-slider-thickness, 0.375rem) * 4);
      outline: none;
      border: 2px solid var(--playdeck-color-thumb-ring, #000);
      border-radius: 50%;
      background-color: var(--playdeck-color-accent, #2b52d6);
    }
```

changes its geometry to `0`:

```css
    :where([data-playdeck-part='seek-slider-input'])::-webkit-slider-thumb {
      appearance: none;
      box-sizing: border-box;
      inline-size: 0;
      block-size: 0;
      opacity: 1;
      outline: none;
      border: 2px solid var(--playdeck-color-thumb-ring, #000);
      border-radius: 50%;
      background-color: var(--playdeck-color-accent, #2b52d6);
    }
```

Add a seek-only Gecko override directly after it (still inside `forced-colors: none`, before the `::-moz-range-track, ::-moz-range-progress { background-color: transparent; }` rule):

```css
    :where([data-playdeck-part='seek-slider-input'])::-moz-range-thumb {
      inline-size: 0;
      block-size: 0;
      opacity: 1;
    }
```

And the hover/focus growth rule, placed right after that (still inside `forced-colors: none`):

```css
    :where(
      [data-playdeck-part='seek-slider']:hover,
      [data-playdeck-part='seek-slider']:focus-within
    )
      :where([data-playdeck-part='seek-slider-input'])::-moz-range-thumb,
    :where(
      [data-playdeck-part='seek-slider']:hover,
      [data-playdeck-part='seek-slider']:focus-within
    )
      :where([data-playdeck-part='seek-slider-input'])::-webkit-slider-thumb {
      inline-size: 1rem;
      block-size: 1rem;
    }
```

**Button radius.** The button box rule's `border-radius: var(--playdeck-radius, 0.375rem);` (the one at `data-playdeck-part='play-button', ...`, **not** `error-retry` or `menu-item`) becomes `var(--playdeck-radius, 0.625rem);`.

**Pressed state.** Directly after the existing `:where(:hover) { background-color: var(--playdeck-control-hover, ...); }` rule for the 7 button parts, add:

```css
  :where(
    [data-playdeck-part='play-button'],
    [data-playdeck-part='mute-button'],
    [data-playdeck-part='captions-button'],
    [data-playdeck-part='fullscreen-button'],
    [data-playdeck-part='pip-button'],
    [data-playdeck-part='airplay-button'],
    [data-playdeck-part='settings-menu-trigger']
  ):where(:active) {
    background-color: var(--playdeck-control-pressed, rgb(0 0 0 / 0.1));
  }
```

And its dark repeat, inside `@media (prefers-color-scheme: dark)` at the foot of the file, directly after the existing dark `:where(:hover)` override:

```css
    :where(
      [data-playdeck-part='play-button'],
      [data-playdeck-part='mute-button'],
      [data-playdeck-part='captions-button'],
      [data-playdeck-part='fullscreen-button'],
      [data-playdeck-part='pip-button'],
      [data-playdeck-part='airplay-button'],
      [data-playdeck-part='settings-menu-trigger']
    ):where(:active) {
      background-color: var(--playdeck-control-pressed, rgb(255 255 255 / 0.2));
    }
```

**Dimmed duration.** The duration rule:

```css
  :where([data-playdeck-part='time'][data-time-type='duration']) {
    margin-inline-end: auto;
  }
```

becomes

```css
  :where([data-playdeck-part='time'][data-time-type='duration']) {
    margin-inline-end: auto;
    opacity: 0.64;
  }
```

**Header comment.** Add two new documented tokens after the existing `--playdeck-color-hairline` entry, matching the file's own prose convention:

```
 *   --playdeck-color-accent-tint   #8fb0f0 light / #9dd0ff dark  (new; the
 *                                  seek fill's gradient end. The dark value
 *                                  is theme.css's own accent-tint default,
 *                                  reused because docked's dark accent is
 *                                  already the same colour as theme's)
 *   --playdeck-control-pressed     rgb(0 0 0 / 0.1) light /
 *                                  rgb(255 255 255 / 0.2) dark  (new; one
 *                                  step past --playdeck-control-hover's own
 *                                  0.06/0.12, the same "one darker" step
 *                                  theme.css takes)
```

- [ ] **Step 4: Run, confirm it passes**

```bash
pnpm vitest run packages/react/test/theme.test.ts
```

Expected: all tests pass, including `docked.css`'s own `text contrast`, `slider non-text contrast`, and `reads the token each measured boundary is measured on` describes — none of their asserted pairs (`on-surface`/`surface`, `accent`/`surface`, `track`/`surface`, `buffered`/`track`, `focus`/`surface`) read a token this task changed a default for, so their literals are unchanged.

- [ ] **Step 5: Measure the budget**

```bash
pnpm --filter @playdeck/react build
node scripts/check-bundle-budgets.mjs
```

Read `@playdeck/react/docked.css`'s `CSS rules` row. If it crosses 2.5 kB, raise it to `3.0` in `scripts/bundle-budgets.mjs` in this commit, with the reason in the message.

- [ ] **Step 6: Commit**

```bash
git add packages/react/docked.css packages/react/test/theme.test.ts
git commit -m "redraw docked.css with theme.css's new identity"
```

---

### Task 4: The hero, the entrance motion, and the close

**Files:**
- Modify: `apps/site/src/pages/index.astro`
- Test: `e2e/site-landing.spec.ts` (verify only in this task — the four-cards test is Task 7's)

- [ ] **Step 1: Verify the baseline**

```bash
pkill -f "storybook dev" || true
pkill -f "serve-site.mjs" || true
pnpm exec turbo run build --filter=@playdeck/site...
pnpm --filter @playdeck/site run build:based
node scripts/serve-site.mjs --port 4322 --mount /=apps/site/dist --mount /playdeck/=apps/site/dist-base &
sleep 2
pnpm exec playwright test e2e/site-landing.spec.ts
kill %1
```

Expected: all pass against the current page. (Alternatively just run `pnpm test:e2e -- e2e/site-landing.spec.ts`, which drives the same two `webServer` entries itself and needs no manual build/serve — use the manual form only if iterating quickly and hitting the stale-server trap.)

- [ ] **Step 2: Rewrite the hero**

Replace the whole `<section class="thesis">...</section>` block with a hero that keeps the exact `h1`, adds a Start link, and moves the install block up from the close. The install markup (the `<div class="install" data-install>` block and the script that drives it) is **cut from the close** and **pasted here** verbatim — same attributes, same script, nothing renamed, so `e2e/site-landing.spec.ts`'s copy tests are unaffected by the move:

```astro
    <section class="thesis">
      {
        /* Exactly `Playdeck`, and it cannot become anything else.
         * `scripts/check-deploy-artifact.mjs` identifies the site's root
         * document by a heading with that accessible name, and
         * `e2e/site-nav.spec.ts` asserts there is exactly one.
         *
         * It sets small, because it names the document rather than arguing.
         * The display rung goes to the sentence under it — `DESIGN.md`'s Type
         * section carries that amendment and its reasoning. */
      }
      <h1 class="thesis__name">Playdeck</h1>
      <p class="thesis__display">
        A video player you compose, not one you configure.
      </p>
      <p class="thesis__lede">
        React primitives and hooks over native video, HLS, YouTube, Vimeo and
        Wistia. You write the markup, you write the CSS, and the same six lines
        drive all five.
      </p>

      {
        /* The install command, moved up from the close (2026-09-03): a
         * reader who is convinced by the first screen should not have to
         * scroll to act on it. It keeps its four `data-install*` attributes
         * and the script below unchanged, so `e2e/site-landing.spec.ts`'s
         * copy tests hold whichever section the markup lives in. */
      }
      <div class="install" data-install>
        <code class="install__command" data-install-command>{install}</code>
        <button class="install__copy" type="button" hidden data-install-copy>
          Copy
        </button>
        <span class="u-visually-hidden" role="status" data-install-status></span>
      </div>

      <p class="thesis__actions">
        <a class="thesis__start" href={startUrl}>Start &rarr;</a>
      </p>
    </section>
```

- [ ] **Step 3: The `data-entered` script**

Add, as the **first** element inside `<main class="page">` — before `<section class="thesis">` — a two-line inline script. It has to be the first thing in the body's own content so it runs before anything below it paints:

```astro
  <main class="page">
    <script is:inline>
      // Before first paint: with no script this never runs, so the entrance
      // CSS below (gated on this attribute) never applies and every element
      // renders at its resting opacity and transform. `is:inline` because a
      // deferred module script runs after parsing and would let the settled
      // page flash before this attribute lands.
      document.documentElement.setAttribute('data-entered', '');
    </script>

    <section class="thesis">
```

- [ ] **Step 4: The entrance CSS**

Add to the `<style>` block, after the `.thesis__lede` rule and before `.close`:

```css
  .thesis__actions {
    margin: 0;
  }

  .thesis__start {
    font-family: var(--font-display);
    font-size: var(--text-lg);
    font-weight: var(--weight-semibold);
  }

  /* ---- entrance -------------------------------------------------------
   * One reveal, once, on load: the hero's own children and the stage rise
   * 12px and fade in, staggered by 80ms. `DESIGN.md`'s "Entry motion"
   * section records that this app authored none for a while and why, and
   * the two rules that section holds any future animation to are both here.
   *
   * The resting state is what the CSS above already gives every element --
   * full opacity, no transform -- so there is no `opacity: 0` default
   * anywhere and a reader whose script never runs, or who asked for no
   * motion, sees the settled page. `html[data-entered]` is what turns the
   * animation on at all; with no script, or under
   * `prefers-reduced-motion: reduce` below, this block simply never
   * matches and nothing runs -- removed, not shortened.
   */
  @media (prefers-reduced-motion: no-preference) {
    html[data-entered] .thesis__name,
    html[data-entered] .thesis__display,
    html[data-entered] .thesis__lede,
    html[data-entered] .install,
    html[data-entered] .thesis__actions,
    html[data-entered] :global(.bench__stage) {
      animation: enter var(--duration-slow) var(--ease) both;
    }

    html[data-entered] .thesis__display {
      animation-delay: 80ms;
    }

    html[data-entered] .thesis__lede {
      animation-delay: 160ms;
    }

    html[data-entered] .install {
      animation-delay: 240ms;
    }

    html[data-entered] .thesis__actions {
      animation-delay: 320ms;
    }

    html[data-entered] :global(.bench__stage) {
      animation-delay: 400ms;
    }

    @keyframes enter {
      from {
        opacity: 0;
        transform: translateY(12px);
      }
      to {
        opacity: 1;
        transform: translateY(0);
      }
    }
  }
```

`:global(.bench__stage)` — Astro scopes a page's own `<style>` block by attribute the same way `Bench.astro`'s comment records for its own CSS, and `.bench__stage` is rendered by `Bench.astro`, not by `index.astro`'s own template, so it needs the same `:global()` escape.

- [ ] **Step 5: Rewrite the close**

Replace the `<dl class="figures">...</dl>` block and the fine-print/links paragraph with a large install repeat, one measured line, and the links. Delete the `figures` array in the frontmatter entirely (the whole `const figures = [...]` block) — nothing reads it any more, and the `youtube`/`primitives` bundle lookups stay (the close's one measured line still needs `primitives.size`).

Frontmatter: keep `bundles`, `primitives`, `youtube` exactly as they are; delete only the `const figures = [...]` array.

Markup — replace:

```astro
    <section class="close">
      <dl class="figures">
        {
          figures.map(({ value, line }) => (
            <div class="figure">
              <dt class="figure__value">{value}</dt>
              <dd class="figure__line">{line}</dd>
            </div>
          ))
        }
      </dl>

      { ... install div ... }

      <p class="close__fineprint">React 19 peer, ESM only, named exports</p>

      { ... }
      <p class="close__links">
        <a href={startUrl}>Start &rarr;</a>
        <a href={referenceUrl}>Reference &rarr;</a>
        <a href={providersUrl}>Providers &rarr;</a>
        <a href={archetypesUrl}>Archetypes &rarr;</a>
      </p>
    </section>
```

with:

```astro
    <section class="close">
      <p class="close__install">
        <code>{install}</code>
      </p>

      <p class="close__measured">
        {primitives.size.toFixed(0)} kB gzipped, the whole of what
        `@playdeck/react` ships. Adding YouTube costs {youtube.size.toFixed(0)} kB.
        0 requests to a provider before play.
      </p>

      <p class="close__links">
        <a href={startUrl}>Start &rarr;</a>
        <a href={referenceUrl}>Reference &rarr;</a>
        <a href={providersUrl}>Providers &rarr;</a>
        <a href={archetypesUrl}>Archetypes &rarr;</a>
      </p>
    </section>
```

Replace the `.figures`/`.figure`/`.figure__value`/`.figure__line` rules in the `<style>` block with:

```css
  .close__install {
    padding: var(--space-3) var(--space-5);
    background-color: var(--color-sunken);
    border-radius: var(--radius-md);
  }

  .close__install code {
    font-family: var(--font-mono);
    font-size: var(--text-xl);
    color: var(--color-ink);
  }

  .close__measured {
    max-inline-size: var(--measure);
    font-family: var(--font-mono);
    font-size: var(--text-sm);
    color: var(--color-ink-subtle);
    font-variant-numeric: tabular-nums;
  }
```

Delete `.close__fineprint`'s rule (its text — "React 19 peer, ESM only, named exports" — is gone from the close per the spec; it is not restated anywhere on this page, since the spec's close is only the install command, one measured line, and the links).

- [ ] **Step 6: Run the e2e spec**

```bash
pkill -f "storybook dev" || true
pkill -f "serve-site.mjs" || true
pnpm test:e2e -- e2e/site-landing.spec.ts
```

Expected: all pass, including the no-JavaScript and reduced-motion "settled and readable" tests (neither polls, and the entrance is gated on `html[data-entered]`, which is absent in the no-script run and excluded by `prefers-reduced-motion: no-preference` in the reduced-motion run) and the copy-button tests (same `data-install*` attributes, now inside `.thesis` instead of `.close`).

- [ ] **Step 7: Commit**

```bash
git add apps/site/src/pages/index.astro
git commit -m "move the install block into the hero, add a Start link and one entrance reveal, rewrite the close"
```

---

### Task 5: Bench layout — one row of switches and quiet line, full-width composition, segmented pills, framed glow

**Files:**
- Modify: `apps/site/src/components/BenchIsland.tsx`, `apps/site/src/components/BenchSwitches.tsx`, `apps/site/src/components/Bench.astro`
- Test: `e2e/site-bench.spec.ts`, `e2e/site-quiet.spec.ts` (verify only — no assertion changes in this task)

- [ ] **Step 1: Verify the baseline**

```bash
pkill -f "storybook dev" || true; pkill -f "serve-site.mjs" || true
pnpm test:e2e -- e2e/site-bench.spec.ts e2e/site-quiet.spec.ts
```

Expected: all pass (excluding `@real`, which is the default).

- [ ] **Step 2: Drop `BenchIsland`'s two-column grid**

In `BenchIsland.tsx`, find:

```tsx
      {/* The readout: the switches and what the provider answered on one side,
       * the composition they built on the other, stacked below 48rem. */}
      <div className="grid items-start gap-[var(--space-6)] md:grid-cols-2">
        <div className="grid gap-[var(--space-4)]">
          <BenchSwitches
            onSkin={(skin: SkinName) =>
              setPosition((current) => ({ ...current, skin }))
            }
            onSource={(source) =>
              setPosition((current) => ({
                ...current,
                source,
                ...entryFor(source, base)
              }))
            }
            skin={position.skin}
            source={position.source}
          />
        </div>
        <CompositionPanel html={html} />
      </div>
```

Replace with one row (switch groups + quiet line) above a full-width panel. The quiet line moves out of its own top-level position in the tree and into this row — `<QuietLine sourceUrl={position.sourceUrl} />` is removed from where it currently sits (directly after `<Credit .../>`, above this block) and rendered inside the new row instead, so it can sit beside the switches rather than above them:

```tsx
      {/* The readout: the two switch groups and the quiet line in one row
       * (2026-09-03's stage redraw), the composition full width below. */}
      <div className="grid gap-[var(--space-6)]">
        <div className="flex flex-wrap items-end justify-between gap-[var(--space-4)]">
          <BenchSwitches
            onSkin={(skin: SkinName) =>
              setPosition((current) => ({ ...current, skin }))
            }
            onSource={(source) =>
              setPosition((current) => ({
                ...current,
                source,
                ...entryFor(source, base)
              }))
            }
            skin={position.skin}
            source={position.source}
          />
          <QuietLine sourceUrl={position.sourceUrl} />
        </div>
        <CompositionPanel html={html} />
      </div>
```

Remove the now-duplicate `<QuietLine sourceUrl={position.sourceUrl} />` line that used to sit directly under `<Credit credit={position.credit} />` above this block.

- [ ] **Step 3: Restyle `BenchSwitches` as segmented pills, groups in one row**

Replace the `Group` component's return and the outer wrapper in `BenchSwitches.tsx`. The outer default export's wrapper:

```tsx
    <div className="grid gap-[var(--space-5)]">
```

becomes a flex row (the two groups sit side by side; the skin group keeps `hidden md:block` on its own fieldset, unaffected by this container change):

```tsx
    <div className="flex flex-wrap items-end gap-[var(--space-5)]">
```

The `Group` component's `<label>` per-position pill and its `<div>` wrapper — currently each label carries its own border and its own chosen/unchosen colours:

```tsx
      <div className="mt-[var(--space-2)] flex flex-wrap gap-[var(--space-2)]">
        {positions.map((position) => {
          const chosen = position.value === selected;
          return (
            <label
              key={position.token}
              className={cn(
                'relative inline-flex min-h-[var(--hit-target)] cursor-pointer items-center rounded-[var(--radius-md)] border-[length:var(--line-width)] border-solid border-[var(--color-line-strong)] px-[var(--space-4)] font-mono text-[length:var(--text-xs)] tracking-[var(--tracking-fn)] active:border-[var(--color-accent)]',
                chosen
                  ? 'bg-[var(--color-accent)] text-[var(--color-field)]'
                  : 'text-[var(--color-ink-muted)] hover:bg-[var(--color-sunken)] hover:text-[var(--color-ink)]'
              )}
            >
```

becomes one rounded container per group, in `--color-sunken` with a `--color-line` border, and the chosen position filled `--color-ink` with `--color-surface` text:

```tsx
      <div className="mt-[var(--space-2)] inline-flex flex-wrap gap-[2px] rounded-[var(--radius-md)] border-[length:var(--line-width)] border-solid border-[var(--color-line)] bg-[var(--color-sunken)] p-[2px]">
        {positions.map((position) => {
          const chosen = position.value === selected;
          return (
            <label
              key={position.token}
              className={cn(
                'relative inline-flex min-h-[var(--hit-target)] cursor-pointer items-center rounded-[calc(var(--radius-md)-2px)] px-[var(--space-4)] font-mono text-[length:var(--text-xs)] tracking-[var(--tracking-fn)]',
                chosen
                  ? 'bg-[var(--color-ink)] text-[var(--color-surface)]'
                  : 'text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]'
              )}
            >
```

Every `data-bench-switch`, `data-value`, `name`, `checked`, `onChange` and the input's own `className` are unchanged — only the label's and its wrapper's presentational classes move. The comment above `Group` that explains the `active:border-[var(--color-accent)]` treatment ("The pressed state is the accent boundary the theme switch already presses to, rather than a lift") no longer describes the markup once the per-label border is gone; delete that sentence (it starts "The pressed state is the accent boundary..." and ends "...focus is `base.css`'s one outline drawn on the input below.") and keep the rest of the surrounding comment, which is still accurate (hairline token reasoning, why native radios).

- [ ] **Step 4: `.bench__frame` glow, ring, and the stage crossfade rule**

In `Bench.astro`'s `<style>` block, the `.bench__frame` rule:

```css
  .bench__frame {
    display: grid;
    grid-template-rows: 1fr auto;
    overflow: hidden;
    background-color: var(--stage-field);
    border-radius: var(--radius-lg);
    box-shadow: var(--elevation-instrument);
  }
```

gets a glow pseudo-element and a hairline ring, both composed from existing role tokens (rule 1: no new hex, `color-mix()` composes `--color-accent` down to a low alpha rather than declaring one):

```css
  /* The stage's own light: a soft accent glow behind the frame, a 1px ring
   * on the frame itself, and the existing deep shadow. This is a deliberate,
   * scoped amendment to the "no coloured glow" line in DESIGN.md's depth
   * section -- recorded there, not silently at odds with it. */
  .bench__frame {
    position: relative;
    display: grid;
    grid-template-rows: 1fr auto;
    overflow: hidden;
    background-color: var(--stage-field);
    border-radius: var(--radius-lg);
    box-shadow:
      inset 0 0 0 1px var(--color-line),
      var(--elevation-instrument);
  }

  .bench__frame::before {
    content: '';
    position: absolute;
    inset: calc(-1 * var(--space-6));
    z-index: -1;
    background: radial-gradient(
      circle,
      color-mix(in srgb, var(--color-accent) 20%, transparent),
      transparent 70%
    );
  }
```

`overflow: hidden` on `.bench__frame` clips `::before`'s glow to the frame's own box; the glow needs to sit *behind* the frame rather than be clipped away entirely, so it is a sibling layer via negative inset and `z-index: -1` against the frame's own `position: relative` — verify this visually in Task 9's screenshots (a `z-index: -1` pseudo-element on a `position: relative` parent with no other stacking context paints behind the parent's own background, which is the effect wanted; if the screenshot shows no glow, the parent is establishing its own stacking context somewhere else and the pseudo-element needs to move outside `.bench__frame` instead — a fallback to check for, not an expected outcome).

The stage crossfade rule, added after the existing `.bench__stage` rule and its `[data-bench-skin='docked']` variant:

```css
  /* The crossfade on a skin flip (2026-09-03): `data-bench-skin` is the
   * attribute `StagePortal` in `BenchIsland.tsx` already writes onto this
   * element on every skin change (`mount.setAttribute('data-bench-skin',
   * skin)`), so nothing new is written for this -- the flip below reads the
   * same attribute `.bench__stage[data-bench-skin='docked']` above already
   * keys off. `data-stage-flip` is set and cleared by `StagePortal` around
   * that same write; see its own comment for why the drop to 0.6 has no
   * transition and only the return to 1 does. */
  .bench__stage {
    opacity: 1;
    transition: opacity 240ms var(--ease);
  }

  .bench__stage[data-stage-flip] {
    opacity: 0.6;
    transition: none;
  }
```

- [ ] **Step 5: Run the specs**

```bash
pkill -f "storybook dev" || true; pkill -f "serve-site.mjs" || true
pnpm test:e2e -- e2e/site-bench.spec.ts e2e/site-quiet.spec.ts
```

Expected: all pass unchanged — every selector this plan's header table lists is untouched (`data-bench-switch`, `data-value`, `data-bench-composition`, `.bench__quiet`, `data-bench-skin`, the grid-shape and hairline-colour assertions on `[data-playdeck-part='viewport'|'controls']`, none of which this task's CSS touches).

- [ ] **Step 6: Commit**

```bash
git add apps/site/src/components/BenchIsland.tsx apps/site/src/components/BenchSwitches.tsx apps/site/src/components/Bench.astro
git commit -m "lay the bench out in one row, restyle the switches as segmented pills, light the frame"
```

---

### Task 6: Changed-line highlight and stage crossfade, wired up

**Files:**
- Modify: `apps/site/src/components/BenchIsland.tsx`, `apps/site/src/components/CompositionPanel.tsx`, `apps/site/src/components/Bench.astro`, `apps/site/src/styles/base.css`
- Test: `e2e/site-bench.spec.ts`

Task 5 added the CSS for both effects; this task computes and passes down what triggers them.

- [ ] **Step 1: Write the failing e2e test**

Add to `e2e/site-bench.spec.ts`, after the `'docked.css is a real <link>...'` test:

```ts
test('a skin flip highlights the changed composition line, and the highlight clears', async ({
  page
}) => {
  await page.goto(landing);
  await expect(composition(page)).toBeVisible();

  await position(page, 'skin', 'docked').click();

  await expect
    .poll(() => composition(page).locator('[data-changed]').count())
    .toBeGreaterThan(0);

  await expect
    .poll(() => composition(page).locator('[data-changed]').count(), {
      timeout: 1500
    })
    .toBe(0);
});
```

- [ ] **Step 2: Run, confirm it fails**

```bash
pkill -f "storybook dev" || true; pkill -f "serve-site.mjs" || true
pnpm test:e2e -- e2e/site-bench.spec.ts
```

Expected: `a skin flip highlights the changed composition line...` fails — nothing sets `data-changed` yet — and every pre-existing test in the file still passes.

- [ ] **Step 3: `Bench.astro` passes the plain-text composition alongside the highlighted HTML**

`BenchIsland` needs the un-highlighted source to diff line-by-line — the highlighted HTML's line spans carry syntax markup that would make a naive text diff of the HTML noisy. `Bench.astro`'s frontmatter already computes `code` (the plain string `buildComposition` returns) immediately before calling `codeToHtml`; keep that value too.

In `Bench.astro`, find:

```ts
const compositions: Record<string, string> = {};
for (const entry of readySources) {
  for (const skin of SKIN_POSITIONS) {
    const code = buildComposition({
      source: entry.provider,
      skin,
      sourceUrl: entry.source(base)
    });
    compositions[`${entry.provider}:${skin}`] = await codeToHtml(code, {
```

Add a second record, populated in the same loop:

```ts
const compositions: Record<string, string> = {};
// The plain source `buildComposition` returns, keyed the same way as
// `compositions` above. `BenchIsland` diffs this rather than the highlighted
// HTML on a switch flip, because Shiki's own markup around each line would
// make a text diff of the HTML noisy in a way the plain source is not.
const compositionSources: Record<string, string> = {};
for (const entry of readySources) {
  for (const skin of SKIN_POSITIONS) {
    const code = buildComposition({
      source: entry.provider,
      skin,
      sourceUrl: entry.source(base)
    });
    compositionSources[`${entry.provider}:${skin}`] = code;
    compositions[`${entry.provider}:${skin}`] = await codeToHtml(code, {
```

And pass it down where `<BenchIsland base={base} compositions={compositions} client:only="react" />` is rendered:

```astro
  <BenchIsland
    base={base}
    compositions={compositions}
    compositionSources={compositionSources}
    client:only="react"
  />
```

- [ ] **Step 4: `BenchIsland` diffs on a flip and passes the changed lines down**

In `BenchIsland.tsx`, extend `Props`:

```tsx
interface Props {
  /** `import.meta.env.BASE_URL`, read in `Bench.astro` and passed down. */
  readonly base: string;
  /** `Bench.astro`'s four precomputed strings, keyed `${provider}:${skin}`. */
  readonly compositions: Readonly<Record<string, string>>;
  /** The same four keys, holding the plain source `compositions` highlights. */
  readonly compositionSources: Readonly<Record<string, string>>;
}
```

Thread it through the default export's signature:

```tsx
const BenchIsland = ({ base, compositions, compositionSources }: Props) => {
```

After the existing `html` lookup (`const html = compositions[...]; if (html === undefined) { throw ...; }`), add the plain-source lookup and a diff against the previous render, using a ref to hold the previous key/text pair so the very first render never highlights anything:

```tsx
  const source = compositionSources[`${position.source}:${position.skin}`];
  if (source === undefined) {
    throw new Error(
      `BenchIsland: no precomputed source for ${position.source}:${position.skin}.`
    );
  }

  /*
   * The changed line indices between the previous render's composition and
   * this one, 1-indexed to match the `data-line` attribute `Bench.astro`'s
   * `markLineNumbers` transformer stamps on each Shiki line span.
   *
   * A ref rather than state: this only has to be right for the render it is
   * read in (`CompositionPanel`'s own effect, keyed on `html`), and setting
   * state here would ask React for a render this component does not need.
   * `Player.Root`'s own `controlledMuted.current = muted` pattern does the
   * same thing for the same reason (see its comment).
   */
  const previousSourceRef = useRef(source);
  const changedLines: readonly number[] = (() => {
    const previous = previousSourceRef.current;
    previousSourceRef.current = source;
    if (previous === source) return [];
    const previousLines = previous.split('\n');
    const nextLines = source.split('\n');
    const changed: number[] = [];
    for (let index = 0; index < nextLines.length; index++) {
      if (nextLines[index] !== previousLines[index]) changed.push(index + 1);
    }
    return changed;
  })();
```

Pass `changedLines` to `CompositionPanel`:

```tsx
        <CompositionPanel html={html} changedLines={changedLines} />
```

- [ ] **Step 5: `CompositionPanel` sets and clears `data-changed`**

Replace `CompositionPanel.tsx` entirely:

```tsx
/*
 * The composition the two switches just built, printed beside them, now
 * highlighted, since `Bench.astro`'s frontmatter runs Shiki over all four
 * reachable (source, skin) pairs at build time and hands this component
 * already-rendered HTML rather than a plain string.
 *
 * One `<div dangerouslySetInnerHTML>` and no `<pre>` of its own: Shiki's own
 * `codeToHtml` output already IS a `<pre>`, carrying `astro-code`,
 * `data-bench-composition` and `tabindex="0"` from the `pre` transformer
 * `Bench.astro` adds, so a `<pre>` here would nest one inside another.
 *
 * `min-w-0` on this div: it is the element `BenchIsland.tsx`'s row actually
 * lays out (the `<pre>` inside is one level down), and a flex/grid item's
 * automatic minimum size is its content's width unless something clips or
 * scrolls that item itself. The `<pre>` inside carries `overflow-x: auto`
 * from `.astro-code[data-bench-composition]`, but that rule reaches the
 * `<pre>`, not this wrapper, so without this the wrapper refused to shrink
 * below the unwrapped source's width and pushed the page wider than the
 * viewport at narrow widths -- measured: 233px of horizontal overflow at
 * 320px before this class was added.
 *
 * ---- the changed-line highlight (2026-09-03) --------------------------
 *
 * `changedLines` names the 1-indexed lines that moved between the previous
 * composition and this one -- `BenchIsland.tsx` computes it by diffing the
 * plain source, since the highlighted HTML's own markup would make a text
 * diff noisy. This component's only job with it is to stamp `data-changed`
 * on the matching `.line[data-line="N"]` spans Shiki's own `line` hook
 * already wrote `data-line` onto, and to clear it again after the
 * transition `base.css`'s `.line[data-changed]` rule declares -- 900ms,
 * read back off that rule's own literal rather than guessed at here would
 * be nicer, but CSS has no way to hand a duration to JavaScript, so the two
 * numbers are kept in sync by being next to each other in the two files'
 * comments instead.
 *
 * The timeout is cleared and restarted on every `html`/`changedLines`
 * change, which is what "a second flip restarts the highlight" means: a
 * flip that lands before the previous highlight has cleared cancels that
 * clear and schedules a new one, rather than leaving two timers racing.
 */
import { useEffect, useRef } from 'react';

export type CompositionPanelProps = {
  /** One of `Bench.astro`'s four precomputed strings, picked by (source, skin). */
  readonly html: string;
  /** The 1-indexed lines that changed since the previous composition. */
  readonly changedLines: readonly number[];
};

const HIGHLIGHT_MS = 900;

export default function CompositionPanel({
  html,
  changedLines
}: CompositionPanelProps) {
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const root = rootRef.current;
    if (root === null || changedLines.length === 0) return;

    for (const line of changedLines) {
      root
        .querySelector(`.line[data-line="${line}"]`)
        ?.setAttribute('data-changed', '');
    }

    const timeout = setTimeout(() => {
      for (const line of changedLines) {
        root
          .querySelector(`.line[data-line="${line}"]`)
          ?.removeAttribute('data-changed');
      }
    }, HIGHLIGHT_MS);

    return () => clearTimeout(timeout);
    // `html` in the dependency list, not only `changedLines`: React does not
    // re-run an effect for a new array with the same contents by identity,
    // but a `data-changed` line span exists only on the CURRENT `html`'s own
    // DOM, so a flip must re-run this even where `changedLines`
    // coincidentally holds the same numbers twice in a row.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- see above.
  }, [html, changedLines]);

  return (
    <div
      ref={rootRef}
      className="min-w-0"
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
```

- [ ] **Step 6: `base.css`'s highlight rule**

Add, directly after the `.astro-code[data-bench-composition] { margin: 0; overflow-x: auto; }` rule:

```css
/* The changed-line highlight (2026-09-03): `CompositionPanel.tsx` stamps
 * `data-changed` on the `.line` Shiki's own `line` hook already wraps every
 * printed line in, for the lines a switch flip just moved, and clears it
 * again after 900ms -- keep that literal in sync with
 * `CompositionPanel.tsx`'s own `HIGHLIGHT_MS` if either changes.
 *
 * No `prefers-reduced-motion` override here: this site's global reduced-
 * motion rule (below) already collapses every `transition-duration` to
 * 0.01ms with `!important`, which is indistinguishable from "no transition"
 * for a plain background fade between two static states -- unlike the
 * entrance reveal in `index.astro`, this is not a case where a from-state
 * could flash before collapsing, so the general rule is enough on its own.
 */
.astro-code[data-bench-composition] .line[data-changed] {
  background-color: color-mix(in srgb, var(--color-accent) 20%, transparent);
  transition: background-color 900ms var(--ease);
}
```

- [ ] **Step 7: The stage crossfade trigger**

In `BenchIsland.tsx`'s `StagePortal`, the existing skin-writing effect:

```tsx
  useEffect(() => {
    mount?.style.setProperty('--bench-aspect-ratio', aspectRatio);
  }, [mount, aspectRatio]);
  useEffect(() => {
    mount?.setAttribute('data-bench-skin', skin);
  }, [mount, skin]);
```

The second effect becomes, adding the crossfade trigger on every skin change *after* the first:

```tsx
  const isFirstSkinRender = useRef(true);
  useEffect(() => {
    if (mount === null) return;
    mount.setAttribute('data-bench-skin', skin);

    if (isFirstSkinRender.current) {
      isFirstSkinRender.current = false;
      return;
    }
    /*
     * The crossfade (2026-09-03): a hard drop to 0.6 opacity with no
     * transition, then removed on the next animation frame so the return to
     * 1 crosses `.bench__stage`'s own `transition: opacity 240ms`. Skipped
     * outright under reduced motion, rather than relying on the site's
     * global 0.01ms transition-duration collapse: that rule only shortens a
     * transition that was going to run anyway, and `DESIGN.md`'s "Entry
     * motion" section holds a visible reveal like this one to "removed, not
     * shortened" -- the same reason `index.astro`'s own entrance is gated on
     * a media query rather than left to that global rule.
     */
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      return;
    }
    mount.setAttribute('data-stage-flip', '');
    requestAnimationFrame(() => {
      mount.removeAttribute('data-stage-flip');
    });
  }, [mount, skin]);
```

`useRef` is already imported in `BenchIsland.tsx` (used by `ControlBar`'s `playButton` ref); no new import needed.

- [ ] **Step 8: Run the test**

```bash
pkill -f "storybook dev" || true; pkill -f "serve-site.mjs" || true
pnpm test:e2e -- e2e/site-bench.spec.ts
```

Expected: `a skin flip highlights the changed composition line, and the highlight clears` passes, and every pre-existing test in the file still passes — in particular `the composition prints the full control tree, and tracks the source switch`, whose `tree(...)` comparison is unaffected by `data-changed` attributes appearing and clearing on `.line` spans that are outside the `<Player.Root` slice it compares.

- [ ] **Step 9: Commit**

```bash
git add apps/site/src/components/BenchIsland.tsx apps/site/src/components/CompositionPanel.tsx apps/site/src/components/Bench.astro apps/site/src/styles/base.css e2e/site-bench.spec.ts
git commit -m "highlight the composition's changed line and crossfade the stage on a skin flip"
```

---

### Task 7: The four feature cards

**Files:**
- Create: `apps/site/src/components/FeatureCards.astro`
- Modify: `apps/site/src/pages/index.astro`
- Test: `e2e/site-landing.spec.ts`

- [ ] **Step 1: Write the failing e2e test**

Add to `e2e/site-landing.spec.ts`, after `'the thesis and both groups of switches are on the page'`:

```ts
test('the four feature cards are present, numbered in order', async ({
  page
}) => {
  await page.goto(landing);
  const cards = page.locator('[data-feature-card]');
  await expect(cards).toHaveCount(4);
  await expect(cards.nth(0)).toContainText('01');
  await expect(cards.nth(0)).toContainText('Compose it');
  await expect(cards.nth(1)).toContainText('02');
  await expect(cards.nth(1)).toContainText('Style it');
  await expect(cards.nth(2)).toContainText('03');
  await expect(cards.nth(2)).toContainText('Ask before you render');
  await expect(cards.nth(3)).toContainText('04');
  await expect(cards.nth(3)).toContainText('Recover from refused autoplay');
});
```

- [ ] **Step 2: Run, confirm it fails**

```bash
pkill -f "storybook dev" || true; pkill -f "serve-site.mjs" || true
pnpm test:e2e -- e2e/site-landing.spec.ts
```

Expected: the new test fails (`[data-feature-card]` matches nothing yet); every other test in the file still passes.

- [ ] **Step 3: Write `FeatureCards.astro`**

```astro
---
/**
 * The four cards that carry this page's advertising: compose it, style it,
 * ask before you render, recover from refused autoplay. Composability and
 * customisability are demonstrated by the bench above this component;
 * capability querying and autoplay recovery are not — see `DESIGN.md`'s
 * capability-argument section and this spec's own rulings for why the two
 * stay claims rather than demonstrations here. Card 03 is not a capability
 * table: it names one hook and no provider, the same restraint the bench's
 * own history already settled on.
 *
 * Every identifier in every snippet is real: `usePlayerState` and
 * `capabilities` are exported from `@playdeck/react`'s and `@playdeck/core`'s
 * public surfaces respectively, and `'audible-then-muted'` is a literal
 * member of `AutoplayMode` in `packages/core/src/types.ts`. Highlighted at
 * build time by the same `shikiConfig` the bench's own composition panel
 * uses, so the two never colour a token differently from each other.
 */
import { codeToHtml } from 'shiki';
import { shikiConfig } from '../shiki';

const base = import.meta.env.BASE_URL;

type Card = {
  readonly headline: string;
  readonly lines: readonly string[];
  readonly snippet: string;
  readonly href: string;
};

const cards: readonly Card[] = [
  {
    headline: 'Compose it',
    lines: [
      'Every control is a component. Reorder them, drop one, put your own',
      'between them.'
    ],
    snippet: `<Player.Controls>\n  <Player.PlayButton />\n  <Logo />\n  <Player.Time type="current" />\n</Player.Controls>`,
    href: `${base}reference/`
  },
  {
    headline: 'Style it',
    lines: [
      'No CSS ships in the bundle. Two authored themes, or write your own',
      'against stable part names.'
    ],
    snippet: `[data-playdeck-part='play-button'] {\n  border-radius: 999px;\n}`,
    href: `${base}design/`
  },
  {
    headline: 'Ask before you render',
    lines: [
      'Every provider declares what it can do. A control it cannot honour',
      'renders nothing, and you can read the same answer.'
    ],
    snippet: `usePlayerState((s) => s.capabilities.pictureInPicture)`,
    href: `${base}guides/capabilities-matrix/`
  },
  {
    headline: 'Recover from refused autoplay',
    lines: [
      'Ask for sound. If the browser refuses, the player retries muted once',
      'and tells you, so you can draw the unmute.'
    ],
    snippet: `<Player.Root autoplay="audible-then-muted">`,
    href: `${base}reference/`
  }
];

const highlighted = await Promise.all(
  cards.map((card) => codeToHtml(card.snippet, { lang: 'tsx', ...shikiConfig }))
);
---

<section class="cards">
  {
    cards.map((card, index) => (
      <a class="card" data-feature-card href={card.href}>
        <span class="card__number">{String(index + 1).padStart(2, '0')}</span>
        <h2 class="card__headline">{card.headline}</h2>
        {card.lines.map((line) => (
          <p class="card__line">{line}</p>
        ))}
        <div class="card__snippet" set:html={highlighted[index]} />
      </a>
    ))
  }
</section>

<style>
  .cards {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    gap: var(--space-5);
    margin-block-start: var(--space-8);
  }

  @media (min-width: 48rem) {
    .cards {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
  }

  .card {
    display: grid;
    gap: var(--space-2);
    align-content: start;
    padding: var(--space-5);
    color: inherit;
    text-decoration: none;
    background-color: var(--color-surface);
    border-radius: var(--radius-lg);
    box-shadow: var(--elevation-panel);
    transition: transform var(--duration-fast) var(--ease);
  }

  @media (prefers-reduced-motion: no-preference) {
    .card:hover {
      transform: translateY(-2px);
    }
  }

  .card__number {
    font-family: var(--font-mono);
    font-size: var(--text-fn);
    letter-spacing: var(--tracking-fn);
    color: var(--color-ink-subtle);
  }

  .card__headline {
    font-family: var(--font-display);
    font-size: var(--text-xl);
    font-weight: var(--weight-semibold);
  }

  .card__line {
    margin: 0;
    font-size: var(--text-sm);
    color: var(--color-ink-muted);
  }

  .card__snippet :global(.astro-code) {
    margin: 0;
    margin-block-start: var(--space-2);
    font-size: var(--text-xs);
  }
</style>
```

- [ ] **Step 4: Mount it in `index.astro`**

```astro
import Bench from '../components/Bench.astro';
import FeatureCards from '../components/FeatureCards.astro';
```

and, between `<Bench />` and the `<section class="close">`:

```astro
    <Bench />

    <FeatureCards />

    {
      /* The close: ...
```

- [ ] **Step 5: Run the tests**

```bash
pkill -f "storybook dev" || true; pkill -f "serve-site.mjs" || true
pnpm test:e2e -- e2e/site-landing.spec.ts
```

Expected: all pass, including the 320px overflow test (`.cards` is a single column below 48rem, same `minmax(0, 1fr)` shrink guard `.figures` used to carry).

- [ ] **Step 6: Measure the poster gate**

`FeatureCards.astro`'s `<style>` block is inside a `.astro` file, so `e2e/poster.spec.ts`'s `.css`-only scan does not reach it regardless — still, no rule here uses `background-image` or a CSS background gradient, so this is inert either way. Confirm:

```bash
pnpm test:e2e -- e2e/poster.spec.ts
```

- [ ] **Step 7: Commit**

```bash
git add apps/site/src/components/FeatureCards.astro apps/site/src/pages/index.astro e2e/site-landing.spec.ts
git commit -m "add the four feature cards: compose, style, query, recover"
```

---

### Task 8: `DESIGN.md` amendments

**Files:**
- Modify: `apps/site/DESIGN.md`

No tests — this is prose. Read the sections named below in full before editing; each amendment sits beside the passage it corrects rather than in one dumped addendum, matching the document's own established convention (see how the "provider asymmetry" and "capability argument" passages were amended in place, not appended).

Eight passages need correcting, five of them because Tasks 4, 5 and 7 make an existing sentence false rather than merely out of date — a stronger obligation than the general "record what shipped" one, since a false claim left standing is worse than a missing one. Do all eight; none is optional.

- [ ] **Step 1: `## Type` — `--font-display`'s consumers**

`apps/site/DESIGN.md:343-348` names "the thesis sentence" and "the four figures in the close" as the two places `--font-display` may be spent. After Task 4 the figures are gone and the hero gained a second consumer (`.thesis__start`); after Task 7 the four feature cards' headlines are a third. Find:

```markdown
**Two places spend `--font-display` and they are both on `/`**: the thesis
sentence under the `h1`, and the four figures in the close. Nothing else on the
site may take it without an edit here, for the same reason the elevation
allowlist below is written by hand. `tokens.css`'s own comment beside the face
still claims the wordmark and a chapter title among its consumers; neither
exists any more, and the file is wrong about that where this document is right.
```

Replace with:

```markdown
**Three places spend `--font-display` on `/` as of the 2026-09-03 stage
redraw, and they replace the two that used to.** The thesis sentence under
the `h1` is unchanged; the hero's Start link (`.thesis__start`) is new,
moved up from the close along with the install command; and each feature
card's headline (`.card__headline`) is new. The four figures in the close,
the second of the original two consumers, are gone with the close itself —
see "The landing page" below. Nothing else on the site may take it without an
edit here, for the same reason the elevation allowlist below is written by
hand. `tokens.css`'s own comment beside the face still claims the wordmark
and a chapter title among its consumers; neither exists any more, and the
file is wrong about that where this document is right.
```

- [ ] **Step 2: `## Type` — `--text-2xl`'s consumer**

`apps/site/DESIGN.md:420-425` says `--text-2xl` goes to the close's four `dt` figures. Task 4 deletes them, and nothing in this plan gives `--text-2xl` a new consumer on `/` — the close's own install repeat uses `--text-xl`, not `--text-2xl`. Find:

```markdown
**Neither rung sets a heading on `/` either, and that is worth saying because
the sentence above used to promise one.** `--text-4xl` goes to the thesis
paragraph, for the reason below, and `--text-2xl` goes to the four figures in
the close, which are `dt` elements and not headings. Both are still classes on
that page and neither moves what an element resolves to, which is the whole of
what the rule asks. What changed is that the argument stance no longer has a
heading large enough to be worth an exception.
```

Replace with:

```markdown
**Neither rung sets a heading on `/` either, and that is worth saying because
the sentence above used to promise one.** `--text-4xl` goes to the thesis
paragraph, for the reason below. `--text-2xl` has no consumer on `/` as of the
2026-09-03 stage redraw — it went to the close's four `dt` figures, which are
gone with the close itself, and nothing replaces them at that rung. Both
rungs are still opt-in classes rather than anything an element resolves to by
default, which is the whole of what the rule asks, and `--text-2xl` having no
consumer today does not un-declare it: the paragraph below still states what
either rung is for a page that wants one.
```

- [ ] **Step 3: Depth section — the glow exception**

In `### Depth, and what rule 4 used to say`, immediately after the paragraph ending "Also still banned: coloured glows, zero-offset halos, and stacked shadows imitating one large soft one. A shadow is cast by a surface above a surface. It is not a way to tint an edge.", add:

```markdown
**One exception, named rather than left to erode the rule by precedent.**
`.bench__frame` in `Bench.astro` carries a low-alpha `--color-accent` radial
glow behind it as of 2026-09-03's stage redraw, composed with `color-mix()`
rather than a new hex (rule 1 still holds — nothing here is a literal
colour). It is the one element on the site with an elevation to begin with,
so this is a second thing that element alone may spend, not a widening of
what any panel may do. The 1px ring the same redraw drew around the frame is
an `inset` box-shadow layered in the same `box-shadow` declaration as
`--elevation-instrument`, not a `border` — the sentence "an elevated surface
never also carries a border" is unchanged and still enforces the one pairing
this rule exists to keep unassemblable.
```

- [ ] **Step 4: Entry motion section**

In `### Entry motion, and the vocabulary that was built and never used`, the paragraph beginning "**This app authors no animation at all, as of that cut.**" states a claim this task falsifies. Amend its opening sentence and its close:

Find:

```markdown
**This app authors no animation at all, as of that cut.** Not the vocabulary
above, not the reason line that replaced it as this section's subject, nothing
else written since. `[data-stance='argument']` still exists on `/`'s `<body>`
and still distinguishes it from every document route — see Stances — but there
is no rule left anywhere in this codebase keyed off it. The three constraints
below are kept as a record of what any animation this app writes has always had
to satisfy, should one be written again, rather than as a description of
something currently running:
```

Replace with:

```markdown
**This app authored no animation for a long stretch, and that changed on
2026-09-03.** `index.astro` now runs one entrance reveal on load (the hero's
own children and the stage, staggered by 80ms), `Bench.astro`'s stage
crossfades on a skin flip, and its composition panel highlights a changed
line. `[data-stance='argument']` is not what any of the three key off — the
lesson recorded below (a vocabulary can be correct and still be dead weight)
is why none of them is a revival of the deleted `.u-enter` machinery, each is
scoped to the one element it dresses rather than to a site-wide class. The
three constraints below are exactly what each of the three was built to
satisfy, and are no longer a record of a vocabulary with nothing running
against it:
```

- [ ] **Step 5: The landing page section — the redraw, recorded generally**

In `## The landing page`, after the paragraph beginning "**`/`'s capability argument is now nothing...**", add a new paragraph recording the 2026-09-03 redraw:

```markdown
**The page was redrawn again on 2026-09-03, as "The Stage."** The install
command moved from the close into the hero, beside a new Start link; the
switches and the quiet line now sit in one row under the stage rather than
beside the composition panel, which is full width below them; the frame
carries a soft accent glow, a hairline ring and its existing deep shadow; a
switch flip highlights the composition's changed line and crossfades the
stage; and four advertising cards — Compose, Style, Query, Recover — follow
the bench. Autoplay recovery and capability querying, both cut from the page
outright in the paragraph above, are now **advertised** in two of those four
cards, each with a real prop name or hook and no provider named — a claim,
not a demonstration, since `/` still mounts its player with
`loading="interaction"` and a refusal still cannot be shown there. The
"capability querying and autoplay recovery are not sold on `/` at all"
sentence two paragraphs up is corrected by this one: they are advertised, not
sold by demonstration, and the distinction is the whole of what changed.
```

- [ ] **Step 6: The landing page section — the close's own description**

Further down `## The landing page`, `apps/site/DESIGN.md:2064-2073` describes the close as "four figures, the command, the fine print and the ways onward" — Task 4 replaces the four figures with one measured line, repeats the command (moved from the hero rather than typed twice), and drops the fine print outright. Find:

```markdown
**The close is four figures, the command, the fine print and the ways onward.**
The first figure is measured at build time from `scripts/bundle-budgets.mjs`,
the module `pnpm test:budgets` gates with, so the page and the gate cannot state
different numbers. The other three are facts about how the packages are
published rather than measurements, so they are written. The close had an
end-credits treatment for one page's life: its own dark panel, a three-line roll
set in mono, and a heading over a second copy of the install command. On screen
that was a large mostly empty box at the foot of the page, and the roll was a
joke told in 12px type. A reader who leaves before the close has already had the
whole argument, which is the test every part of this page has to pass, so the
close takes no treatment of its own.
```

Replace with:

```markdown
**The close was four figures, the command, the fine print and the ways
onward for two page's lives, and moved again on 2026-09-03.** The command
opens the hero now instead — see the paragraph above — and the close keeps
one measured line, read from `scripts/bundle-budgets.mjs` the same
build-time module the first of the old four figures was, a second, larger
repeat of the install command, and the same links as before. The fine print
("React 19 peer, ESM only, named exports") is gone outright rather than
moved: nothing on the page states it any more. The close had an end-credits
treatment for one page's life before either of those: its own dark panel, a
three-line roll set in mono, and a heading over a second copy of the install
command. On screen that was a large mostly empty box at the foot of the page,
and the roll was a joke told in 12px type. A reader who leaves before the
close has already had the whole argument, which is the test every part of
this page has to pass, so the close takes no treatment of its own.
```

- [ ] **Step 7: The landing page section — the install command prints twice again**

Still in `## The landing page`, `apps/site/DESIGN.md:2075-2081` says the install command "is printed once," a `const` kept "for tidiness rather than for safety." Task 4 puts a second, plain, non-interactive repeat in the close, so this is false again in exactly the way the sentence's own earlier clause already anticipated. Find:

```markdown
**The install line is the call to action, and it is click-to-copy.** It used to
be printed twice, in the hero and in the credits, from one string in the page's
frontmatter so that the two could not drift; the credits are gone and it is
printed once, so the string is a `const` for tidiness rather than for safety.
The command is selectable text; the
copy button is `hidden` in the markup and revealed by a script. Writing to the
clipboard is the whole of what the control does, so with no script there is
nothing to press rather than a control that swallows a click, and nothing is
lost, because the command was never behind the button. The feedback is a text
swap on the button with the same words said once through a `role="status"` line.
```

Replace with:

```markdown
**The install line is the call to action, and it is click-to-copy where it is
interactive.** It used to be printed twice, in the hero and in the credits,
from one string in the page's frontmatter so that the two could not drift;
the credits were cut and it was printed once, the `const` kept for tidiness
rather than for safety. The 2026-09-03 stage redraw put it back to two: once
in the hero, with the click-to-copy behaviour below and the `data-install*`
attributes that carry it, and once again in the close, as a plain, larger
repeat with no button and no separate `data-install` group of its own — the
close reads the same `{install}` string rather than a second copy of it. Both
still come from the one page-level `const`, which is once again there for the
reason the sentence used to give it before the credits were cut: so the two
printed copies cannot drift. The command is selectable text; the copy button
is `hidden` in the markup and revealed by a script. Writing to the clipboard
is the whole of what the control does, so with no script there is nothing to
press rather than a control that swallows a click, and nothing is lost,
because the command was never behind the button. The feedback is a text swap
on the button with the same words said once through a `role="status"` line.
```

- [ ] **Step 8: The landing page section — the page width's own justification**

Still in `## The landing page`, `apps/site/DESIGN.md:2098-2100` says the page's `72rem` maximum "buys the readout its two columns." Task 5 removes that grid — the switches and the quiet line share one row, and the composition panel is full width below them — so there is no longer a second column for the width to buy. Find:

```markdown
**Prose is held to `--measure` on the page**, and the page's own
maximum is `72rem`. The width buys the readout its two columns, not longer
lines.
```

Replace with:

```markdown
**Prose is held to `--measure` on the page**, and the page's own
maximum is `72rem`. The width used to buy the readout its two columns; the
2026-09-03 stage redraw dropped that grid — the switches and the quiet line
share one row and the composition panel is full width below them, all still
inside the same `72rem`. What the width buys now is room for the stage
itself and for the two-column card grid below it, not longer prose lines and
not a second readout column that no longer exists.
```

- [ ] **Step 9: `--playdeck-*` new tokens and the budget rule**

There is no existing `--playdeck-*` token-default table anywhere in this document to extend — verified: neither `--playdeck-slider-thickness` nor any `2.5 kB`/`2.00 kB`/`2.15 kB` figure appears in it today. `## Themes` (near the top of the file) is the *site's own* `data-theme` light/dark toggle and is unrelated; do not put player-library token documentation there — the section's own prose in `## The bench's player, and the site's islands` states outright that the two systems "share no tokens and are not meant to match," which a token table dropped into `## Themes` would sit awkwardly beside.

The right home is a new subsection at the very end of `## The bench's player, and the site's islands` (the file's last section, ending "...and that mapping is the whole of the contact between them."), since that is where this document already discusses `theme.css`/`docked.css`'s own measured pairs. Append, after that section's final paragraph and at the end of the file:

```markdown
### The 2026-09-03 identity redraw

`theme.css` and `docked.css` were redrawn together on 2026-09-03: a deeper,
taller scrim; a seek bar that thickens and reveals its thumb on hover or
focus; a two-stop gradient fill; a raised button radius and a pressed state;
a dimmed duration; and, for `theme.css` alone, a real docked layout below
48rem. Three tokens are new, and every other name in both files kept its own,
so a consumer already overriding one keeps working:

| Token | Default | Where |
| --- | --- | --- |
| `--playdeck-color-accent-tint` | `#9dd0ff` (`theme.css`) / `#8fb0f0` light, `#9dd0ff` dark (`docked.css`) | The seek fill's gradient end |
| `--playdeck-control-pressed` | `rgb(255 255 255 / 0.2)` (`theme.css`) / `rgb(0 0 0 / 0.1)` light, `rgb(255 255 255 / 0.2)` dark (`docked.css`) | One step past `--playdeck-control-hover`, on `:active` |
| `--playdeck-color-hairline` | `#d9d9d6` light / `#2a2a2d` dark | `theme.css`'s phone-docking control surface's top border, below 48rem — `docked.css` already had this token |

[Replace the sentence below with the actual figures printed by
`node scripts/check-bundle-budgets.mjs` once Tasks 1–3 are complete, and say
whether either budget was raised.]

`scripts/bundle-budgets.mjs` budgets each sheet's rules at 2.5 kB gzipped,
raised to 3.0 kB in the same commit as whichever task crossed it, with the
reason in that commit's message — the design is not thinned to fit. Measured
after this redraw: `theme.css` rules at N.NN kB, `docked.css` rules at N.NN kB.
```

- [ ] **Step 10: Verify the new subsection's tone**

Read the subsection back against the paragraph immediately above it in `## The bench's player, and the site's islands` — the document's own voice is first-person-neutral, why-focused prose, not a changelog. Adjust wording if the pasted block above reads like release notes rather than like the rest of the file; the table and the budget figures are the part that must be exact, the surrounding sentences are not.

- [ ] **Step 11: Commit**

```bash
git add apps/site/DESIGN.md
git commit -m "record the stage redraw, its false-now passages, the frame's glow exception, and the return of authored motion in DESIGN.md"
```

---
### Task 9: Screenshot pass

**Files:**
- Create (scratchpad only, not committed): a small script under the session scratchpad directory

No production files change in this task. Nothing is pushed until the maintainer has reviewed these screenshots — that is a hard ruling from the spec, restated at the top of this plan.

- [ ] **Step 1: Build and serve the site**

```bash
pkill -f "storybook dev" || true; pkill -f "serve-site.mjs" || true
pnpm exec turbo run build --filter=@playdeck/site...
pnpm --filter @playdeck/site run build:based
node scripts/serve-site.mjs --port 4322 --mount /=apps/site/dist --mount /playdeck/=apps/site/dist-base &
sleep 2
```

- [ ] **Step 2: Write a capture script**

Save to `<scratchpad>/screenshot-stage.mjs` (the session's scratchpad directory, not the repo):

```js
import { chromium } from 'playwright';

const VIEWPORTS = [
  { name: '375', width: 375, height: 800 },
  { name: '768', width: 768, height: 1024 },
  { name: '1440', width: 1440, height: 900 }
];
const SCHEMES = ['light', 'dark'];
const SKINS = ['theme', 'docked'];
const URL = 'http://127.0.0.1:4322/';
const OUT = process.env.SCREENSHOT_OUT_DIR ?? '.';

const browser = await chromium.launch();
for (const viewport of VIEWPORTS) {
  for (const scheme of SCHEMES) {
    const context = await browser.newContext({
      viewport: { width: viewport.width, height: viewport.height },
      colorScheme: scheme
    });
    const page = await context.newPage();
    await page.goto(URL);
    await page.waitForSelector('[data-bench-composition]');

    // At rest, whichever skin the page defaults to at this width.
    await page.screenshot({
      path: `${OUT}/stage-${viewport.name}-${scheme}-rest.png`,
      fullPage: true
    });

    // Both skins where the switch is reachable (hidden below 48rem).
    if (viewport.width >= 768) {
      for (const skin of SKINS) {
        await page
          .locator(`[data-bench-switch="skin"] [data-value="${skin}"]`)
          .click();
        await page.waitForTimeout(400); // past the 240ms crossfade
        await page.screenshot({
          path: `${OUT}/stage-${viewport.name}-${scheme}-${skin}.png`,
          fullPage: true
        });
      }

      // After a flip, to catch the changed-line highlight and the crossfade
      // mid-transition (fires immediately after the click above).
      await page
        .locator('[data-bench-switch="skin"] [data-value="theme"]')
        .click();
      await page.waitForTimeout(80);
      await page.screenshot({
        path: `${OUT}/stage-${viewport.name}-${scheme}-flip.png`
      });
    }

    await context.close();
  }
}
await browser.close();
console.log(`Screenshots written to ${OUT}`);
```

- [ ] **Step 3: Run it**

```bash
SCREENSHOT_OUT_DIR="$SCRATCHPAD_DIR" node "$SCRATCHPAD_DIR/screenshot-stage.mjs"
```

(Substitute the session's actual scratchpad path for `$SCRATCHPAD_DIR` — it is given at the top of the agent's system context.) Expect 3 viewports × 2 schemes × (1 rest + up to 2 skins + 1 flip for the two wider viewports) — roughly 18–20 PNGs.

- [ ] **Step 4: Stop the server**

```bash
kill %1 2>/dev/null || pkill -f "serve-site.mjs"
```

- [ ] **Step 5: Present the screenshots to the maintainer**

Do not commit the script or the PNGs. Show the screenshots (or their paths) to the maintainer and wait for their review before any push, per the spec's own ruling. If they call out a look or copy change (the four cards' copy is explicitly draft, "to be corrected at review" per the spec), make it as a follow-up commit on this same branch before finishing.

---

## Final verification

After all nine tasks:

```bash
pnpm vitest run packages/react/test/theme.test.ts
pnpm --filter @playdeck/react build
node scripts/check-bundle-budgets.mjs
pkill -f "storybook dev" || true; pkill -f "serve-site.mjs" || true
pnpm test:e2e -- e2e/site-landing.spec.ts e2e/site-bench.spec.ts e2e/site-quiet.spec.ts e2e/poster.spec.ts e2e/site-nav.spec.ts
pnpm test:deploy
```

Everything above passes. `pnpm test:deploy` (`scripts/check-deploy-artifact.mjs`) is the closest thing this repo has to a full-page smoke test and is worth running once at the end even though no task above names it directly — it is what enforces the exactly-one-`Playdeck`-`h1` constraint against a real built artifact.
