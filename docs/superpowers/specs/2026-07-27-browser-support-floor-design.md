# Declared browser support floor, container-query reference example (#18)

**Issue:** #18 (parent #1). Its acceptance criteria include "release notes list verified platforms and known limitations" — currently unwritable, because nothing in the repo states what Reely supports.

## Goal

Three things, found by asking whether Reely already ships modern CSS:

1. **No declared support floor.** No `browserslist`, no `engines`, no prose. The release notes criterion cannot be met, and nothing stops a contributor raising the floor by accident.
2. **The reference example's responsive rule is viewport-based** (`apps/storybook/stories/reference/reference-player.tsx:144`, `@media (max-width: 420px)`). A player's control row depends on the _player's_ width; embed a 320 px player in a wide page and the breakpoint never fires.
3. **The docs advertise a colour space the theme does not use**, and one that is newer than the floor about to be declared.

## The floor, and the evidence for it

Taken from MDN's `browser-compat-data` at authoring time, not from memory:

| Feature                | Chrome / Edge | Firefox | Safari + iOS | Where it is used                         |
| ---------------------- | ------------- | ------- | ------------ | ---------------------------------------- |
| `@layer`               | 99            | 97      | 15.4         | `theme.css` — **the binding constraint** |
| `accent-color`         | 93            | 92      | 15.4         | `theme.css`                              |
| `:where()`             | 88            | 78      | 14           | `theme.css`, 39 selectors                |
| `IntersectionObserver` | 51            | 55      | 12.1         | `@reely/react` activation                |
| private class fields   | 74            | 90      | 14.1         | `@reely/core` built output               |
| `\|\|=`                | 85            | 79      | 14           | `@reely/core` built output               |

**Chrome/Edge 99 · Firefox 97 · Safari and iOS Safari 15.4.**

Two things are worth stating in the docs because they are counterintuitive. First, **CSS decides the floor, not JavaScript**: the built JS needs nothing newer than Safari 14.1, so a consumer who never imports `theme.css` is bound only by that. Second, `env()`, `forced-colors` and `prefers-reduced-motion` do **not** raise the floor even where support is later, because a media query that never matches simply does not apply — they are progressive enhancement, not requirements.

`@reely/react` also declares `react` and `react-dom` `>=19 <20` as peers, which is a separate constraint and already stated.

## 1. Declaration

- A **Browser support** section in the root `README.md` and in `packages/react/README.md` (the package that owns `theme.css`), carrying the four versions, the binding feature, and the CSS-not-JS point above.
- A `browserslist` field in all six published `package.json` files:

```json
"browserslist": [
  "chrome >= 99",
  "edge >= 99",
  "firefox >= 97",
  "safari >= 15.4",
  "ios_saf >= 15.4"
]
```

Owner decision, 2026-07-27, taken with the caveat stated at the time: **browserslist config in a dependency is not read by consumer tooling** — browserslist resolves against the application's own package.json or config file. This field documents intent in machine-readable form next to the code; it does not configure anyone's build.

## 2. Keeping the claim true

`packages/react/test/theme.test.ts` already reads and parses `theme.css`. It gains one test that extracts every **at-rule**, **functional pseudo-class** and **CSS function** name from the file and asserts the set _equals_ a frozen inventory:

```
at-rules      @layer, @media
pseudos       :where
functions     var, rgb, env
```

Adding `oklch()`, `color-mix()`, `@container` or `:has()` to the theme fails the test, which is the point: raising the floor becomes a deliberate act with a docs change attached, rather than a side effect of a styling tweak.

Gating the **inventory** rather than a feature-to-version mapping is what keeps this cheap: no `caniuse-lite` dependency, no dataset to refresh, nothing that rots. The declared versions live in prose next to a comment naming `@layer` as the binding feature; the test's job is only to notice when that stops being the highest requirement.

## 3. Container queries in the reference example

`.reely-example` becomes a container (`container-type: inline-size`), and **one** rule moves from `@media (max-width: 420px)` to `@container (max-width: 420px)`: `.reely-example-volume { display: none }`.

The other three rules in that block stay on the viewport query, and the reason is a coupling worth stating rather than discovering later. `.reely-example { aspect-ratio: auto }` and its `:has(.reely-example-controls[hidden])` variant style the container **itself**, which cannot query itself. `.reely-example-controls { position: relative }` looks like a child rule, but the comment above it records that it is paired with `aspect-ratio: auto`: below the breakpoint the control row stops being an overlay and takes part in normal flow, which only works because the box has given up its fixed ratio. Driving those two from different queries lets them disagree — a narrow player inside a wide viewport would put the row in flow inside a box still locked to 16:9, which is the clipping #32 already measured at 35 px of lost controls.

So the split is narrower than "control-row rules move", and it is the correct decomposition: **which controls fit** is a question about the player's own width; **how the box lays out in the page, and whether its row is an overlay** is a question about the page. Only the first moves.

**Test.** `e2e/reference.spec.ts`'s existing case resizes the viewport and stays valid, because the example is full-width and narrowing the viewport still narrows the container. It cannot distinguish the two mechanisms, so a new case does: at a **fixed 1280 px viewport**, the player is constrained to 320 px with a test-only injected style, and the volume slider must hide anyway. That assertion fails against today's media-query CSS and passes after the change, which is what makes it worth adding.

`@container` is Chrome 105 / Firefox 110 / Safari 16 — **above** the floor declared for the packages. The reference example is a Storybook composition, not published code, so this does not move the floor; `Reference.mdx` says so explicitly rather than leaving a reader to wonder.

## 4. Colour space in the docs

`Theme.mdx`'s retheming example uses `oklch(0.7 0.2 320)` for the accent while the theme itself ships `#3ea6ff`. `oklch()` became Baseline in May 2023, later than the floor this change declares. The example switches to a hex accent, and one clause records that tokens accept any colour syntax the consumer's own target allows — `oklch()` included. Nothing about the theme requires or prevents either.

## Out of scope

- Changing `theme.css` to use newer CSS. The inventory gate exists precisely so that becomes a decision rather than a drift.
- A light theme, `light-dark()`, or `color-mix()`-derived hover states. The theme is dark by default and retheming is a token override; that is a product question, not this one.
- Container queries anywhere in the published packages. The primitives ship no CSS.
- Release notes themselves (#18's own criterion) — this change makes them writable, it does not write them.

## Verification

```sh
pnpm format:check && pnpm lint && pnpm typecheck && pnpm docs:check && pnpm test && pnpm test:e2e && pnpm test:budgets
```

Baselines to hold (as of `3ed326d`): 816 unit tests, e2e 160 passed / 20 skipped **plus the one new case**, storybook 80. Run gates unpiped.

## Changeset

`.changeset/first-prerelease.md`, corrected in place: the declared floor is a published fact about every package, and `browserslist` is published metadata.
