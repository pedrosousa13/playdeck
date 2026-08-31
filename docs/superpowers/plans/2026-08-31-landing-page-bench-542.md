# The landing page as a bench (#542) implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace `/` with a single instrument. One player as the largest thing on the page, three groups of switches under it, and the composition those switches build printed beside them.

**Architecture:** One Astro page holds the layout and the copy. One React island holds everything that moves, because `Player.Root` renders no DOM of its own and one root can therefore stand above the player, the switches and the code panel at once, which is what lets the reason line report the same controller the player is driven by. Pure logic (the generated snippet, the capability wording, the source table) lives in plain TypeScript modules next to the island so it can be unit tested without a browser.

**Tech Stack:** Astro 5, React 19, `@playdeck/react` primitives, Shiki for highlighting, Vitest for units, Playwright for e2e.

**Spec:** `docs/superpowers/specs/2026-08-31-landing-page-bench-542-design.md`. Read it before starting. Every ruling in it has been approved by the maintainer and is not yours to revisit.

---

## Before you start

Five rebuilds of this page have been rejected. Four things are load-bearing and a
reviewer will check each one:

1. **The page makes no claim about any other library.** No comparison, named or
   implied. This was ruled on explicitly.
2. **The word "ledger" never appears.** The maintainer rejected the phrase.
3. **There is no capability table of any kind.** A grid was designed and cut, and
   the five-row browser panel on the page today is being deleted. The maintainer's
   words were "doesn't fit at all". Do not reinvent either, in any size.
4. **`DESIGN.md` rules 1 to 5 still hold.** No component writes a colour, a font
   size or a duration. Only `transform` and `opacity` animate. Four audit
   constraints pass today and must still pass.

Two traps from the previous session, both real:

- **The suite fails one test per full parallel run, a different one each time,
  and each passes in isolation.** This is CPU contention that `playwright.config.ts`
  documents and absorbs with `retries: 2` on CI. Local retries are 0. Re-run the
  named spec alone before believing it.
- **`pnpm format:check` fails on three files git cannot see**, excluded via
  `.git/info/exclude`. Not yours. Every tracked file is formatted.

`webkit` cannot launch on this machine. Run chromium and firefox; CI has webkit.

---

## File structure

**Created**

| File | Responsibility |
| --- | --- |
| `apps/site/src/bench-sources.ts` | The five sources, and which are ready to demonstrate |
| `apps/site/src/bench-capabilities.ts` | Capability keys mapped to the words the reason line prints |
| `apps/site/src/bench-composition.ts` | Pure: three switch positions in, the JSX snippet out |
| `apps/site/src/components/Bench.astro` | Mounts the island, owns the player theme and the frame |
| `apps/site/src/components/BenchIsland.tsx` | `Player.Root`, the player, and the layout the three panels sit in |
| `apps/site/src/components/BenchSwitches.tsx` | The three switch groups |
| `apps/site/src/components/ReasonLine.tsx` | One line of what the mounted provider refused, when it refused one |
| `apps/site/src/components/CompositionPanel.tsx` | The generated snippet, highlighted |
| `apps/site/public/hls/**` | A same-origin HLS fixture, copied from the workbench |
| `e2e/site-bench.spec.ts` | The reason line's behaviour, and the panel tracking the switches |
| `e2e/site-quiet.spec.ts` | Nothing leaves this origin before an interaction, and something does after |
| `apps/site/test/bench-composition.test.ts` | Units for the snippet builder |

**Modified**

| File | Change |
| --- | --- |
| `apps/site/src/pages/index.astro` | Rewritten. Thesis, star, bench, readout, close |
| `apps/site/DESIGN.md` | The four approved amendments, and the "Where things live" table |
| `e2e/site-landing.spec.ts` | Rewritten for the new spine |

**Deleted**

| File | Why |
| --- | --- |
| `apps/site/src/components/HeroPlayer.astro` | Replaced by `Bench.astro` |
| `apps/site/src/components/HeroPlayerIsland.tsx` | Replaced by `BenchIsland.tsx` and its neighbours |
| `e2e/site-ledger.spec.ts` | Replaced by `site-bench.spec.ts` |

`ProviderTruth.astro` and `e2e/site-provider-truth.spec.ts` are **not** touched by
this plan. With no grid on `/`, nothing this work builds overlaps them, and the
question of whether they still earn their place is somebody else's.

---

### Task 1: The DESIGN.md amendments (DONE, commit `c1eb70e`)

**One correction is owed and Task 10 carries it.** Step 4 below was written when
the readout still had a grid, so the second animation it records is "a grid
column resolving". The second animation is now the reason line arriving: same
vocabulary, `opacity` and a `--space-1` rise at `--duration-base`, keyed off
`data-live`, but one line rather than a column, so there is no sequence, no
delays and no `prefers-reduced-motion` hazard to write around. Fix the wording in
Task 10, not by amending `c1eb70e`.

Docs only. Do this first, so the rules the rest of the work obeys are written
down before any code leans on them.

**Files:**
- Modify: `apps/site/DESIGN.md`

- [ ] **Step 1: Amend the type section for the display rung**

Find the paragraph beginning "**The display rung is what the `argument` stance
spends**". The rung now belongs to the thesis paragraph, not the `h1`. Add:

> **On `/` the display rung sets a paragraph, not the heading.** A build gate
> requires that page's `h1` to read exactly `Playdeck`, and `Playdeck` is the
> document's name rather than its argument. So the `h1` takes `--text-lg` in
> `--color-ink-muted` and the thesis under it takes `--text-4xl` above `48rem`,
> stepping down to `--text-3xl` below it. The rung follows what the page is
> arguing, which is the reason the rung exists. Every other page still takes
> whatever `base.css` gives its heading elements.

- [ ] **Step 2: Amend the third-party claim**

Find "The served page makes **no third-party request of any kind**" in the Type
section. That sentence is about fonts and it stays true of fonts. Add after it:

> **The bench on `/` is the one place this site reaches a third party, and it
> reaches one only because a reader asked.** Pressing `youtube`, `vimeo` or
> `wistia` on the source switch loads that provider. Nothing is contacted before
> that press, which is the claim worth defending and the one the library makes:
> `e2e/site-quiet.spec.ts` records every request the page makes at rest and
> fails if any leaves this origin, then presses a hosted provider and fails if
> none does. The fonts keep the absolute guarantee above, because nobody asks
> for a font.

- [ ] **Step 3: Move the instrument elevation**

In the "What may spend an elevation, by name" paragraph, replace the sentence
giving `--elevation-instrument` to the capability ledger. It now reads:

> `--elevation-instrument` belongs to the player on `/` and to nothing else. It
> is the panel that page is built around, and a second instrument on one page
> means neither is the instrument. The grid and the composition panel beside it
> are steps on the surface ladder with a hairline, like everything else.

Remove `.demo__bezel` from the `--elevation-panel` list if `Bench.astro` no
longer draws a bezel, and leave it if it does. Decide when you write Task 6, and
make the document agree with the code.

- [ ] **Step 4: Restate the animation count**

Find "**This app writes three animations, and all three are on `/`.**" The count
is two. The `.truth-card` entry motion and the ledger resolution both belonged to
elements this work deletes.

> **This app writes two animations, and both are on `/`.** The first is the
> sweep band, which travels in from the left once on arrival, unchanged in kind
> from the version that sat above the heading and now drawn along the bottom
> edge of the player's frame. The second is a grid column resolving: the moment a
> provider attaches and answers, that column's cells settle in sequence, `opacity`
> and a `--space-1` rise, `--duration-base`, delays in steps of `--duration-fast`.
> It is keyed off a `data-live` attribute the island writes in the same React
> commit that writes the answers, so the motion marks a real state change and
> cannot dress a simulated one. Under `prefers-reduced-motion` it is removed
> outright, for the reason the previous resolution animation was: the duration
> collapse shortens durations and not delays, and a delayed `both`-filled cell
> would sit invisible through its delay.

Rule 5 is untouched. Say so, so a later reader does not go looking.

- [ ] **Step 5: Record that scroll-linked effects are still banned**

One sentence in the entry motion section, so nobody reads an interactive page as
reopening the question:

> The bench on `/` is driven by pointer and keyboard and never by scroll offset.
> An interactive page does not reopen this.

- [ ] **Step 6: Check formatting and commit**

```bash
pnpm prettier --check apps/site/DESIGN.md
git add apps/site/DESIGN.md
git commit -m "Amend DESIGN.md for the bench: the display rung, the third-party claim, the instrument, and the count"
```

---

### Task 2: The snippet builder

A pure function. Three switch positions in, the code the readout prints out. It
has no React and no DOM in it, so it is the one part of the bench that is cheap
to test exhaustively.

**Files:**
- Create: `apps/site/src/bench-composition.ts`
- Test: `apps/site/test/bench-composition.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, expect, it } from 'vitest';
import { buildComposition } from '../src/bench-composition';

describe('buildComposition', () => {
  it('prints the smallest composition when nothing is switched', () => {
    expect(buildComposition({ source: 'native', skin: 'none', autoplay: false }))
      .toBe(
        [
          '<Player.Root source={source}>',
          '  <Player.Viewport>',
          '    <Player.Media />',
          '    <Player.Controls />',
          '  </Player.Viewport>',
          '</Player.Root>'
        ].join('\n')
      );
  });

  it('names the provider the source switch chose', () => {
    const code = buildComposition({ source: 'youtube', skin: 'none', autoplay: false });
    expect(code).toContain('source={youtube}');
  });

  it('adds the autoplay prop only when autoplay is on', () => {
    const off = buildComposition({ source: 'native', skin: 'none', autoplay: false });
    expect(off).not.toContain('autoplay');

    const on = buildComposition({ source: 'native', skin: 'none', autoplay: 'audible-then-muted' });
    expect(on).toContain('autoplay="audible-then-muted"');
  });

  it('adds the theme import only when the theme skin is chosen', () => {
    const bare = buildComposition({ source: 'native', skin: 'none', autoplay: false });
    expect(bare).not.toContain('theme.css');

    const themed = buildComposition({ source: 'native', skin: 'theme', autoplay: false });
    expect(themed.split('\n')[0]).toBe("import '@playdeck/react/theme.css';");
    // The import is a line above the composition, with a blank line after it,
    // because that is how a consumer's file would actually read.
    expect(themed.split('\n')[1]).toBe('');
  });

  it('never leaves a trailing space on a line', () => {
    const code = buildComposition({ source: 'vimeo', skin: 'theme', autoplay: 'audible-then-muted' });
    for (const line of code.split('\n')) expect(line).toBe(line.trimEnd());
  });
});
```

The last test is not decoration. The snippet goes through Shiki, and a trailing
space renders as a highlighted empty span.

- [ ] **Step 2: Run the tests and watch them fail**

```bash
pnpm vitest run apps/site/test/bench-composition.test.ts
```

Expected: every test fails, `Cannot find module '../src/bench-composition'`.

- [ ] **Step 3: Write the module**

```ts
/*
 * The composition the three switches on `/` describe, as the source a reader
 * would write to get the player above it.
 *
 * A pure function rather than four hand-written snippets, because the panel's
 * whole argument is that the knobs are compositions and not options. Four fixed
 * strings would be four claims about what the switches do; this is the thing
 * they do.
 */
import type { AutoplayMode, PlayerProvider } from '@playdeck/core';

export type SkinName = 'none' | 'theme';

export type BenchPosition = {
  readonly source: PlayerProvider;
  readonly skin: SkinName;
  readonly autoplay: AutoplayMode;
};

export const buildComposition = ({ source, skin, autoplay }: BenchPosition): string => {
  const rootProps = [`source={${source}}`];
  if (autoplay !== false) rootProps.push(`autoplay="${autoplay}"`);

  // The theme is an import a consumer either writes or does not. It is not a
  // prop, and dressing it as one would misrepresent how the library ships.
  const preamble = skin === 'theme' ? ["import '@playdeck/react/theme.css';", ''] : [];

  // One prop stays on the opening line; two or more take a line each, which is
  // how a reader would have written it and how prettier would leave it.
  const open =
    rootProps.length === 1
      ? `<Player.Root ${rootProps[0]}>`
      : ['<Player.Root', ...rootProps.map((prop) => `  ${prop}`), '>'].join('\n');

  return [
    ...preamble,
    open,
    '  <Player.Viewport>',
    '    <Player.Media />',
    '    <Player.Controls />',
    '  </Player.Viewport>',
    '</Player.Root>'
  ].join('\n');
};
```

- [ ] **Step 4: Run the tests and watch them pass**

```bash
pnpm vitest run apps/site/test/bench-composition.test.ts
```

Expected: 5 passed.

If you changed the shape of the output, change the thesis paragraph's "the same
six lines drive all five" in the spec to match the real line count, or take the
number out of the sentence. The spec says so explicitly.

- [ ] **Step 5: Commit**

```bash
git add apps/site/src/bench-composition.ts apps/site/test/bench-composition.test.ts
git commit -m "Build the bench's composition from its switch positions"
```

---

### Task 3: The sources, and which of them are ready

Three of the five providers need a clip the project is entitled to embed, and
those uploads are the maintainer's to make. Nothing else in this work waits on
them: the module carries a `ready` flag per provider, the switch renders the ready
ones, and three booleans flip when the ids arrive.

**Files:**
- Create: `apps/site/src/bench-sources.ts`
- Create: `apps/site/public/hls/**` (copied)

- [ ] **Step 1: Copy the HLS fixture so `hls` is same-origin**

```bash
cp -r apps/storybook/public/hls apps/site/public/hls
ls apps/site/public/hls
```

Expected: `master.m3u8`, `v0/`, `v1/`, and whatever else the workbench serves.
This matters because `native` and `hls` are the two providers the bench can
demonstrate without contacting anybody, so they are what every test drives.

- [ ] **Step 2: Write the module**

```ts
/*
 * What each position of the source switch on `/` plays.
 *
 * `native` and `hls` are served by this site, so the bench can demonstrate two
 * providers without contacting anyone. The other three are hosted, and each
 * needs a clip this project is entitled to embed on a marketing page. Until
 * those exist, `ready: false` keeps the button off the switch rather than on it
 * and broken. Turning one on is this file's three-character change.
 *
 * The two local addresses resolve against `import.meta.env.BASE_URL`, the way
 * every address on this site does, because `astro build --base` has to keep
 * working (#435).
 */
import type { PlayerProvider } from '@playdeck/core';

export type BenchSource = {
  readonly provider: PlayerProvider;
  /** What the switch prints on the button. */
  readonly label: string;
  /** False while this provider has no clip we may embed. */
  readonly ready: boolean;
  /** Resolved at call time, because BASE_URL is only known there. */
  readonly source: (baseUrl: string) => string;
};

export const benchSources: readonly BenchSource[] = [
  {
    provider: 'native',
    label: 'native',
    ready: true,
    source: (baseUrl) => `${baseUrl}tracer.mp4`
  },
  {
    provider: 'hls',
    label: 'hls',
    ready: true,
    source: (baseUrl) => `${baseUrl}hls/master.m3u8`
  },
  // The three below wait on an upload. See the spec's "The media each provider
  // plays": one Blender CC BY film goes on this project's own YouTube, Vimeo
  // and Wistia accounts, so all five providers play the identical asset and the
  // reason line reports a fact about the provider rather than about its clip.
  // Replace the id and set `ready`.
  {
    provider: 'youtube',
    label: 'youtube',
    ready: false,
    source: () => 'https://www.youtube.com/watch?v=REPLACE_ME'
  },
  {
    provider: 'vimeo',
    label: 'vimeo',
    ready: false,
    source: () => 'https://vimeo.com/REPLACE_ME'
  },
  {
    provider: 'wistia',
    label: 'wistia',
    ready: false,
    source: () => 'https://fast.wistia.net/embed/iframe/REPLACE_ME'
  }
];

export const readySources = benchSources.filter((entry) => entry.ready);
```

- [ ] **Step 3: Check it typechecks**

```bash
pnpm typecheck
```

Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add apps/site/src/bench-sources.ts apps/site/public/hls
git commit -m "Give the bench two same-origin providers, and a place for the three that need a clip"
```

---

### Task 4: The words the reason line prints

**Files:**
- Create: `apps/site/src/bench-capabilities.ts`
- Test: `apps/site/test/bench-capabilities.test.ts`

The reason line says one thing: which capability the mounted provider refused,
and why. Both halves need English. `PlayerCapabilities` gives keys like
`pictureInPicture` and `Availability` gives reasons like `provider-build`, and
neither is a phrase you put on a marketing page.

- [ ] **Step 1: Write the module**

```ts
/*
 * The English the reason line on `/` prints, for both halves of what it says.
 *
 * Every key of `PlayerCapabilities` and every `Availability` reason, written out
 * rather than derived, so a capability or a reason added to the library fails
 * the test below instead of reaching the landing page as a raw identifier.
 *
 * The wording is deliberately plain and deliberately not a euphemism. The point
 * of the line is that the library admits a refusal, so "no picture in picture"
 * is right and "picture in picture unavailable" is the same sentence wearing a
 * tie.
 */
export const capabilityWords = {
  seek: 'seeking',
  setVolume: 'volume control',
  setPlaybackRate: 'playback speed',
  selectQuality: 'quality selection',
  selectTextTrack: 'text track selection',
  chapters: 'chapters',
  fullscreen: 'fullscreen',
  pictureInPicture: 'picture in picture',
  airPlay: 'airplay',
  customControls: 'custom controls'
} as const;

export const reasonWords = {
  browser: 'this browser cannot do it',
  provider: 'the provider cannot do it',
  'provider-plan': "the plan behind the video does not include it",
  'provider-build': 'the build of the third-party runtime does not carry it',
  source: 'this video does not offer it',
  policy: 'a browser policy refused it'
} as const;
```

Only the six `unavailable` reasons get words. The two `unknown` reasons,
`not-ready` and `provider-check`, never reach the line: the line appears only
when a provider has answered and the answer was no. An unknown is not a refusal
and printing it would be the grey placeholder the spec rules out.

- [ ] **Step 2: Write the test that catches a library change**

```ts
import type { Availability, PlayerCapabilities } from '@playdeck/core';
import { capabilityWords, reasonWords } from '../src/bench-capabilities';

it('has words for every capability the library publishes', () => {
  const expected: (keyof PlayerCapabilities)[] = [
    'seek', 'setVolume', 'setPlaybackRate', 'selectQuality', 'selectTextTrack',
    'chapters', 'fullscreen', 'pictureInPicture', 'airPlay', 'customControls'
  ];
  expect(Object.keys(capabilityWords).sort()).toEqual([...expected].sort());
});

it('has words for every reason a refusal can carry', () => {
  const expected = [
    'browser', 'provider', 'provider-plan', 'provider-build', 'source', 'policy'
  ];
  expect(Object.keys(reasonWords).sort()).toEqual(expected.sort());
});
```

Write both lists out by hand rather than deriving them from the module under
test. A list derived from the thing it checks agrees with it whatever either of
them says, which is the reasoning `e2e/site-ledger.spec.ts` already gives for
writing its own row names out.

- [ ] **Step 3: Run and commit**

```bash
pnpm vitest run apps/site/test/
git add apps/site/src/bench-capabilities.ts apps/site/test/bench-capabilities.test.ts
git commit -m "Give the reason line its English, and fail when the library adds a word it lacks"
```

---

### Task 5: The switches, the reason line, and the panel

Three presentational components. Each takes what it renders as props and holds no
player state of its own, so the island in Task 6 is the only thing that reads a
snapshot.

**Files:**
- Create: `apps/site/src/components/BenchSwitches.tsx`
- Create: `apps/site/src/components/ReasonLine.tsx`
- Create: `apps/site/src/components/CompositionPanel.tsx`

- [ ] **Step 1: Write `BenchSwitches.tsx`**

Three groups. Each is a `<fieldset>` with a `<legend>`, holding buttons with
`aria-pressed`, one pressed per group.

Contract the e2e specs depend on. Do not rename any of these:

- Group root carries `data-bench-switch="source" | "skin" | "autoplay"`.
- Each button carries `data-value` with the position it selects.

Source renders `readySources` only, so a provider whose clip does not exist yet
gets no button rather than a broken one. Skin is `none` and `theme`. Autoplay is
`off` and `audible-then-muted`.

The legends are `SOURCE`, `SKIN` and `AUTOPLAY`, set in mono at `--text-fn`,
which is 11px and the floor. They are tracked caps and they sit below the `h1` on
controls, so they are labels rather than the eyebrow chip the audit bans. Do not
set them below the floor, and do not move one above the `h1`.

- [ ] **Step 2: Write `ReasonLine.tsx`**

One line of functional text under the switches, and the smallest component in
this task. Read the spec's "One line of what the provider refused" before you
write it; it has three rules and all three are easy to break by being helpful.

- Root carries `data-bench-reason` and `data-live`.
- **It renders `null` when there is nothing to report.** No wrapper, no empty
  element, no reserved height. A layout that holds space for it is the grey
  placeholder the spec rules out.
- It reports only the mounted provider, and only capabilities whose status is
  `unavailable`. An `unknown` is not a refusal.
- Its words come from `capabilityWords` and `reasonWords` in
  `bench-capabilities.ts`. It never writes English of its own and never reads
  `src/provider-asymmetry.mjs`.

Shape, with the provider name and the two phrases filled in:

```
youtube · no picture in picture
└ the provider's iframe cannot be promoted
```

If the mounted provider refuses more than one capability, print the first in
`capabilityWords` order and no others. One line means one line. A list is the
table this design deleted, growing back.

- [ ] **Step 3: Write `CompositionPanel.tsx`**

Takes the string from `buildComposition` and renders it highlighted, in a
`--color-sunken` well, with `data-bench-composition` on the root.

Shiki's Astro `<Code>` component is server-only and this panel re-renders on every
switch, so highlight on the client with the same two theme names from
`src/shiki.ts`. Keep `defaultColor: false` for the reason `DESIGN.md` gives: it
leaves both themes as custom properties instead of writing one into a `color:`
declaration a stylesheet could then only reach past with `!important`.

If client-side Shiki costs more than the panel is worth, the fallback is a plain
`<pre>` in `--color-ink` with no highlighting, and `DESIGN.md`'s code section
gets a sentence saying `/` no longer highlights. Measure before choosing. Do not
ship a second highlighter.

- [ ] **Step 4: Typecheck and commit**

```bash
pnpm typecheck && pnpm lint
git add apps/site/src/components/BenchSwitches.tsx apps/site/src/components/ReasonLine.tsx apps/site/src/components/CompositionPanel.tsx
git commit -m "Draw the bench's switches, its reason line and its composition panel"
```

---

### Task 6: The island, and the page

**Files:**
- Create: `apps/site/src/components/BenchIsland.tsx`
- Create: `apps/site/src/components/Bench.astro`
- Modify: `apps/site/src/pages/index.astro`
- Delete: `apps/site/src/components/HeroPlayer.astro`, `apps/site/src/components/HeroPlayerIsland.tsx`

- [ ] **Step 1: Write `BenchIsland.tsx`**

One `Player.Root` above the player, the switches, the reason line and the panel.
`Player.Root` renders no DOM, so a single root can stand above all of them and
the reason line reads the same controller the player is driven by. That is what
makes it a report rather than a caption. Do not give it a controller of its own.

State the island holds, and nothing more:

```ts
const [position, setPosition] = useState<BenchPosition>({
  source: 'native',
  skin: 'none',
  autoplay: false
});
// No accumulated state. The reason line speaks only about the provider that is
// mounted right now, so it is derived from the live snapshot and nothing is
// remembered about a provider the reader has moved on from.
```

Three things to get right:

- **`loading="interaction"` stays, and the island stays `client:only`.**
  `HeroPlayer.astro` carries the reasoning; move that comment to `Bench.astro`
  rather than dropping it. A `client:only` island means a reader whose script
  fails gets a settled page instead of a blank one.
- **Changing `source` is a prop change, not a remount.** `Root` already handles
  source transitions internally through `sourceKey`. Do not add a `key`.
- **Changing `autoplay` is a remount.** `Root` captures the autoplay
  configuration in a ref at activation, so a live change does not re-attempt.
  Put a `key` on `Root` that includes the autoplay position, and only that.
- **Write the answers and `data-live` in the same commit.** The resolution
  animation must mark a real state change, never dress a simulated one. Read the
  snapshot with one `Player.usePlayerState` selector, the way `ControlBar` in the
  file you are deleting does, so the island wakes on capability changes and not
  on every time update.

- [ ] **Step 2: Write `Bench.astro`**

Owns the player theme and the frame around the picture, the way `HeroPlayer.astro`
did. The frame takes `--elevation-instrument`, which Task 1 moved here. It takes
no border, because rule 4 forbids an elevated surface one and that prohibition is
what keeps the banned pairing unassemblable.

The sweep goes here, in its `accent` form, as the band along the bottom edge of
the frame. **Once on the page.** `DESIGN.md` records that six sweeps down one page
is the exact creep the one-gradient rule exists to stop, so if you find yourself
adding a second, do not.

- [ ] **Step 3: Rewrite `index.astro`**

Five parts, in order: thesis, star, bench, readout, close. The exact copy is in
the spec and is approved. Do not improve it.

The `h1` is `Playdeck` at `--text-lg` in `--color-ink-muted`, because
`scripts/check-deploy-artifact.mjs` finds this site's root document by a heading
with exactly that text and `e2e/site-nav.spec.ts` pins it as the only one. The
thesis is a `<p>` at `--text-4xl` above `48rem` and `--text-3xl` below.

The close reads its two package figures from `measureBundles` at build time, the
way the page you are replacing already does. **The `17 kB` figure is never
typed.** The other three (`1 of 5`, `0`, `0 lines`) are facts about the shape of
the packages, not measurements, and may be written.

- [ ] **Step 4: Delete what it replaces**

```bash
git rm apps/site/src/components/HeroPlayer.astro apps/site/src/components/HeroPlayerIsland.tsx
```

- [ ] **Step 5: Look at it**

```bash
pgrep -af "astro.mjs dev" || pnpm --filter @playdeck/site dev
```

A dev server leaks on this machine. Check before starting one. There may already
be one on `:4321` with `--host`, running for the maintainer.

Press each switch. At rest there should be no reason line in the DOM at all,
and the layout should not move when one appears.

- [ ] **Step 6: Commit**

```bash
pnpm typecheck && pnpm lint
git add -A apps/site/src
git commit -m "Rebuild / as a bench: one player, three switches, and what the provider answered"
```

---

### Task 7: Prove the page is quiet until it is asked

The page's central claim, and the one thing on it a screenshot cannot check.

**Files:**
- Create: `e2e/site-quiet.spec.ts`

- [ ] **Step 1: Write the failing test**

Model it on `e2e/site-search.spec.ts`, which already records requests and asserts
none leaves the origin. The site is served by the second `webServer` entry in
`playwright.config.ts` at `http://127.0.0.1:4322/`; the storybook entry owns
`baseURL`, so write the address out.

```ts
test('contacts nobody before a reader asks', async ({ page }) => {
  const foreign: string[] = [];
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (url.origin !== 'http://127.0.0.1:4322') foreign.push(request.url());
  });

  await page.goto('http://127.0.0.1:4322/');
  await page.waitForLoadState('networkidle');

  expect(foreign).toEqual([]);
});
```

An empty list is only evidence if the listener works, so the second test presses a
provider and asserts a request does happen. **Skip it while every hosted provider
is `ready: false`**, with `test.skip` naming why, so it starts passing on its own
the day the ids land rather than being remembered:

```ts
const hosted = benchSources.filter((entry) => entry.ready && entry.provider !== 'native' && entry.provider !== 'hls');

test('contacts the provider once a reader presses one', async ({ page }) => {
  test.skip(hosted.length === 0, 'No hosted provider has a clip we may embed yet. See bench-sources.ts.');
  // ... press the button, expect a foreign request
});
```

- [ ] **Step 2: Run it and watch it fail**

The page does not exist in its new shape yet if you are running out of order.
Expected once Task 6 is in: PASS on the first, SKIP on the second.

```bash
pnpm playwright test e2e/site-quiet.spec.ts --project=chromium
```

- [ ] **Step 3: Commit**

```bash
git add e2e/site-quiet.spec.ts
git commit -m "Record that / contacts nobody until a reader presses a provider"
```

---

### Task 8: Prove the reason line reports rather than illustrates

**Files:**
- Create: `e2e/site-bench.spec.ts`
- Delete: `e2e/site-ledger.spec.ts`

Read `e2e/site-ledger.spec.ts` before you write this, then delete it. It makes
exactly the right argument and the argument outlives the panel it was written
for: a readout of plausible-looking claims looks identical to a reader and to a
screenshot, so what a test pins is the one thing a static readout could not do,
which is change.

- [ ] **Step 1: Write the tests**

```ts
test('nothing holds space for a reason before one exists', async ({ page }) => {
  await page.goto('http://127.0.0.1:4322/');
  await expect(page.locator('[data-bench-reason]')).toHaveCount(0);
});

test('the composition tracks the switches', async ({ page }) => {
  await page.goto('http://127.0.0.1:4322/');
  const panel = page.locator('[data-bench-composition]');
  await expect(panel).not.toContainText('autoplay');
  await expect(panel).not.toContainText('theme.css');

  await page.locator('[data-bench-switch="autoplay"] [data-value="audible-then-muted"]').click();
  await expect(panel).toContainText('autoplay="audible-then-muted"');

  await page.locator('[data-bench-switch="skin"] [data-value="theme"]').click();
  await expect(panel).toContainText("import '@playdeck/react/theme.css';");
});

test('a refusal reaches the line in the library\'s own words', async ({ page }) => {
  test.skip(hosted.length === 0, 'Needs a hosted provider with a clip. See bench-sources.ts.');
  // Press a hosted provider, wait for data-live, assert the line names that
  // provider and carries one of reasonWords' phrases. Never assert a specific
  // capability: which one a provider refuses is the provider's business and
  // pinning it here would make this test a second copy of the library's answer.
});
```

The third test is skipped while every hosted provider is `ready: false`, with a
message naming the file to edit, so it starts running on its own the day the ids
land rather than being remembered.

- [ ] **Step 2: Run, then delete the file this replaces**

```bash
pnpm playwright test e2e/site-bench.spec.ts --project=chromium
git rm e2e/site-ledger.spec.ts
```

- [ ] **Step 3: Commit**

```bash
git add e2e/site-bench.spec.ts
git commit -m "Pin the reason line to what a static readout could not do"
```

---

### Task 9: Rewrite the landing spec for the new spine

**Files:**
- Modify: `e2e/site-landing.spec.ts`

The existing file pins six sections by `data-section`, every heading, and the
disclosure sentence. None of that survives. Its header explains what it is for
and that reasoning is still right: pin what the page says and does, never how
large or how far apart any of it is, because a landing page is meant to be
redesigned.

- [ ] **Step 1: Rewrite the assertions**

Keep, with the new markup: exactly one heading reading `Playdeck` and it is the
`h1`; the workbench absent; the install line's behaviour with and without a
script; no horizontal overflow at 320px; the page settled and readable with no
script and under reduced motion; the player dormant on arrival.

Drop: the six `data-section` names, the section headings, the scroll-loading
disclosure sentence, the archetype assertions.

Add: the three switch groups present; the thesis present.

- [ ] **Step 2: Rewrite the file header**

It currently describes "#542 phase 3" and five short sections. Say what the page
is now and why these are the decisions it may not quietly lose.

- [ ] **Step 3: Run and commit**

```bash
pnpm playwright test e2e/site-landing.spec.ts --project=chromium
git add e2e/site-landing.spec.ts
git commit -m "Rewrite the landing spec for the bench"
```

---

### Task 10: Make DESIGN.md agree with the tree

**Files:**
- Modify: `apps/site/DESIGN.md`

- [ ] **Step 1: Update "Where things live"**

Remove `HeroPlayer.astro` and `HeroPlayerIsland.tsx`. Add `Bench.astro`,
`BenchIsland.tsx`, `BenchSwitches.tsx`, `ReasonLine.tsx`,
`CompositionPanel.tsx`, `bench-sources.ts`, `bench-capabilities.ts` and
`bench-composition.ts`, each with one line saying what it is.

**Correct the second animation.** Task 1 recorded it as "a grid column
resolving", which was true of a design that no longer exists. It is the reason
line arriving: `opacity` and a `--space-1` rise at `--duration-base`, keyed off
`data-live`, one line rather than a column. Say that there is no sequence and no
delays, and that the `prefers-reduced-motion` hazard the old ledger resolution
was written around does not arise, because a single transition between two
settled states is exactly what the site-wide duration collapse already handles.

- [ ] **Step 2: Fix every other stale sentence**

The document names the deleted elements in several places: the `.truth-card`
comparison, the ledger's resolution, `.demo__bezel`, the archetypes' `client:visible`
mount on `/`, the readout's `--color-raised`. Read it end to end and make every
sentence about `/` true. It is a long document and this step is most of an hour.

- [ ] **Step 3: Commit**

```bash
pnpm prettier --check apps/site/DESIGN.md
git add apps/site/DESIGN.md
git commit -m "Make DESIGN.md describe the page that exists"
```

---

### Task 11: The audit constraints

All four pass on `/` today. They must still pass.

- [ ] **Step 1: Run the audit**

```bash
pnpm audit:design 2>/dev/null || rg -n "audit" apps/site/package.json package.json
```

Find the script the previous session used and run it. If none is wired, check
each by hand against the built page:

- No functional text under 11px. The switch legends are the risk.
- No 1px border under a 24px or 60px blur. The frame is elevated, so it takes no
  border at all.
- No tracked-caps eyebrow chip above the `h1`. The legends are below it, on
  controls.
- The built page transitions `transform` and `opacity` only. Measure the built
  page, not the source: the previous session found `background-color` animating
  from the archetype stylesheets, which are outside rule 5 by ownership, and the
  count is only sayable against what actually ships.

- [ ] **Step 2: Commit any fixes**

---

### Task 12: The gate

- [ ] **Step 1: Run everything**

```bash
pnpm typecheck
pnpm lint
pnpm vitest run
pnpm docs:check
pnpm build
node scripts/check-bundle-budgets.mjs
node scripts/check-deploy-artifact.mjs
pnpm playwright test --project=chromium --project=firefox
```

`webkit` cannot launch here. CI has it, and it is the only engine that has ever
caught certain cache assertions.

- [ ] **Step 2: Re-run any single failure alone before believing it**

One test fails per full parallel run, a different one each time, and each passes
in isolation. This is documented CPU contention, not a defect. Do not chase it and
do not report the suite as broken because of it.

- [ ] **Step 3: Answer the two open questions against the rendered page**

Both were deliberately left for now, and now is when there is a page to look at.

1. **Mobile.** Three switch groups and a 16:9 video at 320px. The source switch
   is five buttons on one line and will not stay there. `site-landing.spec.ts`
   already fails the page for horizontal overflow at that width, so this is a
   defect rather than a taste call, and the spec leaves the layout to whoever
   sees it first.

- [ ] **Step 4: Show the maintainer before pushing**

The branch is `pedrosousa/issue-542-make-the-landing-page-argue-the-wins` and
`PR #553` carries the rejected version with auto-merge off. Nothing was pushed by
the previous session and pushing is the maintainer's call, not yours. Five
versions of this page have been rejected; show it running before you ask to land
it.

---

## What is still the maintainer's to do

One Blender CC BY film, uploaded to this project's own YouTube, Vimeo and Wistia
accounts. Then three ids and three booleans in `apps/site/src/bench-sources.ts`,
and the skipped test in `e2e/site-quiet.spec.ts` starts running on its own.

Nothing in this plan waits on it.
