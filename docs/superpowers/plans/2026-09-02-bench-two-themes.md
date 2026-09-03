# The bench with two themes: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the bench's `none`/`theme` skin switch with `theme`/`docked`, print the composition panel's real ten-control tree instead of one collapsed tag, highlight that panel with Shiki at build time, and rewrite the close's four cells and the lede to match.

**Architecture:** `bench-controls.ts` is a new pure module holding the ten control names as one `const` tuple, so `BenchIsland.tsx` (what mounts) and `bench-composition.ts` (what prints) map over the same list and cannot drift apart at the type level. `Bench.astro`'s frontmatter runs Shiki's `codeToHtml` once per (source, skin) combination at build time and hands the four highlighted strings to `BenchIsland` as props; `CompositionPanel.tsx` becomes a single `dangerouslySetInnerHTML` div around Shiki's own `<pre>`. The skin switch keeps its existing shape (a `<link>` swap, a `BenchPosition` field, a `BenchSwitches` group) and only its two positions and their consequences change.

**Tech Stack:** Astro 7, React 19, `@playdeck/react` primitives, Shiki (added as an `apps/site` devDependency), Vitest for units, Playwright for e2e.

**Depends on:** `docs/superpowers/plans/2026-09-02-player-themes.md` (spec: `docs/superpowers/specs/2026-09-02-player-themes-design.md`). That plan adds `@playdeck/react/docked.css` as a real package export, adds `--playdeck-color-hairline` to the theme contract, fixes #541/#552/#555 in `theme.css`, and adds `--playdeck-activation-size`. Task 5 below imports `@playdeck/react/docked.css?url`, which does not resolve until that export exists, and Task 7 below reads `--playdeck-color-hairline`, which the docked theme is what gives that token a consumer. **Task 5 is blocked until the companion plan has landed and `pnpm build` resolves `@playdeck/react/docked.css?url` in `apps/site`.** Tasks 1 through 4 touch neither file and are not blocked.

Task 6 (the Shiki highlighting) is also untouched by the companion plan directly, but it is ordered after Task 5 in this document rather than before it, and that ordering is load-bearing rather than incidental: Task 6 hardcodes both skin positions when it precomputes the four highlighted strings and calls `buildComposition` with `skin: 'docked'`, so it needs `SkinName` already widened to `'theme' | 'docked'` and the skin switch already offering only those two positions with no `'none'` left to click, both of which are what Task 5 supplies. Task 6 is not independent of Task 5.

---

## File structure

**Created**

| File | Responsibility |
| --- | --- |
| `apps/site/src/bench-controls.ts` | The ten control names as one `const` tuple, and the type derived from it |
| `apps/site/test/bench-controls.test.ts` | The tuple's exact order, and a compile-time proof that a `Record<BenchControlName, …>` missing a key fails to typecheck |

**Modified**

| File | Change |
| --- | --- |
| `apps/site/package.json` | `shiki` added to `devDependencies`, pinned inside Astro's own `^4.0.2` range |
| `apps/site/src/bench-composition.ts` | `SkinName` becomes `'theme' \| 'docked'`; `buildComposition` prints `Root > Viewport > Media, Poster > PosterImage, Controls > ` the ten controls, from `BENCH_CONTROLS`, instead of the six-line collapsed block |
| `apps/site/src/components/BenchIsland.tsx` | `ControlBar` mounts `VolumeSlider`, `CaptionsButton`, the settings menu (`examples/react-menus.tsx`'s `RateMenu`) and `PipButton` alongside the six controls it already mounts, from the same `BENCH_CONTROLS` tuple; the skin default is read from `matchMedia` in the `useState` initializer; the skin `<link>` effect grows a second href; a `<p className="bench__instruction">` line is added above `BenchSwitches`; the changed-line diff and flash run here |
| `apps/site/src/components/BenchSwitches.tsx` | `skinPositions` drops `none` and gains `docked`; `Group`'s `<fieldset>` gains a conditional `hidden md:block` class when `group === 'skin'` |
| `apps/site/src/components/CompositionPanel.tsx` | Stops rendering its own `<pre>`; becomes one `<div dangerouslySetInnerHTML>` around Shiki's own `<pre>` |
| `apps/site/src/components/Bench.astro` | Frontmatter imports `codeToHtml` from `shiki` and `shikiConfig` from `src/shiki.ts`, computes four highlighted strings (one per `(source, skin)` pair) through a `pre`/`line` transformer pair, and passes them to `BenchIsland`; the `[data-bench-skin='none']` reset rule and its comment are deleted; the badge-redraw block drops its `[data-bench-skin='theme']` qualifier so it applies under both remaining skins; `.bench__stage`'s token-mapping block gains `--playdeck-color-hairline: var(--stage-hairline)`; `.bench__credit`'s font size drops to `--text-sm`; `.bench__quiet` is promoted and shares its declarations with a new `.bench__instruction` selector |
| `apps/site/src/styles/tokens.css` | `--stage-hairline: var(--dark-line)` added beside the other `--stage-*` tokens |
| `apps/site/src/styles/base.css` | `.astro-code` gains `margin: 0; overflow-x: auto;` |
| `apps/site/tsconfig.json` | `include` gains `"../../examples/react-menus.tsx"` and `compilerOptions.paths` gains a `@playdeck/react` entry pointing at the built declarations, the same shape `apps/storybook/tsconfig.json` already uses for the two archetype examples |
| `apps/site/tsconfig.test.json` | The same two additions as `apps/site/tsconfig.json`, `include` and `paths`, for the same reason: its own `include` covers `src` too, which is where the import that needs them lives |
| `apps/site/test/bench-composition.test.ts` | The six-line-specific cases are deleted or rewritten for the real tree; every remaining `skin: 'none'` literal not tied to the six-line count moves to `'theme'` |
| `apps/site/src/pages/index.astro` | `figures` becomes the four cells `17 kB`, `One adapter`, `Plays anyway`, `Nothing lies`; the lede's last clause changes |
| `apps/site/DESIGN.md` | Five amendments (see Task 13 for why five, not four) |
| `e2e/site-bench.spec.ts` | The `jsxBlock` helper and its `toHaveLength(6)` assertions are dropped outright, replaced by content assertions against the real ten-control tree; the skin group's two positions and their order are pinned, and a preamble-is-always-four-lines assertion is added once `none` is gone; the highlighted-panel assertion (`span[style*="--shiki"]`) is added |
| `e2e/site-landing.spec.ts` | The lede's full text and the four figure headlines are asserted verbatim; the two stale "same six lines" doc comments are rewritten |

**Not touched**

`bench-sources.ts`, `bench-quiet.ts`, `ReasonLine.tsx` and `bench-capabilities.ts` do not exist or are not read by anything this document changes, the reason line was already cut on this branch (`BenchIsland.tsx`'s own header comment records it) and nothing here reopens it. `e2e/site-quiet.spec.ts` is verified but not modified: it already presses `youtube`/`vimeo`, not `none`, and neither `theme.css` nor `docked.css` is a foreign request once Task 5 lands.

---

### Task 1: Add `shiki`, and prove one copy resolves

Independent of the companion plan. Do this first because Task 6 needs it and there is nothing else in this file it could conflict with.

**Files:**
- Modify: `apps/site/package.json`

- [ ] **Step 1: Confirm the version range Astro itself depends on**

```bash
grep -n '"shiki"' node_modules/.pnpm/astro@7.2.9*/node_modules/astro/package.json
```

Expected: `"shiki": "^4.0.2"` (this repository's installed Astro is 7.2.9; the range is what matters, not the major of Astro itself).

- [ ] **Step 2: Add the devDependency**

In `apps/site/package.json`'s `devDependencies`, alphabetically between `"radix-ui"`'s dependency block (which lives under `dependencies`, not here) and `"tailwindcss"`, actually insert alphabetically among the existing `devDependencies` keys, between `"pagefind"` and `"tailwindcss"`:

```json
    "pagefind": "1.5.2",
    "shiki": "^4.0.2",
    "tailwindcss": "4.3.3",
```

- [ ] **Step 3: Install and prove one copy resolves**

```bash
pnpm install
pnpm --filter @playdeck/site exec node -e "console.log(require.resolve('shiki'))"
pnpm why shiki
```

Expected: the `require.resolve` prints one path under this workspace's `node_modules/.pnpm/shiki@4.x…`; `pnpm why shiki` lists exactly one resolved version across the workspace (Astro's own dependency and `apps/site`'s new one satisfy the same range and pnpm dedupes them). If `pnpm why` prints two different major versions, stop and pin `apps/site`'s entry to match Astro's installed minor exactly rather than proceeding.

- [ ] **Step 4: Typecheck and commit**

```bash
pnpm typecheck
git add apps/site/package.json pnpm-lock.yaml
git commit -m "Add shiki to apps/site, inside Astro's own version range"
```

---

### Task 2: `bench-controls.ts`, the shared tuple

Pure, no React, no DOM, the module both `BenchIsland.tsx` (Task 3) and `bench-composition.ts` (Task 4) map over so the mounted tree and the printed tree cannot silently disagree.

**Files:**
- Create: `apps/site/src/bench-controls.ts`
- Create: `apps/site/test/bench-controls.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';
import { BENCH_CONTROLS, type BenchControlName } from '../src/bench-controls';

describe('BENCH_CONTROLS', () => {
  it('lists SeekSlider first, then row two in the contract order', () => {
    expect(BENCH_CONTROLS).toEqual([
      'seekSlider',
      'playButton',
      'muteButton',
      'volumeSlider',
      'timeCurrent',
      'timeDuration',
      'captionsButton',
      'settingsMenu',
      'pipButton',
      'fullscreenButton'
    ]);
  });

  it('fails to typecheck a Record missing one control name', () => {
    // A total Record<BenchControlName, T> forces every name in the tuple to
    // have an entry. Omitting one, `pipButton`, here, must not compile: if
    // it stops erroring, this directive itself fails under `tsc -b`
    // ("Unused '@ts-expect-error' directive"), which is what makes this a
    // real proof rather than a comment nobody re-reads.
    // @ts-expect-error a Record<BenchControlName, T> missing 'pipButton' must not typecheck.
    const incomplete: Record<BenchControlName, true> = {
      seekSlider: true,
      playButton: true,
      muteButton: true,
      volumeSlider: true,
      timeCurrent: true,
      timeDuration: true,
      captionsButton: true,
      settingsMenu: true,
      fullscreenButton: true
    };
    expect(Object.keys(incomplete)).toHaveLength(9);
  });
});
```

- [ ] **Step 2: Run and watch it fail**

```bash
pnpm vitest run apps/site/test/bench-controls.test.ts
```

Expected: `Cannot find module '../src/bench-controls'`.

- [ ] **Step 3: Write the module**

```ts
/*
 * The ten controls `BenchIsland.tsx` mounts inside `Player.Controls`, and
 * `bench-composition.ts` prints in the same order, one tuple, mapped over by
 * both, rather than two hand-kept lists that can drift.
 *
 * The order is the companion spec's own control-bar contract: `SeekSlider`
 * alone is row one, and row two is everything else in this sequence. Two
 * entries name a shared component under two configurations (`Player.Time`
 * with `type="current"` and `type="duration"`) rather than one entry each for
 * `Time`, because what a consumer composes is two distinct elements and the
 * tuple is a list of composed things, not of component names.
 *
 * `Record<BenchControlName, …>` is what a name added here or removed forces:
 * `ControlBar` in `BenchIsland.tsx` and the line-table in `bench-composition.ts`
 * each keep one, and TypeScript's missing-key checking on an object literal
 * assigned to a `Record` type fails a build the moment the two stop agreeing, * the same discipline `bySource` in `bench-sources.ts` already uses for
 * provider entries.
 */
export const BENCH_CONTROLS = [
  'seekSlider',
  'playButton',
  'muteButton',
  'volumeSlider',
  'timeCurrent',
  'timeDuration',
  'captionsButton',
  'settingsMenu',
  'pipButton',
  'fullscreenButton'
] as const;

export type BenchControlName = (typeof BENCH_CONTROLS)[number];
```

- [ ] **Step 4: Run and watch it pass**

```bash
pnpm vitest run apps/site/test/bench-controls.test.ts
pnpm typecheck
```

Expected: 2 passed; typecheck clean (the `@ts-expect-error` line is checked because `apps/site/tsconfig.test.json` includes `"test"` and is referenced from the root `tsconfig.json`).

- [ ] **Step 5: Commit**

```bash
git add apps/site/src/bench-controls.ts apps/site/test/bench-controls.test.ts
git commit -m "Share the bench's ten control names between what mounts and what prints"
```

---

### Task 3: `BenchIsland` mounts the full control set

Not blocked by the companion plan: these controls render under whichever stylesheet is currently loaded (still `theme.css` only, at this point in the plan) exactly as `FullscreenButton` already does, absent where a provider or `theme.css`'s own layout cannot honour them, present otherwise.

**Files:**
- Modify: `apps/site/src/components/BenchIsland.tsx`
- Modify: `apps/site/tsconfig.json`
- Modify: `apps/site/tsconfig.test.json`

- [ ] **Step 1: Let `apps/site`'s own typecheck reach `examples/react-menus.tsx`**

`RateMenu` lives outside `apps/site/src`, and `apps/site/tsconfig.json` is `composite: true`, so a file outside its `include` glob that gets imported fails `tsc -b` with "File is not listed within the file list of project. Projects must list all files or use an 'include' pattern." And `examples/` is `noEmit`, so it cannot be added as a project *reference* either (the same TS6310 `apps/site/tsconfig.test.json`'s own comment names). `apps/storybook/tsconfig.json` already solves this for the two archetype examples the same way: `include` names them directly, and a `paths` block maps `@playdeck/*` to each package's built declarations, because a module specifier resolves from the *importing* file's own directory, and `examples/` sits outside `apps/site`, so the walk up from `examples/react-menus.tsx` never reaches `apps/site/node_modules`, where the workspace link to `@playdeck/react` lives, and lands instead on the repository root's `node_modules/@playdeck/`, which holds only a `test-support` symlink. Do the same, `include` and `paths` both:

```json
  "include": [
    "astro.config.ts",
    "src/**/*.ts",
    "src/**/*.tsx",
    "../../examples/react-menus.tsx"
  ],
```

```json
  "paths": {
    "@/*": ["./src/*"],
    "@playdeck/react": ["../../packages/react/dist/index.d.ts"]
  },
```

`react-menus.tsx` imports only `@playdeck/react`, so that is the one entry needed here; `apps/site/tsconfig.json`'s own `references` array already builds that package first.

`apps/site/tsconfig.test.json`'s own `include` is `["src", "test"]`, and TypeScript expands a bare directory entry to every file under it, so once `BenchIsland.tsx` (under `src`) imports `examples/react-menus.tsx`, that project hits the identical TS6307 error under `tsc -b`, and the root `tsconfig.json` references this project too. Make the same two additions there:

```json
  "include": ["src", "test", "../../examples/react-menus.tsx"],
```

```json
  "paths": {
    "@/*": ["./src/*"],
    "@playdeck/react": ["../../packages/react/dist/index.d.ts"]
  },
```

- [ ] **Step 2: Write the failing test**

Extend `ControlBar`'s state selector and expected output is exercised end-to-end in Task 4's e2e assertion (the printed tree) and this task's own build; there is no isolated unit for a React component here (none of `BenchIsland.tsx`'s existing pieces have one either). Instead, prove the change by building and looking:

```bash
pgrep -af "astro.mjs dev" || pnpm --filter @playdeck/site dev
```

Expected before this step's implementation: the control bar shows six controls (play, mute, seek, two times, fullscreen) and no volume slider, captions button, settings gear or PiP button.

- [ ] **Step 3: Import what the four new controls need**

In `BenchIsland.tsx`'s existing `import * as Player from '@playdeck/react'` block there is nothing to add, `Player.VolumeSlider`, `Player.CaptionsButton`, `Player.PipButton`, `Player.SettingsMenu` and friends are already exported from the package. Add three more imports:

```ts
import { BENCH_CONTROLS, type BenchControlName } from '@/bench-controls';
import { RateMenu } from '../../../../examples/react-menus';
```

(`Fragment` and `type ReactNode` from `'react'` too, added to the existing `import { useEffect, useRef, useState, type RefObject } from 'react';` line, matching this file's existing style of importing React's own types by name rather than reaching for the UMD `React.*` namespace.)

- [ ] **Step 4: Widen `ControlBar`'s state selector and build the control map**

`PipButton` has no default icon (unlike `CaptionsButton`, which falls back to `<CaptionsIcon />` on its own); mounting it with an icon that tracks `pictureInPicture` state follows the same pattern `PlayButton`, `MuteButton` and `FullscreenButton` already use in this file. `VolumeSlider`, `CaptionsButton` and the settings menu need no icon swap and are mounted bare.

```tsx
const ControlBar = ({ fromKeyboardRef }: ControlBarProps) => {
  const state = Player.usePlayerState((snapshot) => ({
    activation: snapshot.activation,
    playing: snapshot.playback === 'playing',
    muted: snapshot.muted,
    fullscreen: snapshot.fullscreen,
    pictureInPicture: snapshot.pictureInPicture
  }));
  // … fromKeyboardRef effect unchanged …

  // Keyed by `BenchControlName` so the tuple in `bench-controls.ts` is the
  // one place either the mounted tree or the printed tree (`bench-composition.ts`)
  // can grow or shrink from. The separator between the two `Time`s is
  // consumer text rather than a part of its own (see `Bench.astro`'s comment
  // history and the companion spec's row-two contract), so it travels with
  // `timeDuration` rather than getting an eleventh entry.
  const controls: Record<BenchControlName, ReactNode> = {
    seekSlider: <Player.SeekSlider />,
    playButton: (
      <Player.PlayButton ref={playButton}>
        {state.playing ? <Player.PauseIcon /> : <Player.PlayIcon />}
      </Player.PlayButton>
    ),
    muteButton: (
      <Player.MuteButton>
        {state.muted ? <Player.MutedIcon /> : <Player.VolumeHighIcon />}
      </Player.MuteButton>
    ),
    volumeSlider: <Player.VolumeSlider />,
    timeCurrent: <Player.Time type="current" />,
    timeDuration: (
      <>
        <span aria-hidden="true"> / </span>
        <Player.Time type="duration" />
      </>
    ),
    captionsButton: <Player.CaptionsButton />,
    settingsMenu: <RateMenu />,
    pipButton: (
      <Player.PipButton>
        {state.pictureInPicture ? <Player.PipExitIcon /> : <Player.PipEnterIcon />}
      </Player.PipButton>
    ),
    fullscreenButton: (
      <Player.FullscreenButton>
        {state.fullscreen ? (
          <Player.FullscreenExitIcon />
        ) : (
          <Player.FullscreenEnterIcon />
        )}
      </Player.FullscreenButton>
    )
  };

  return (
    <Player.Controls hidden={!ready}>
      {BENCH_CONTROLS.map((name) => (
        <Fragment key={name}>{controls[name]}</Fragment>
      ))}
    </Player.Controls>
  );
};
```

Remove the old inline six-child JSX this replaces.

- [ ] **Step 5: Typecheck, look at it, and commit**

```bash
pnpm typecheck && pnpm lint
pgrep -af "astro.mjs dev" || pnpm --filter @playdeck/site dev
```

Look: the control bar now shows all ten controls (volume slider next to mute, a captions glyph, a settings gear that opens a rate menu, a PiP glyph) even though `theme.css` has not yet been revised for the two-row layout the companion plan adds, some crowding at narrow widths is expected and not a defect this task fixes.

```bash
git add apps/site/src/components/BenchIsland.tsx apps/site/tsconfig.json apps/site/tsconfig.test.json
git commit -m "Mount the bench's full ten-control bar from bench-controls.ts"
```

---

### Task 4: `bench-composition` prints the real tree

**Files:**
- Modify: `apps/site/src/bench-composition.ts`
- Modify: `apps/site/test/bench-composition.test.ts`
- Modify: `e2e/site-bench.spec.ts`

- [ ] **Step 1: Write the failing unit test**

Add to (or rewrite the relevant cases in) `apps/site/test/bench-composition.test.ts`:

```ts
it('prints the real ten-control tree, SeekSlider first', () => {
  const code = buildComposition({
    source: 'youtube',
    skin: 'theme',
    sourceUrl: 'https://example.com/clip'
  });
  const tree = code.slice(code.indexOf('<Player.Root'));
  expect(tree).toBe(
    [
      '<Player.Root source={source}>',
      '  <Player.Viewport>',
      '    <Player.Media />',
      '    <Player.Poster>',
      '      <Player.PosterImage />',
      '    </Player.Poster>',
      '    <Player.Controls>',
      '      <Player.SeekSlider />',
      '      <Player.PlayButton />',
      '      <Player.MuteButton />',
      '      <Player.VolumeSlider />',
      '      <Player.Time type="current" />',
      '      <span aria-hidden="true"> / </span>',
      '      <Player.Time type="duration" />',
      '      <Player.CaptionsButton />',
      '      <Player.SettingsMenu>',
      '        <Player.SettingsMenuTrigger />',
      '        <Player.SettingsMenuContent />',
      '      </Player.SettingsMenu>',
      '      <Player.PipButton />',
      '      <Player.FullscreenButton />',
      '    </Player.Controls>',
      '  </Player.Viewport>',
      '</Player.Root>'
    ].join('\n')
  );
});
```

Also settle what is already in this file: the six-line-specific cases have to go, since the block they pin no longer exists, and every other case's `skin: 'none'` literal has to move off it before Task 5 narrows `SkinName` and turns `'none'` into a type error there.

- Delete `'prints the six lines the page claims drive all five providers'`. The fixed six-line block it pins is gone, replaced by the test just added above.
- Delete `'is six lines of composition, whatever the switches are set to'`. The six-line invariant it pins is gone, and nothing here needs a like-for-like replacement: the new test above already pins the tree's real shape.
- In `'changes the source URL when the source switch changes, and nothing else'`, change both `skin: 'none'` literals to `skin: 'theme'`. The test is not about which skin, only about the block staying identical across providers, so any valid skin proves the same point.
- In `'names no prop on Player.Root but the source'`, change `for (const skin of ['none', 'theme'] as const)` to `for (const skin of ['theme'] as const)`. Same reasoning: the loop was never about which skin, only about `Player.Root`'s own prop list, and `'none'` is leaving.
- Leave `'adds the theme import only when the theme skin is chosen'` exactly as it is here, still comparing `'none'` against `'theme'`. Task 5 rewrites it once `'none'` is gone, comparing `'theme'` against `'docked'` instead, since both remaining `SkinName` positions now carry an import line and the case this test makes (bare vs. imported) no longer exists to test.
- In `'carries a long source URL through whole, without truncating or eliding it'`, change `skin: 'none'` to `skin: 'theme'`.
- In the `it.each` table inside `'never leaves a trailing space on a line'`, change both `skin: 'none'` entries to `skin: 'theme'`.

None of these six edits touches a test's own assertions, only the skin literal each already passes in.

- [ ] **Step 2: Run and watch it fail**

```bash
pnpm vitest run apps/site/test/bench-composition.test.ts
```

Expected: fails, the old six-line block does not match.

- [ ] **Step 3: Write the control-to-lines table and rebuild `buildComposition`**

```ts
import { BENCH_CONTROLS, type BenchControlName } from './bench-controls';

/**
 * Each control's printed source, one entry short of `bench-controls.ts`'s own
 * eleven-name gap: `timeDuration` carries the separator's line too, since the
 * separator is consumer text between the two `Player.Time`s rather than a
 * control of its own (see the companion spec's row-two contract). The settings
 * menu prints that a settings control exists, trigger and content, both
 * self-closing, without printing what `RateMenu` mounts inside it, per the
 * spec's own instruction that the panel need not print what is inside a menu.
 */
const CONTROL_LINES: Record<BenchControlName, readonly string[]> = {
  seekSlider: ['<Player.SeekSlider />'],
  playButton: ['<Player.PlayButton />'],
  muteButton: ['<Player.MuteButton />'],
  volumeSlider: ['<Player.VolumeSlider />'],
  timeCurrent: ['<Player.Time type="current" />'],
  timeDuration: [
    '<span aria-hidden="true"> / </span>',
    '<Player.Time type="duration" />'
  ],
  captionsButton: ['<Player.CaptionsButton />'],
  settingsMenu: [
    '<Player.SettingsMenu>',
    '  <Player.SettingsMenuTrigger />',
    '  <Player.SettingsMenuContent />',
    '</Player.SettingsMenu>'
  ],
  pipButton: ['<Player.PipButton />'],
  fullscreenButton: ['<Player.FullscreenButton />']
};
```

Replace the tail of `buildComposition`, the six hardcoded lines, with:

```ts
  const controlLines = BENCH_CONTROLS.flatMap((name) => CONTROL_LINES[name]);

  return [
    ...preamble,
    '<Player.Root source={source}>',
    '  <Player.Viewport>',
    '    <Player.Media />',
    '    <Player.Poster>',
    '      <Player.PosterImage />',
    '    </Player.Poster>',
    '    <Player.Controls>',
    ...controlLines.map((line) => `      ${line}`),
    '    </Player.Controls>',
    '  </Player.Viewport>',
    '</Player.Root>'
  ].join('\n');
```

- [ ] **Step 4: Run and watch it pass**

```bash
pnpm vitest run apps/site/test/bench-composition.test.ts
```

Expected: all tests pass now, six cases fewer than before the two deletions above and with the remaining `skin: 'none'` literals gone, and none of the new lines end in whitespace.

- [ ] **Step 5: Update `e2e/site-bench.spec.ts`'s stale six-line assertions, and drop the `jsxBlock` helper it leans on**

The composition it built for is gone, and `jsxBlock`'s `toHaveLength(6)` calls fail against a 23-line tree. But the helper itself has to go too, not just the calls that use it: the spec's own verification section says so directly ("The `jsxBlock` helper and its `toHaveLength(6)` assertions are dropped... replaced by an assertion that the preamble is always four lines"), and the helper's own doc comment ties its reason for existing to the six-line count Task 11 below deletes from the page. Delete both the `jsxBlock` function and the doc comment above it (currently the `/** The lines of the JSX block... */` paragraph and the function beneath it).

Replace the whole `'the composition tracks both switches'` test with one that checks content and document order instead of a line count, and keeps the source-press coverage the deleted test carried (Task 5 below owns the skin-press coverage, once `'none'` is gone and the skin group offers only `theme` and `docked`):

```ts
test('the composition prints the full control tree, and tracks the source switch', async ({ page }) => {
  await page.goto(landing);
  await expect(composition(page)).toBeVisible();

  const atRest = await printed(page);
  expect(atRest).toContain(THEME_IMPORT);
  for (const name of [
    'Player.SeekSlider',
    'Player.PlayButton',
    'Player.MuteButton',
    'Player.VolumeSlider',
    'Player.CaptionsButton',
    'Player.SettingsMenu',
    'Player.PipButton',
    'Player.FullscreenButton'
  ]) {
    expect(atRest).toContain(name);
  }
  // SeekSlider sits third in BenchIsland.tsx's mounted order today; it moves
  // to first, ahead of PlayButton, in document order in the printed tree too.
  // A position comparison rather than an index into a hand-sliced array, so
  // it does not depend on how many lines precede the tree.
  expect(atRest.indexOf('<Player.SeekSlider />')).toBeLessThan(
    atRest.indexOf('<Player.PlayButton />')
  );

  // The source switch moves the line above the block, not a prop inside it:
  // the library detects a provider from the URL, so `source={source}` is the
  // whole of `Player.Root`'s configuration whichever position is pressed.
  const before = await printed(page);
  await position(page, 'source', 'vimeo').click();
  await expect
    .poll(async () => sourceLine(await printed(page)))
    .not.toBe(sourceLine(before));

  // And nothing else about the block moves: the tree checked above is still
  // there, unchanged, after the press.
  const after = await printed(page);
  for (const name of ['Player.SeekSlider', 'Player.SettingsMenu', 'Player.FullscreenButton']) {
    expect(after).toContain(name);
  }
});
```

Run it once against a dev server to confirm the shape before moving on:

```bash
pnpm playwright test e2e/site-bench.spec.ts --project=chromium
```

- [ ] **Step 6: Typecheck, lint, and commit**

```bash
pnpm typecheck && pnpm lint
git add apps/site/src/bench-composition.ts apps/site/test/bench-composition.test.ts e2e/site-bench.spec.ts
git commit -m "Print the bench's real ten-control tree instead of one collapsed tag"
```

---

### Task 5: The skin switch becomes `theme`/`docked`

**Blocked until the companion plan ships `@playdeck/react/docked.css`.** Before starting, confirm the export resolves:

```bash
pnpm --filter @playdeck/site exec node -e "console.log(require.resolve('@playdeck/react/docked.css'))"
```

If that throws, stop and wait for `docs/superpowers/plans/2026-09-02-player-themes.md` to land.

**Files:**
- Modify: `apps/site/src/bench-composition.ts`
- Modify: `apps/site/src/components/BenchSwitches.tsx`
- Modify: `apps/site/src/components/BenchIsland.tsx`
- Modify: `apps/site/src/components/Bench.astro`
- Modify: `e2e/site-bench.spec.ts`
- Modify: `e2e/site-landing.spec.ts`

- [ ] **Step 1: Write the failing e2e assertions**

Add to `e2e/site-bench.spec.ts`:

```ts
test('the skin group offers theme and docked, in that order, and no third position', async ({ page }) => {
  await page.goto(landing);
  const skinButtons = page.locator('[data-bench-switch="skin"] [data-value]');
  await expect(skinButtons).toHaveCount(2);
  await expect(skinButtons.nth(0)).toHaveAttribute('data-value', 'theme');
  await expect(skinButtons.nth(1)).toHaveAttribute('data-value', 'docked');
});

test('the skin fieldset is hidden below 48rem', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 800 });
  await page.goto(landing);
  await expect(page.locator('[data-bench-switch="skin"]')).toBeHidden();
  await expect(page.locator('[data-bench-switch="source"]')).toBeVisible();
});

test('docked.css is a real <link>, in the document, when pressed', async ({ page }) => {
  await page.goto(landing);
  await position(page, 'skin', 'docked').click();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          Array.from(document.querySelectorAll('link[rel="stylesheet"]')).some(
            (link) => (link as HTMLLinkElement).href.includes('docked')
          )
      )
    )
    .toBe(true);
});
```

- [ ] **Step 2: Run and watch them fail**

```bash
pnpm playwright test e2e/site-bench.spec.ts --project=chromium
```

- [ ] **Step 3: `bench-composition.ts`'s `SkinName`**

```ts
export type SkinName = 'theme' | 'docked';
```

The preamble's conditional import already keys off `skin === 'theme'`; extend it so both positions print an import line, never zero:

```ts
const preamble = [
  `import '@playdeck/react/${skin}.css';`,
  '',
  `const source = '${sourceUrl}';`,
  ''
];
```

(Drops the `skin === 'theme' ? [...] : []` ternary, every remaining position ships a stylesheet, so the import line is unconditional now.)

- [ ] **Step 4: `BenchSwitches.tsx`'s `skinPositions`, and the hidden fieldset**

```ts
const skinPositions: readonly Position<SkinName>[] = [
  { value: 'theme', token: 'theme', label: 'theme' },
  { value: 'docked', token: 'docked', label: 'docked' }
];
```

`Group`'s `<fieldset>` gains the conditional class, read off the `group` prop it already destructures:

```tsx
<fieldset
  data-bench-switch={group}
  className={cn(
    'm-0 min-w-0 border-0 p-0',
    group === 'skin' && 'hidden md:block'
  )}
>
```

(`cn` is already imported in this file. This is a class read off the `group` prop `Group` already destructures internally, not a `className` prop added to `Group`'s own signature; `Group` still takes no such prop from a caller.)

- [ ] **Step 5: `BenchIsland.tsx`'s default, and the two-href `<link>` effect**

Replace the `themeHref`-only import with both:

```ts
import themeHref from '@playdeck/react/theme.css?url';
import dockedHref from '@playdeck/react/docked.css?url';
```

The `useState` initializer picks the skin before first paint, the same way `readySources[0]` already picks the source:

```ts
const [position, setPosition] = useState<BenchPosition & ResolvedSource>(() => {
  const initial = readySources[0];
  if (initial === undefined) {
    throw new Error('BenchIsland: no ready bench source to default to.');
  }
  return {
    source: initial.provider,
    skin: window.matchMedia('(min-width: 48rem)').matches ? 'theme' : 'docked',
    ...entryFor(initial.provider, base)
  };
});
```

The `<link>` effect grows one branch, always exactly one `<link>` in the head, never zero:

```ts
useEffect(() => {
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = position.skin === 'theme' ? themeHref : dockedHref;
  document.head.append(link);
  return () => {
    link.remove();
  };
}, [position.skin]);
```

Delete the old comment block above this effect explaining the `none`/`theme` two-way choice; replace it with one line: the same `?url` mechanism, now swapping between two real stylesheets rather than adding and removing one.

Also delete the `BenchIsland` function's own header comment paragraph arguing for `theme` as the resting position over `none`, that argument no longer applies (there is no unstyled position to default away from); replace with a short note that the default now follows `matchMedia`, read once, synchronously, the same way `readySources[0]` already is.

- [ ] **Step 6: `Bench.astro`'s dead `[data-bench-skin='none']` rule**

Delete the whole rule and its two paragraphs of comment (the "why every selector below is `:global()`" section stays; only the `none`-specific block goes):

```css
  :global(.bench__stage)
    :global([data-bench-skin='none'] [data-playdeck-part='activation']) {
    background-color: transparent;
    border: 0;
  }
```

Leave the badge-redraw block below it untouched in this step, Task 8 rescopes it, once the companion plan's `--playdeck-activation-size` token exists to check against.

- [ ] **Step 7: Add `e2e/site-bench.spec.ts`'s preamble assertion**

Add the spec's own invariant, every combination's preamble is four lines, always:

```ts
const preambleLines = (printedText: string) => {
  const lines = printedText.split('\n');
  const open = lines.findIndex((line) => line.startsWith('<Player.Root'));
  return lines.slice(0, open);
};

test('the preamble is always four lines, in every combination', async ({ page }) => {
  await page.goto(landing);
  for (const skinToken of ['theme', 'docked']) {
    await position(page, 'skin', skinToken).click();
    for (const sourceToken of ['youtube', 'vimeo']) {
      await position(page, 'source', sourceToken).click();
      const lines = preambleLines(await printed(page));
      expect(lines).toHaveLength(4);
      expect(lines[0]).toBe(`import '@playdeck/react/${skinToken}.css';`);
      expect(lines[1]).toBe('');
      expect(lines[3]).toBe('');
    }
  }
});
```

Nothing to delete here: Task 4's own rewrite of `'the composition tracks both switches'` (now `'the composition prints the full control tree, and tracks the source switch'`) never pressed `'none'` and never checked a fixed line count, so there is no stale `'none'` assertion left in this file to remove.

- [ ] **Step 8: `e2e/site-landing.spec.ts`'s stale doc comment**

Its own comment (lines ~41-46) says "the thesis paragraph says 'the same six lines drive all five'". Task 11 rewrites the sentence it is quoting; update this comment there rather than here, to avoid two edits to the same paragraph in two tasks. Leave a `// TODO(#task-11)` marker if it helps, or do both edits in this task if it is faster, either order is fine as long as the final text is correct by Task 11's commit.

- [ ] **Step 9: Run everything, look at it, commit**

```bash
pnpm typecheck && pnpm lint
pnpm playwright test e2e/site-bench.spec.ts e2e/site-quiet.spec.ts --project=chromium
pgrep -af "astro.mjs dev" || pnpm --filter @playdeck/site dev
```

Look: press `docked` above 48rem, the bar drops under the picture. Narrow the window below 48rem: the skin fieldset disappears, the source fieldset stays.

```bash
git add apps/site/src/bench-composition.ts apps/site/src/components/BenchSwitches.tsx apps/site/src/components/BenchIsland.tsx apps/site/src/components/Bench.astro e2e/site-bench.spec.ts
git commit -m "Give the skin switch theme and docked in place of none and theme"
```

---

### Task 6: Shiki highlights the panel at build

Depends on Task 5, not on the companion plan directly: this task hardcodes both skin positions when it precomputes the four highlighted strings and calls `buildComposition` with `skin: 'docked'`, neither of which typechecks until Task 5 has widened `SkinName` to `'theme' | 'docked'` and left the skin switch offering only those two positions, with no `'none'` left for a reader to click into a position this task's own hard-coded lookup does not cover. `Bench.astro`'s frontmatter runs once per build, in Node, so nothing here ships a highlighter to the browser.

**Files:**
- Modify: `apps/site/src/components/Bench.astro`
- Modify: `apps/site/src/components/CompositionPanel.tsx`
- Modify: `apps/site/src/components/BenchIsland.tsx`
- Modify: `apps/site/src/styles/base.css`

- [ ] **Step 1: Write the failing e2e assertion**

Add to `e2e/site-bench.spec.ts`:

```ts
test('the composition panel is highlighted', async ({ page }) => {
  await page.goto(landing);
  await expect(
    composition(page).locator('span[style*="--shiki"]').first()
  ).toBeVisible();
});
```

- [ ] **Step 2: Run and watch it fail**

```bash
pnpm playwright test e2e/site-bench.spec.ts --project=chromium -g "is highlighted"
```

Expected: fails, `CompositionPanel.tsx` still renders a plain `<pre><code>`.

- [ ] **Step 3: Write the two transformers in `Bench.astro`'s frontmatter**

Add near the top of the frontmatter, after the existing imports:

```ts
import { codeToHtml } from 'shiki';
import { shikiConfig } from '../shiki';
import type { ShikiTransformer } from 'shiki';
import { buildComposition } from '../bench-composition';

/**
 * `codeToHtml`'s output is a whole `<pre><code>…</code></pre>`, carrying
 * `class="shiki github-light github-dark"` rather than the `astro-code` class
 * `base.css`'s token-colour selectors key on and that Astro's own `<Code>`
 * adds automatically. This `pre` hook adds it, plus the two attributes
 * `CompositionPanel.tsx` used to set on its own `<pre>`, `data-bench-composition`
 * and `tabindex="0"`, so there is exactly one `<pre>` in the DOM and Shiki
 * owns it. `hast.properties.class` types as `string | number | (string |
 * number)[] | undefined`, not a plain string, so this merges it rather than
 * assuming a string it might not be.
 */
const addBenchPreAttributes: ShikiTransformer['pre'] = function (hast) {
  const existingClass = hast.properties.class;
  const classText = Array.isArray(existingClass)
    ? existingClass.join(' ')
    : (existingClass ?? '');
  hast.properties.class = `${classText} astro-code`.trim();
  hast.properties['data-bench-composition'] = '';
  hast.properties.tabindex = '0';
  return hast;
};

/**
 * Marks every rendered line with its 1-indexed position, so `BenchIsland.tsx`
 * can address a changed line with `[data-line="N"]` after a press without
 * re-parsing the highlighted HTML.
 */
const markLineNumbers: ShikiTransformer['line'] = function (hast, line) {
  hast.properties['data-line'] = String(line);
  return hast;
};

/**
 * One highlighted string per (source, skin) pair the switches can reach,
 * today `readySources` is `youtube` and `vimeo`, and `SKIN_POSITIONS` is
 * `theme` and `docked`, so this is four strings, computed once here in Node
 * and handed to `BenchIsland` as props. `readySources.map` rather than a
 * hardcoded pair count, so a third `ready: true` source in `bench-sources.ts`
 * grows this table rather than silently leaving a position unhighlighted.
 * `SKIN_POSITIONS` itself stays a fixed pair rather than reading `SkinName`
 * some other way, because Task 5 is what makes `'theme' | 'docked'` the whole
 * of that type; before Task 5 has landed, this file does not compile.
 */
const SKIN_POSITIONS = ['theme', 'docked'] as const;

const compositions: Record<string, string> = {};
for (const entry of readySources) {
  for (const skin of SKIN_POSITIONS) {
    const code = buildComposition({
      source: entry.provider,
      skin,
      sourceUrl: entry.source(base)
    });
    compositions[`${entry.provider}:${skin}`] = await codeToHtml(code, {
      lang: 'tsx',
      ...shikiConfig,
      transformers: [
        ...shikiConfig.transformers,
        { name: 'playdeck:bench-pre', pre: addBenchPreAttributes, line: markLineNumbers }
      ]
    });
  }
}
```

This runs after `base` is computed. It also needs `readySources`, which `Bench.astro` does not import today: its existing import is `import { benchSources } from '../bench-sources';`, for the `fallback` computation elsewhere in this file. Widen it:

```ts
import { benchSources, readySources } from '../bench-sources';
```

- [ ] **Step 4: Pass the four strings to `BenchIsland`**

```astro
<BenchIsland base={base} compositions={compositions} client:only="react" />
```

- [ ] **Step 5: Rewrite `CompositionPanel.tsx`**

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
 */
export type CompositionPanelProps = {
  /** One of `Bench.astro`'s four precomputed strings, picked by (source, skin). */
  readonly html: string;
};

export default function CompositionPanel({ html }: CompositionPanelProps) {
  return <div dangerouslySetInnerHTML={{ __html: html }} />;
}
```

- [ ] **Step 6: Wire `BenchIsland.tsx` to pick the right string**

```ts
interface Props {
  readonly base: string;
  /** `Bench.astro`'s four precomputed strings, keyed `${provider}:${skin}`. */
  readonly compositions: Readonly<Record<string, string>>;
}
```

```tsx
const BenchIsland = ({ base, compositions }: Props) => {
  // … existing state …
  const html = compositions[`${position.source}:${position.skin}`];
  if (html === undefined) {
    throw new Error(
      `BenchIsland: no precomputed composition for ${position.source}:${position.skin}.`
    );
  }
  // … <CompositionPanel html={html} /> replaces <CompositionPanel composition={buildComposition(position)} /> …
};
```

The hard throw above is safe only because Task 5 already landed: `position.skin` can no longer be `'none'`, and `compositions` covers exactly the two skins `SKIN_POSITIONS` iterates in Step 3, so every reachable `position` has an entry.

`buildComposition` stays imported in this file, Task 9 below needs it to compute plain-text lines for the changed-line diff, even though the *displayed* HTML now comes from `compositions`.

- [ ] **Step 7: `base.css` gains what the deleted `<pre>` used to carry**

```css
.astro-code {
  padding: var(--space-4);
  background-color: var(--color-sunken);
  border-radius: var(--radius-md);
  line-height: var(--leading-snug);
  margin: 0;
  overflow-x: auto;
  scrollbar-width: thin;
}
```

Both new declarations are harmless on every other Astro-emitted `.astro-code` block (`start.astro`, the reference pages), which already carries them from Astro's own output. Also update the comment already on this rule, which currently says `.astro-code` sets neither `margin` nor `overflow-x` because "Astro emits `overflow-x: auto` and `tabindex=\"0\"` on the block itself". That is true of every block Astro's own `<Code>` or markdown pipeline renders, and no longer true of every `.astro-code` block full stop, since the bench's own `<pre>` is built by hand through this task's `pre` transformer rather than through either of those, and gets neither for free. Reword it to say this rule now sets `overflow-x: auto` itself for exactly that reason (the transformer sets `tabindex="0"`), and `margin: 0` clears the `<pre>` default this rule now overrides too; every other Astro-emitted block keeps getting both from Astro's own output regardless, so the two declarations are redundant there and load-bearing here.

- [ ] **Step 8: Run the e2e assertion, then the full unit suite, then commit**

```bash
pnpm playwright test e2e/site-bench.spec.ts --project=chromium
pnpm vitest run
pnpm typecheck && pnpm lint
git add apps/site/src/components/Bench.astro apps/site/src/components/CompositionPanel.tsx apps/site/src/components/BenchIsland.tsx apps/site/src/styles/base.css e2e/site-bench.spec.ts
git commit -m "Highlight the composition panel with Shiki at build time"
```

---

### Task 7: `--stage-hairline`

Depends on Task 5 (the skin switch has to offer `docked` for this token to have a consumer), not on the companion plan directly, the token is inert under `theme.css`, the same way every `--stage-*` token already is until the stylesheet reading it loads.

**Files:**
- Modify: `apps/site/src/styles/tokens.css`
- Modify: `apps/site/src/components/Bench.astro`

- [ ] **Step 1: Add the token**

In `tokens.css`, beside the other `--stage-*` roles (near `--stage-line-strong`):

```css
  /* The docked theme's one hairline, the top border separating the bar from
   * the picture where there is no scrim to do that job. Set from `--dark-line`
   * rather than a new hex, the same way the other `--stage-*` roles reuse a
   * dark-mode primitive rather than each carrying a literal. Never moves with
   * `data-theme`, like every other `--stage-*` token. */
  --stage-hairline: var(--dark-line);
```

- [ ] **Step 2: Map it on the stage**

In `Bench.astro`'s `.bench__stage` token-mapping block, beside `--playdeck-color-focus`:

```css
    --playdeck-color-hairline: var(--stage-hairline);
```

- [ ] **Step 3: Typecheck, build, commit**

```bash
pnpm build
git add apps/site/src/styles/tokens.css apps/site/src/components/Bench.astro
git commit -m "Map --playdeck-color-hairline to the stage's own dark hairline"
```

---

### Task 8: Rescope the badge redraw to both remaining skins

**Files:**
- Modify: `apps/site/src/components/Bench.astro`

- [ ] **Step 1: Write the failing check**

Manual, since this is a CSS specificity fact rather than something worth a new Playwright spec: with `docked` pressed, click two inches from the activation badge, inside the frame. Today (before this task) that click does nothing under `docked`, because the badge-redraw block is scoped to `[data-bench-skin='theme']` only.

- [ ] **Step 2: Drop the skin qualifier**

The three selectors under the "other half of the same defect" comment currently read `[data-bench-skin='theme'] [data-playdeck-part='activation']` (and its `::before` and `> svg` siblings). Since `data-bench-skin` is now always `theme` or `docked`, never absent, never `none`, and both remaining stylesheets floor the badge the same unconditional way (per the companion plan's #552 fix), the block applies regardless of which is loaded:

```css
  :global(.bench__stage) :global([data-playdeck-part='activation']) {
    grid-area: stack;
    grid-template-areas: 'face';
    place-content: center;
    inline-size: 100%;
    block-size: 100%;
    background-color: transparent;
    border-radius: 0;
    outline-offset: calc(-1 * var(--space-1));
  }

  :global(.bench__stage) :global([data-playdeck-part='activation'])::before {
    content: '';
    grid-area: face;
    inline-size: var(--space-8);
    block-size: var(--space-8);
    background-color: var(--color-surface);
    border-radius: var(--radius-pill);
  }

  :global(.bench__stage)
    :global([data-playdeck-part='activation'] > svg) {
    grid-area: face;
  }
```

Update the comment above it: it currently explains why the rule is scoped to `theme` rather than unconditional (to spare `none`, which had no badge to redraw). `none` is gone, both remaining positions need the redraw, so the comment's reasoning inverts, say so, and say why unscoping it is now safe rather than a regression (both sheets floor the badge unconditionally per #552; there is no third position that would be wrongly caught by a rule with no qualifier left to write).

- [ ] **Step 3: Look at it, then commit**

```bash
pgrep -af "astro.mjs dev" || pnpm --filter @playdeck/site dev
```

Press `docked`, click well away from the badge but inside the frame: playback toggles. Press `theme`, repeat: still works, unchanged from before.

```bash
pnpm typecheck && pnpm lint
git add apps/site/src/components/Bench.astro
git commit -m "Redraw the activation badge under both theme and docked"
```

---

### Task 9: Changed lines are marked

**Files:**
- Modify: `apps/site/src/components/BenchIsland.tsx`
- Modify: `apps/site/src/components/CompositionPanel.tsx`
- Modify: `apps/site/src/components/Bench.astro` (the accent-bar CSS)

- [ ] **Step 1: Write the failing e2e assertion**

```ts
test('a switched line flashes, and the static tree never does', async ({ page }) => {
  await page.goto(landing);
  await position(page, 'source', 'vimeo').click();
  // `.bench-line--flash` is added, force-reflowed, and removed inside one
  // synchronous effect (Step 4 below), so no script running afterward, this
  // poll included, can ever observe the class itself on an element. What
  // survives past that effect is the CSS transition its removal kicks off:
  // with the class gone, the changed line's `::before` is mid-fade from
  // opacity 1 back to 0 over `--duration-slow` (600ms), so this polls the
  // rendered opacity instead of the class, well inside that window.
  await expect
    .poll(() =>
      page.evaluate(() =>
        Array.from(
          document.querySelectorAll('[data-bench-composition] [data-line]')
        ).some((line) => Number(getComputedStyle(line, '::before').opacity) > 0)
      )
    )
    .toBe(true);
});
```

(This asserts the mechanism, not the exact easing curve, a contrast/visual check is out of scope for Playwright and is covered by the arithmetic already recorded in the spec's Verification section.)

- [ ] **Step 2: Run and watch it fail**

```bash
pnpm playwright test e2e/site-bench.spec.ts --project=chromium -g "flashes"
```

- [ ] **Step 3: The CSS, an accent bar, opacity only**

In `Bench.astro`'s `<style>` block, add (near the other `:global()` rules reaching into the island's output):

```css
  /* The changed-line mark: a fixed accent bar, opacity only, per rule 5. Never
   * `border-color`, which this system does not animate. At rest, invisible;
   * `.bench-line--flash` snaps it to visible with no transition, and removing
   * that class lets the declared transition carry it back down on its own. */
  :global([data-bench-composition] [data-line])::before {
    content: '';
    position: absolute;
    inset-block: 0;
    inset-inline-start: 0;
    inline-size: 3px;
    background-color: var(--color-accent);
    opacity: 0;
    transition: opacity var(--duration-slow) var(--ease);
  }

  :global([data-bench-composition] [data-line]) {
    position: relative;
  }

  :global([data-bench-composition] [data-line].bench-line--flash)::before {
    opacity: 1;
    transition: none;
  }
```

`prefers-reduced-motion: reduce` needs no branch here: `base.css`'s site-wide rule already collapses every `transition-duration` to `0.01ms`, and the marked line's settled state is `opacity: 0` either way, so a reduced-motion reader sees the update with no flash.

- [ ] **Step 4: The diff and the flash, in `CompositionPanel.tsx`**

```tsx
import { useEffect, useRef } from 'react';

export type CompositionPanelProps = {
  readonly html: string;
  /** The plain-text lines of the composition just rendered, for the diff. */
  readonly plainLines: readonly string[];
};

export default function CompositionPanel({ html, plainLines }: CompositionPanelProps) {
  const container = useRef<HTMLDivElement>(null);
  const previousLines = useRef(plainLines);

  useEffect(() => {
    const previous = previousLines.current;
    previousLines.current = plainLines;
    if (container.current === null) return;

    const changed: number[] = [];
    const length = Math.max(previous.length, plainLines.length);
    for (let index = 0; index < length; index++) {
      if (previous[index] !== plainLines[index]) changed.push(index + 1);
    }
    if (changed.length === 0) return;

    const elements = changed
      .map((lineNumber) =>
        container.current?.querySelector(`[data-line="${lineNumber}"]`)
      )
      .filter((element): element is Element => element !== null && element !== undefined);
    if (elements.length === 0) return;

    for (const element of elements) element.classList.add('bench-line--flash');
    // Force a layout read so the instant, transition-suppressed opacity:1
    // above is committed before the class is removed, otherwise the browser
    // may coalesce the add/remove into one recalculation and never paint the
    // flash at all.
    void elements[0]?.getBoundingClientRect();
    for (const element of elements) element.classList.remove('bench-line--flash');
  }, [html, plainLines]);

  return <div ref={container} dangerouslySetInnerHTML={{ __html: html }} />;
}
```

- [ ] **Step 5: `BenchIsland.tsx` hands over `plainLines`**

```tsx
<CompositionPanel
  html={html}
  plainLines={buildComposition(position).split('\n')}
/>
```

(`buildComposition` is still imported from Task 6's step 6 note; nothing new to import.)

- [ ] **Step 6: Run, then the full suite, then commit**

```bash
pnpm playwright test e2e/site-bench.spec.ts --project=chromium
pnpm typecheck && pnpm lint
git add apps/site/src/components/BenchIsland.tsx apps/site/src/components/CompositionPanel.tsx apps/site/src/components/Bench.astro e2e/site-bench.spec.ts
git commit -m "Flash the composition panel's changed lines on a press"
```

---

### Task 10: The instruction line, and the status line's promotion

**Files:**
- Modify: `apps/site/src/components/BenchIsland.tsx`
- Modify: `apps/site/src/components/Bench.astro`

- [ ] **Step 1: Write the failing e2e assertion**

```ts
// e2e/site-bench.spec.ts
test('the instruction line reads exactly as written', async ({ page }) => {
  await page.goto(landing);
  await expect(
    page.getByText('Same markup. Two stylesheets. Press one.', { exact: true })
  ).toBeVisible();
});
```

- [ ] **Step 2: Run and watch it fail**

```bash
pnpm playwright test e2e/site-bench.spec.ts --project=chromium -g "instruction line"
```

- [ ] **Step 3: Add the line, first in the switches column**

In `BenchIsland.tsx`, inside `<div className="grid gap-[var(--space-4)]">`, immediately before `<BenchSwitches>`:

```tsx
<div className="grid gap-[var(--space-4)]">
  <p className="bench__instruction">
    Same markup. Two stylesheets. Press one.
  </p>
  <BenchSwitches
    /* … unchanged … */
  />
</div>
```

- [ ] **Step 4: Promote `.bench__quiet`, and share its declarations with `.bench__instruction`**

In `Bench.astro`'s `<style>` block, replace the current `.bench__quiet` rule:

```css
  /* Both are plain sentences set in body prose beside a technical control, not
   * functional machine output any more, `.bench__quiet` moved off the 11px
   * floor because the claim it states is a sentence a reader reads, not a
   * value; `.bench__instruction` was written at this rung from the start
   * because it describes the same kind of thing. `:global()` for the same
   * reason every other selector reaching into the island's output is:
   * neither element is in this file's own template. */
  :global(.bench__quiet),
  :global(.bench__instruction) {
    font-family: var(--font-sans);
    font-size: var(--text-md);
    color: var(--color-ink-muted);
  }
```

- [ ] **Step 5: Drop the licence credit to the fine-print rung**

Same `<style>` block, `.bench__credit`:

```css
  :global(.bench__credit) {
    font-size: var(--text-sm);
    color: var(--color-ink-subtle);
  }
```

(Only the size changes, from `--text-fn` to `--text-sm`; the colour and the Sans family, `.bench__credit` never set Mono, stay.)

- [ ] **Step 6: Run, look at it, commit**

```bash
pnpm playwright test e2e/site-bench.spec.ts --project=chromium
pgrep -af "astro.mjs dev" || pnpm --filter @playdeck/site dev
```

Look: the status line under the frame and the new instruction line above the switches read at the same size, body-weight rather than machine-output; the CC BY credit is visibly smaller than both.

```bash
git add apps/site/src/components/BenchIsland.tsx apps/site/src/components/Bench.astro
git commit -m "Promote the status line to body prose, and add the instruction line above it"
```

---

### Task 11: The close's four cells, and the lede

**Files:**
- Modify: `apps/site/src/pages/index.astro`
- Modify: `e2e/site-landing.spec.ts`

- [ ] **Step 1: Write the failing e2e assertion**

`index.astro` renders both lede sentences inside one `<p class="thesis__lede">`, not two separate elements, the same way its `thesis__display` paragraph already does for `thesis` in this same file (`e2e/site-landing.spec.ts`'s own precedent, `await expect(page.getByText(thesis, { exact: true })).toBeVisible();`, matches on that paragraph's whole text). So `lede` here has to be the paragraph's whole text, both sentences, not the second clause alone; `getByText(..., { exact: true })` finds nothing otherwise, since no element's normalised text equals a substring of its own content.

```ts
// e2e/site-landing.spec.ts
const lede =
  'React primitives and hooks over native video, HLS, YouTube, Vimeo and Wistia. You write the markup, you write the CSS, and one source prop chooses the provider.';

test('the lede and the four figure headlines read as written', async ({ page }) => {
  await page.goto(landing);
  await expect(page.getByText(lede, { exact: true })).toBeVisible();
  for (const headline of ['17 kB', 'One adapter', 'Plays anyway', 'Nothing lies']) {
    await expect(page.getByText(headline, { exact: true })).toBeVisible();
  }
});
```

- [ ] **Step 2: Run and watch it fail**

```bash
pnpm playwright test e2e/site-landing.spec.ts --project=chromium -g "lede and the four"
```

- [ ] **Step 3: Rewrite `figures` in `index.astro`**

```ts
const figures = [
  {
    value: `${primitives.size.toFixed(0)} kB`,
    line: `Every primitive, gzipped. CI fails the build at ${primitives.budget}.`
  },
  {
    value: 'One adapter',
    line: `Adding YouTube costs ${youtube.size.toFixed(0)} kB. The other four never reach your bundle.`
  },
  {
    value: 'Plays anyway',
    line: 'When a browser refuses an audible autoplay, the player retries muted, sets autoplayRecovered, and leaves offering the sound to you.'
  },
  {
    value: 'Nothing lies',
    line: 'Every provider reports what it can honour. A control it cannot renders nothing rather than a button that fails when pressed.'
  }
];
```

Update the doc comment above it: it currently explains why `0` and `Unstyled by default` replaced two even earlier cells. Add a paragraph for this round, quoting the spec's own reasoning (`docs/superpowers/specs/2026-09-02-bench-two-themes-design.md`, section 7, "Why the other two go"): `0` now repeats the promoted status line, and `Unstyled by default` had nothing left to point at once the skin switch's unstyled position was deleted.

- [ ] **Step 4: Rewrite the lede**

```astro
<p class="thesis__lede">
  React primitives and hooks over native video, HLS, YouTube, Vimeo and
  Wistia. You write the markup, you write the CSS, and one source prop
  chooses the provider.
</p>
```

- [ ] **Step 5: Fix the two stale "same six lines" doc comments**

`e2e/site-landing.spec.ts`'s `thesis` constant comment (lines ~41-46): remove the claim that the string "counts the lines the composition panel prints"; the lede no longer states a line count at all, and `thesis` (the display sentence, unchanged) never did. `e2e/site-bench.spec.ts`'s own `jsxBlock` comment and the helper it belonged to are already gone by this point, Task 4 deletes both along with the last `toHaveLength(6)` calls; if anything referencing "the same six lines drive all five" has somehow survived in that file, remove it here.

- [ ] **Step 6: Run, then commit**

```bash
pnpm playwright test e2e/site-landing.spec.ts --project=chromium
pnpm typecheck && pnpm lint
git add apps/site/src/pages/index.astro e2e/site-landing.spec.ts e2e/site-bench.spec.ts
git commit -m "Rewrite the close's four cells and the lede for the real composition"
```

---

### Task 12: Sweep for what is left to delete, and confirm what stays

Mostly verification; Tasks 4, 5 and 8 already deleted the bulk of it. This task closes the remaining items the spec's "What is deleted" section names and confirms the two survivors.

**Files:**
- Modify: `apps/site/src/components/Bench.astro` (if anything remains)
- Modify: `apps/site/src/components/CompositionPanel.tsx` (if anything remains)

- [ ] **Step 1: Confirm `'none'` is gone everywhere**

```bash
rg -n "'none'" apps/site/src apps/site/test e2e/site-bench.spec.ts e2e/site-landing.spec.ts
```

Expected: no hits referring to the skin switch (a stray `'none'` in an unrelated string, if any, is fine and is not this plan's concern).

- [ ] **Step 2: Confirm `CompositionPanel.tsx`'s old highlighting comment is gone**

Task 6 already rewrote the file; confirm no trace of the 72.5 kB measurement comment or the "why this block is not highlighted" header survives:

```bash
grep -n "72.5\|not highlighted" apps/site/src/components/CompositionPanel.tsx
```

Expected: no output.

- [ ] **Step 3: Confirm the two survivors are unchanged**

The badge redraw (rescoped in Task 8, not deleted) and the `<Player.Time>` separator (`<span aria-hidden="true"> / </span>`, now inside `timeDuration`'s composed JSX from Task 3 and its `CONTROL_LINES` entry from Task 4) are both still present and functioning:

```bash
grep -n "aria-hidden=\"true\"" apps/site/src/components/BenchIsland.tsx apps/site/src/bench-composition.ts
```

Expected: one hit in each file.

- [ ] **Step 4: Commit if anything moved**

```bash
git add -A apps/site/src
git status
# Only commit if Step 1-3 above found something to fix.
git commit -m "Sweep the last none-skin traces and confirm the two survivors"
```

If Steps 1-3 found nothing, skip the commit, there is nothing to record.

---

### Task 13: The DESIGN.md amendments

**Note on the count.** The task order this plan was drafted against says "four" amendments; the spec's own "Amendments to DESIGN.md" section lists **five** (the skin switch's paragraphs; the badge-redraw and browser-default paragraphs, which the spec itself calls out as "two references, not one"; the Stances section's animation count; the Code section's account of the panel; and the `<Player.Time>` separator paragraph). This plan follows the spec, which is the approved source of truth, and does five.

**Files:**
- Modify: `apps/site/DESIGN.md`

- [ ] **Step 1: The skin switch's own paragraphs**

Locate the paragraphs beginning "**The bench is two switches and not three…**" and "**`theme` is the resting position, and it was `none` first.**" (currently around `apps/site/DESIGN.md:1933` and `:1943`, in the "The landing page" section, line numbers will have drifted; search for the text). Replace with the spec's own words (`docs/superpowers/specs/2026-09-02-bench-two-themes-design.md`, "Amendments to DESIGN.md" section 1):

> skin is `theme` and `docked`, both authored stylesheets, and the switch's argument is no longer unstyled-versus-styled but two ways of laying the same controls out, an overlay that hides itself, and a bar that never moves. `theme` rests above 48rem for the same reason it always has (a first impression should not read as broken); `docked` rests below it because the floating theme was already going to collapse into close to that shape at that width, on a coarse pointer, what a narrow viewport almost always is; on a fine pointer the two positions still differ by one control, `VolumeSlider`, but not enough to be an argument for offering the choice, so the switch is hidden rather than shown offering it.

Fold in one sentence about `--stage-hairline` (Task 7) and the `matchMedia` initializer (Task 5, step 5), since the spec's Amendment 1 covers the switch's argument but the raw mechanics belong in this same paragraph's neighbourhood if the surrounding prose names them; check the surrounding text and add only if something now stale references `none` reading no CSS.

- [ ] **Step 2: The badge-redraw and browser-default paragraphs**

Two references (`apps/site/DESIGN.md`, around the "whole picture is the target" paragraph and the "one column and not two" seek-thumb section, currently near lines 2309 and 2453/2500, search for "the whole picture is the target" and "that rule is scoped to \`\[data-bench-skin='none'\]\`"). Replace per the spec's Amendment 2:

> "`Bench.astro` writes one rule that changes how a part looks, and it is a browser defect rather than a skin" becomes false once the companion spec ships: #555 is fixed in the library, and the `[data-bench-skin='none']` workaround it names is gone from `Bench.astro` along with `none` itself. "The other half of the same defect, on the other skin, issue #552, filed against the library rather than fixed there" is revised rather than retracted: the library keeps the activation rule's selector exactly as it was, `[data-playdeck-part='activation']`, unscoped and with no `:has()` anywhere, and only floors its size instead of fixing it, `min-inline-size`/`min-block-size: var(--playdeck-activation-size, 4rem)` with `box-sizing: border-box` and `border-radius: 2rem`. The bench's `Player.ActivationButton` still renders only an icon (`<Player.PlayIcon />`), with no content to push the floor open, so the rule still matches it under both remaining skins the same way it always has. The badge-redraw block in `Bench.astro` therefore still overrides it, full-bleed and transparent with the badge repainted by a `::before`, so the whole picture stays a press target rather than only the 4rem badge. What moves is which selector the block is scoped under, following whichever skin is loaded, not whether it exists.

Also fix the "That rule is scoped to `[data-bench-skin='none']`" paragraph (the second reference) to describe the deletion of that rule and Task 8's rescoping, in the document's own voice, the spec text above covers the argument; adapt the surrounding sentence that names the specific selector history to match what Task 5/8 actually shipped.

- [ ] **Step 3: Stances, the animation count**

Locate "**This app authors no animation at all, as of that cut.**" (currently `apps/site/DESIGN.md:1217`, in the Stances section). Replace per the spec's Amendment 3:

> Restated for the second time. The count becomes one: the changed-line accent fade in point 6 above, `opacity` only, keyed off a `data-line` attribute Shiki writes at build time, the same shape the retired `bench-refusal` keyframe used `data-live` for. It needs no `prefers-reduced-motion` branch of its own, for the reason the deleted animation's own paragraph already argued in general.

Adjust the surrounding bullet list (the three constraints kept "as a record of what any animation this app writes has always had to satisfy") so it now describes the one running animation rather than a hypothetical future one, the constraints themselves (resting state from CSS, `prefers-reduced-motion` removes rather than shortens, no scroll-linked effects) stay true and stay written, just no longer framed as "should one be written again."

- [ ] **Step 4: The Code section's account of the panel**

Locate "**`/`'s composition panel is not highlighted, and it is the one block on this site that is not.**" (`apps/site/DESIGN.md`, "Code, and the one exception to rule 1" section, around line 552). Replace per the spec's Amendment 4:

> Every code block on this site is now highlighted by Shiki with the same `shikiConfig`, including the bench's, which differs from the others only in running four times at build for four states an island picks between, rather than once.

Remove the 72.5 kB / `createHighlighterCore` measurement paragraph that followed it, it answered a question ("what would client-side highlighting cost here") that no longer applies, since highlighting now runs at build. Keep the earlier paragraph about the five colour-fix overrides in `src/shiki.ts` untouched; that exception is unrelated to this one.

- [ ] **Step 5: The `<Player.Time>` separator paragraph**

Locate "**One thing did have to change in the composition rather than in the default.**" (`apps/site/DESIGN.md`, around line 1957). Replace per the spec's Amendment 5:

> both `theme` and `docked` need a separator supplied as a child between the two `Time`s, the same `<span aria-hidden="true"> / </span>` `BenchIsland.tsx` already renders, and `none`'s absence is no longer why this document keeps it.

Keep the sentence explaining `Player.Time` renders a bare `<time>` regardless of skin (that fact is unchanged); only the framing around `none` changes.

- [ ] **Step 6: Check formatting and commit**

```bash
pnpm prettier --check apps/site/DESIGN.md
git add apps/site/DESIGN.md
git commit -m "Amend DESIGN.md for theme and docked, the highlighted panel, and one animation"
```

---

### Task 14: The gate

- [ ] **Step 1: Run everything**

```bash
pnpm typecheck
pnpm lint
pnpm test
pnpm build
pnpm test:site-links
pnpm test:deploy
pnpm test:budgets
pnpm test:e2e
```

(`pnpm test` is `vitest run --passWithNoTests`, matching this repository's own script name rather than the generic `pnpm vitest run` used in earlier tasks; `pnpm test:e2e` is `playwright test`, which already excludes `@real`-tagged tests by default via `playwright.config.ts`'s `grepInvert`. `pnpm test:budgets` is named in the spec's own Verification section as affected by the companion plan's `docked.css` budget target, which this document assumes has landed by Task 14.)

`webkit` cannot launch on this machine (repository-wide note, not specific to this branch). Run chromium and firefox locally; CI carries webkit.

- [ ] **Step 2: Re-run any single failure alone before believing it**

One test fails per full parallel run, a different one each time, and passes in isolation, documented CPU contention this repository already absorbs with `retries: 2` on CI. Do not chase it as a defect in this work.

- [ ] **Step 3: Measure the astro-island props payload**

The spec's own instruction (section 3, "Zero client-side highlighting bytes"): measure the size of the four highlighted strings as they appear in `BenchIsland`'s serialised `astro-island` `props` attribute, gzipped, and record the figure in the PR description. No budget is set for it; this is a measurement, not a gate.

```bash
pnpm build
node -e "
const fs = require('fs');
const zlib = require('zlib');
const html = fs.readFileSync('apps/site/dist/index.html', 'utf8');
const match = html.match(/<astro-island[^>]*component-export=\"default\"[^>]*props=\"([^\"]*)\"/);
if (!match) throw new Error('astro-island props attribute not found');
const decoded = match[1].replace(/&quot;/g, '\"').replace(/&amp;/g, '&');
console.log('raw bytes:', Buffer.byteLength(decoded));
console.log('gzip bytes:', zlib.gzipSync(decoded).length);
"
```

Adjust the regex if the built markup names the component export differently, inspect `apps/site/dist/index.html` by hand first if the one-liner does not match.

- [ ] **Step 4: Look at the built page**

```bash
pnpm --filter @playdeck/site preview
```

Visit the printed local URL. Press every switch position (both skins, both sources). Confirm: the control bar shows all ten controls under both `theme` and `docked`; the panel is coloured and flashes the changed line on a press; the skin fieldset disappears below 48rem; the close reads `17 kB`, `One adapter`, `Plays anyway`, `Nothing lies`; the licence credit is visibly smaller than the status line above it.

Nothing ships until the maintainer has seen this running, do not open a PR from this step alone.

- [ ] **Step 5: Show the maintainer before pushing**

Per the spec's own header: "Nothing ships until the maintainer has seen the page running." Confirm the branch, confirm nothing was pushed without asking, and stop here for review.
