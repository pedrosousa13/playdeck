# Polished Storybook (Issue #49) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Storybook workbench derive its staged states from the real core capability/state contract (single source of truth, drift-guarded) and add per-component autodocs plus three hand-written MDX overview pages.

**Architecture:** Rewrite `apps/storybook/stories/support.ts` so the ready-state helper's capability base comes from `@playdeck/core`'s `createInitialPlayerState().capabilities` instead of a hand-listed object; guard the derivation with a unit test. Enable Storybook autodocs (`@storybook/addon-docs`, `tags: ['autodocs']`, `.mdx` glob) and enrich each component's `meta` with a documentation description covering usage, the data-attribute contract, a11y/keyboard notes, and capability-gating. Add the missing `PosterImage` story and structural doc blocks, then three MDX overview pages.

**Tech Stack:** Storybook 10.5.3 (`@storybook/react-vite`), Vitest 4.1.10 browser mode (`@vitest/browser-playwright`), React 19, TypeScript, pnpm workspaces, Vite 8.

## Global Constraints

- Storybook + addon packages pinned to exactly `10.5.3`. Verify against npm before install.
- Storybook/addons are **devDependencies only**; published packages must stay unaffected (`pnpm test:bundle`, `test:packages` stay green).
- pnpm build allowlist stays exactly `sharp@0.34.5` unless an addon legitimately requires an addition (reviewed decision, not a default).
- The determinism guard (`.storybook/vitest.setup.ts`) must stay intact: every story test issues **zero external requests**. New tests/stories issue none either.
- `createInitialPlayerState()` is the only exported core factory used here. `initialCapabilities` is **not** exported — derive the capability base from `createInitialPlayerState().capabilities`. Do **not** add a core export.
- `ready(overrides, patch)`'s public signature must not change — 11 existing stories call it as `ready({}, { ... })` / `ready({ seek: available }, ...)`.
- Real-provider / real-playback stories are OUT of scope (deferred to #50). No story may load real media.
- No attribution / co-author / generated-by / reaction-prompt footers anywhere (commits, PRs, files).

**Execution setup (before Task 1, via `superpowers:using-git-worktrees`):**

- Worktree `.worktrees/issue-49-storybook-polish`, branch `issue-49-storybook-polish`, off `main` @ `bf0261e`.
- `pnpm install --frozen-lockfile`, then confirm a clean baseline: `pnpm --filter @playdeck/storybook test` passes and `pnpm typecheck` is green.
- Run all pnpm commands serially within the worktree.

---

### Task 1: Story support derives from the core contract (drift-guarded)

Rewrite `support.ts` so the capability base comes from core, and pin the derivation with a unit test. This is a refactor guarded by a characterization test: the test passes before and after (proving equivalence) and thereafter guarantees a new core capability surfaces in stories instead of silently missing.

**Files:**

- Modify: `apps/storybook/stories/support.ts`
- Test (create): `apps/storybook/stories/support.contract.test.ts`

**Interfaces:**

- Consumes: `createInitialPlayerState()` from `@playdeck/core` (returns a frozen `PlayerState`; `.capabilities` is a frozen `PlayerCapabilities` with all 9 keys set to `{ status: 'unknown', reason: 'not-ready' }`).
- Produces: `ready(overrides?: Partial<PlayerCapabilities>, patch?: ProviderStatePatch): { player: MockPlayerParameters }`; exported `Availability` samples `available`, `notReady`, `unavailable`.

- [ ] **Step 1: Write the failing/characterization test**

Create `apps/storybook/stories/support.contract.test.ts`:

```ts
import { createInitialPlayerState, type Availability } from '@playdeck/core';
import { describe, expect, it } from 'vitest';
import { available, notReady, ready, unavailable } from './support';

const isValidAvailability = (a: Availability): boolean => {
  switch (a.status) {
    case 'available':
      return true;
    case 'unknown':
      return a.reason === 'not-ready' || a.reason === 'provider-check';
    case 'unavailable':
      return [
        'browser',
        'provider',
        'provider-plan',
        'source',
        'policy'
      ].includes(a.reason);
    default:
      return false;
  }
};

describe('story support derives from the real core contract', () => {
  it('ready() capability keys match the core contract exactly', () => {
    const staged = ready().player.state?.capabilities ?? {};
    const core = createInitialPlayerState().capabilities;
    expect(Object.keys(staged).sort()).toEqual(Object.keys(core).sort());
  });

  it('unspecified capabilities default to the core not-ready value', () => {
    const staged = ready().player.state?.capabilities;
    const core = createInitialPlayerState().capabilities;
    expect(staged?.seek).toEqual(core.seek);
  });

  it('capability overrides win over the derived base', () => {
    const staged = ready({ seek: available }).player.state?.capabilities;
    expect(staged?.seek).toEqual(available);
  });

  it('exported Availability samples are all valid core values', () => {
    for (const a of [available, notReady, unavailable]) {
      expect(isValidAvailability(a)).toBe(true);
    }
  });
});
```

- [ ] **Step 2: Run the test against the current (hand-listed) support.ts**

Run: `pnpm --filter @playdeck/storybook exec vitest run stories/support.contract.test.ts`
Expected: PASS (the current hand-listed `baseCapabilities` already matches core — this pins the invariant). If it FAILS, the current mock has already drifted from core; capture the diff before refactoring.

- [ ] **Step 3: Refactor `support.ts` to derive the base from core**

Replace the whole file `apps/storybook/stories/support.ts` with:

```ts
import {
  createInitialPlayerState,
  type Availability,
  type PlayerCapabilities,
  type ProviderStatePatch
} from '@playdeck/core';
import type { MockPlayerParameters } from '../.storybook/mock-player';

export const available: Availability = { status: 'available' };
export const notReady: Availability = {
  status: 'unknown',
  reason: 'not-ready'
};
export const unavailable: Availability = {
  status: 'unavailable',
  reason: 'provider'
};

/**
 * A ready player-state patch with the given capability overrides. The base
 * capability set is derived from the real core contract
 * (`createInitialPlayerState().capabilities`) rather than hand-listed, so a
 * new core capability surfaces here automatically instead of silently
 * missing. Unspecified capabilities stay `unknown` (`not-ready`), which is
 * what capability-absent stories rely on to prove a control renders nothing
 * until its capability resolves.
 */
export const ready = (
  overrides: Partial<PlayerCapabilities> = {},
  patch: ProviderStatePatch = {}
): { player: MockPlayerParameters } => ({
  player: {
    state: {
      lifecycle: 'ready',
      activation: 'ready',
      provider: 'native',
      capabilities: {
        ...createInitialPlayerState().capabilities,
        ...overrides
      },
      ...patch
    }
  }
});
```

- [ ] **Step 4: Run the guard test + the full storybook suite**

Run: `pnpm --filter @playdeck/storybook test`
Expected: PASS — the guard test plus all 11 existing story files stay green (the existing stories are the reachability proof: each pushes a `ready()` state through the real `PlayerController` and asserts `data-state`).

- [ ] **Step 5: Typecheck**

Run: `pnpm typecheck`
Expected: PASS (no unused symbols; `baseCapabilities` removed).

- [ ] **Step 6: Commit**

```bash
git add apps/storybook/stories/support.ts apps/storybook/stories/support.contract.test.ts
git commit -m "refactor(storybook): derive story capabilities from core contract"
```

---

### Task 2: Enable autodocs + MDX docs infrastructure

Add the docs addon, turn on autodocs globally, and let Storybook discover `.mdx` files. No component content yet — this task's deliverable is "the docs system builds."

**Files:**

- Modify: `apps/storybook/package.json` (add `@storybook/addon-docs`)
- Modify: `apps/storybook/.storybook/main.ts` (stories glob + addon)
- Modify: `apps/storybook/.storybook/preview.tsx` (`tags: ['autodocs']`)
- Test (create, temporary): `apps/storybook/stories/Smoke.mdx` (deleted in Task 5 once real MDX exists — keep a placeholder to prove `.mdx` discovery)

**Interfaces:**

- Produces: global autodocs (every `meta` renders a Docs page), `.mdx` discovery under `stories/`, the `@storybook/addon-docs/blocks` import path available to MDX.

- [ ] **Step 1: Verify the addon version, then add it**

Run: `npm view @storybook/addon-docs@10.5.3 version`
Expected: prints `10.5.3`.

Add to `apps/storybook/package.json` `devDependencies` (keep alphabetical among `@storybook/*`):

```json
    "@storybook/addon-a11y": "10.5.3",
    "@storybook/addon-docs": "10.5.3",
    "@storybook/addon-vitest": "10.5.3",
```

Run: `pnpm install`
Expected: lockfile updates with `@storybook/addon-docs@10.5.3`; no change to the `sharp` build allowlist.

- [ ] **Step 2: Register the addon and widen the stories glob**

In `apps/storybook/.storybook/main.ts`, change the `stories` and `addons` fields:

```ts
const config: StorybookConfig = {
  stories: ['../stories/**/*.mdx', '../stories/**/*.stories.tsx'],
  addons: [
    '@storybook/addon-a11y',
    '@storybook/addon-docs',
    '@storybook/addon-vitest'
  ],
  framework: '@storybook/react-vite',
```

(Leave `viteFinal` and `pendingAssetPlugin` untouched.)

- [ ] **Step 3: Turn on autodocs globally**

In `apps/storybook/.storybook/preview.tsx`, add a top-level `tags` field:

```ts
const preview: Preview = {
  decorators: [withMockPlayer],
  tags: ['autodocs'],
  parameters: {
    a11y: {
      // Fail the Vitest story test when axe reports a violation.
      test: 'error'
    }
  }
};
```

- [ ] **Step 4: Add a temporary smoke MDX page to prove discovery**

Create `apps/storybook/stories/Smoke.mdx`:

```mdx
import { Meta } from '@storybook/addon-docs/blocks';

<Meta title="Overview/Smoke" />

# Smoke

Temporary page proving `.mdx` discovery. Removed in Task 5.
```

- [ ] **Step 5: Build Storybook to verify docs + MDX compile**

Run: `pnpm --filter @playdeck/storybook build`
Expected: exit 0; build output mentions the `Overview/Smoke` docs entry and per-component autodocs. If the `@storybook/addon-docs/blocks` import fails, run `npm view @storybook/addon-docs@10.5.3` and confirm the `blocks` subpath — adjust the import only if the registry shows a different entry.

- [ ] **Step 6: Story tests still green**

Run: `pnpm --filter @playdeck/storybook test`
Expected: PASS (autodocs pages are not story tests; the determinism guard is unaffected).

- [ ] **Step 7: Commit**

```bash
git add apps/storybook/package.json apps/storybook/.storybook/main.ts apps/storybook/.storybook/preview.tsx apps/storybook/stories/Smoke.mdx pnpm-lock.yaml
git commit -m "feat(storybook): enable autodocs and mdx docs infrastructure"
```

---

### Task 3: Document the interactive / capability-gated controls

Add a `parameters.docs.description.component` block to each capability-gated control's `meta`, covering usage, data-attributes, a11y/keyboard, and the gating capability. Values below are confirmed from `packages/react/src/index.tsx`.

**Files (all Modify, `apps/storybook/stories/`):**

- `play-button.stories.tsx`, `mute-button.stories.tsx`, `volume-slider.stories.tsx`, `seek-slider.stories.tsx`, `fullscreen-button.stories.tsx`, `pip-button.stories.tsx`, `time.stories.tsx`, `controls.stories.tsx`

**Confirmed contract (from source):**

| Component        | `data-playdeck-part`                    | `data-state` values   | `data-provider` | Gating capability                                                |
| ---------------- | --------------------------------------- | --------------------- | --------------- | ---------------------------------------------------------------- |
| PlayButton       | `play-button`                           | `paused` \| `playing` | yes             | none (provider presence)                                         |
| MuteButton       | `mute-button`                           | `muted` \| `unmuted`  | yes             | `setVolume`                                                      |
| VolumeSlider     | `volume-slider`                         | `muted` \| `unmuted`  | yes             | `setVolume`                                                      |
| SeekSlider       | `seek-slider` (+ child `seek-buffered`) | `idle` \| `ready`     | yes             | `seek`                                                           |
| FullscreenButton | `fullscreen-button`                     | (button state)        | yes             | `fullscreen`                                                     |
| PipButton        | `pip-button`                            | (button state)        | yes             | `pictureInPicture`                                               |
| Time             | `time`                                  | —                     | —               | none (display)                                                   |
| Controls         | `controls`                              | `global` \| `scoped`  | yes             | aggregate: `seek`, `setVolume`, `fullscreen`, `pictureInPicture` |

- [ ] **Step 1: Worked example — PlayButton**

In `apps/storybook/stories/play-button.stories.tsx`, add `parameters` to the `meta` (keep the existing `render`):

````ts
const meta = {
  title: 'Player/PlayButton',
  component: Player.PlayButton,
  parameters: {
    docs: {
      description: {
        component: [
          '`Player.PlayButton` toggles play/pause on the active provider.',
          '',
          '**Usage** — compose it under `Player.Root` (a `Player.Viewport` or `Player.Controls` gives it layout context):',
          '```tsx',
          '<Player.Root source={source}>',
          '  <Player.Viewport>',
          '    <Player.PlayButton />',
          '  </Player.Viewport>',
          '</Player.Root>',
          '```',
          '',
          '**Contract** — renders `data-playdeck-part="play-button"`, `data-provider="<provider>"`, and `data-state="paused" | "playing"`.',
          '',
          '**Accessibility** — a native `<button>`; label switches between "Play" and "Pause"; reachable and operable by keyboard (Tab to focus, Enter/Space to toggle).',
          '',
          '**Capability** — not capability-gated; it renders once a provider is attached.'
        ].join('\n')
      }
    }
  },
  render: () => (
    <Player.Viewport style={{ width: 480, height: 270, background: '#0b0e13' }}>
      <Player.PlayButton />
    </Player.Viewport>
  )
} satisfies Meta<typeof Player.PlayButton>;
````

- [ ] **Step 2: Apply the same pattern to the remaining seven controls**

For each file, add the same `parameters.docs.description.component` field to its `meta` (join an array of lines with `'\n'`, exactly as above), using this per-component copy. Do not change existing stories or `render`/`component` fields.

`mute-button.stories.tsx` — component line: "`Player.MuteButton` mutes/unmutes the active provider."; Contract: `data-playdeck-part="mute-button"`, `data-provider`, `data-state="muted" | "unmuted"`; a11y: native `<button>`, label reflects mute state, keyboard-operable; Capability: **gated by `setVolume`** — renders nothing until `setVolume` resolves `available`.

`volume-slider.stories.tsx` — "`Player.VolumeSlider` sets the active provider's volume."; Contract: `data-playdeck-part="volume-slider"`, `data-provider`, `data-state="muted" | "unmuted"`; a11y: exposes a range semantics control; arrow keys adjust; Capability: **gated by `setVolume`**.

`seek-slider.stories.tsx` — "`Player.SeekSlider` scrubs the current time; a child `seek-buffered` element reflects buffered ranges."; Contract: `data-playdeck-part="seek-slider"` (child `data-playdeck-part="seek-buffered"`), `data-provider`, `data-state="idle" | "ready"` (`ready` once a duration is known); a11y: range control, arrow keys seek; Capability: **gated by `seek`**.

`fullscreen-button.stories.tsx` — "`Player.FullscreenButton` toggles fullscreen on the viewport."; Contract: `data-playdeck-part="fullscreen-button"`, `data-provider`; a11y: native `<button>`, keyboard-operable; Capability: **gated by `fullscreen`**.

`pip-button.stories.tsx` — "`Player.PipButton` toggles picture-in-picture."; Contract: `data-playdeck-part="pip-button"`, `data-provider`; a11y: native `<button>`, keyboard-operable; Capability: **gated by `pictureInPicture`**.

`time.stories.tsx` — "`Player.Time` displays current time and/or duration."; Contract: `data-playdeck-part="time"`; a11y: text content; not an interactive control; Capability: not gated (display only).

`controls.stories.tsx` — "`Player.Controls` is the control-bar container; `data-state` distinguishes a `global` bar from a `scoped` one."; Contract: `data-playdeck-part="controls"`, `data-provider`, `data-state="global" | "scoped"`; a11y: groups child controls; Capability: reflects the aggregate of `seek`, `setVolume`, `fullscreen`, `pictureInPicture`.

- [ ] **Step 3: Build Storybook and confirm each Docs page renders the description**

Run: `pnpm --filter @playdeck/storybook build`
Expected: exit 0, no MDX/docgen errors.

- [ ] **Step 4: Story tests still green**

Run: `pnpm --filter @playdeck/storybook test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/storybook/stories/play-button.stories.tsx apps/storybook/stories/mute-button.stories.tsx apps/storybook/stories/volume-slider.stories.tsx apps/storybook/stories/seek-slider.stories.tsx apps/storybook/stories/fullscreen-button.stories.tsx apps/storybook/stories/pip-button.stories.tsx apps/storybook/stories/time.stories.tsx apps/storybook/stories/controls.stories.tsx
git commit -m "docs(storybook): document interactive control primitives"
```

---

### Task 4: Document visual/state components + add missing coverage

Add descriptions to the state-driven components, add the missing `PosterImage` story, and add lightweight doc-only pages for the structural components `Root`/`Viewport`/`Media`.

**Files:**

- Modify: `apps/storybook/stories/poster.stories.tsx`, `loading-indicator.stories.tsx`, `activation.stories.tsx`
- Create: `apps/storybook/stories/poster-image.stories.tsx`
- Create: `apps/storybook/stories/structural.mdx`

**Interfaces:**

- Consumes: `Player.PosterImage` (renders `data-playdeck-part="poster-image"`, `data-state="idle" | "loading" | "loaded" | "error"`); the dev-only hanging asset `/__playdeck__/pending.png` (loading state) and a data-URI (loaded) — both request-free per the determinism guard.

- [ ] **Step 1: Add descriptions to the three existing components**

In each meta add `parameters.docs.description.component` (array joined by `'\n'`, as in Task 3):

`poster.stories.tsx` — "`Player.Poster` is the pre-playback surface; wrap a `Player.PosterImage` or arbitrary children."; Contract: `data-playdeck-part="poster"`, `data-state`; note: children replace the default image.

`loading-indicator.stories.tsx` — "`Player.LoadingIndicator` surfaces buffering/loading."; Contract: `data-playdeck-part="loading-indicator"`, `data-state`; a11y: decorative/status; Capability: not gated (state-driven).

`activation.stories.tsx` — "`Player.ActivationButton` triggers pre-provider activation (`dormant`/`eligible`/`loading-provider`/`error`)."; Contract: `data-playdeck-part="activation"`, `data-state="<activation>"`; a11y: native `<button>`, keyboard-operable; include the `play`-function activation story as the reference interaction pattern.

- [ ] **Step 2: Write a failing test for the new PosterImage story**

Create `apps/storybook/stories/poster-image.stories.tsx` (mirrors the request-free technique already proven in `poster.stories.tsx`):

```tsx
import * as Player from '@playdeck/react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, waitFor } from 'storybook/test';
import type { ReactNode } from 'react';

const Frame = ({ children }: { readonly children: ReactNode }) => (
  <Player.Viewport style={{ width: 480, height: 270, background: '#0b0e13' }}>
    {children}
  </Player.Viewport>
);

const loadedSrc = `data:image/svg+xml;utf8,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="900"><rect width="1600" height="900" fill="#1d2733"/></svg>'
)}`;

const image = (root: HTMLElement): HTMLElement => {
  const el = root.querySelector<HTMLElement>(
    '[data-playdeck-part="poster-image"]'
  );
  if (!el) throw new Error('Expected a poster image in the story.');
  return el;
};

const meta = {
  title: 'Player/PosterImage',
  component: Player.PosterImage,
  parameters: {
    docs: {
      description: {
        component: [
          '`Player.PosterImage` renders the poster bitmap and tracks its own load lifecycle.',
          '',
          '**Contract** — `data-playdeck-part="poster-image"`, `data-state="idle" | "loading" | "loaded" | "error"`.',
          '',
          '**Capability** — not gated; state is driven purely by the image load.'
        ].join('\n')
      }
    }
  }
} satisfies Meta<typeof Player.PosterImage>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Loaded: Story = {
  render: () => (
    <Frame>
      <Player.Poster>
        <Player.PosterImage src={loadedSrc} />
      </Player.Poster>
    </Frame>
  ),
  play: async ({ canvasElement }) => {
    await waitFor(() =>
      expect(image(canvasElement)).toHaveAttribute('data-state', 'loaded')
    );
  }
};
```

- [ ] **Step 3: Run the new story test to verify it passes**

Run: `pnpm --filter @playdeck/storybook exec vitest run stories/poster-image.stories.tsx`
Expected: PASS (the data-URI loads with no external request; a11y `error` gate satisfied — an `<img>` inside the poster).

If a11y flags a missing alt/name, add the attribute the component expects (check `Player.PosterImage` props in `packages/react/src/index.tsx`) rather than disabling the rule.

- [ ] **Step 4: Add the structural doc page**

Create `apps/storybook/stories/structural.mdx`:

```mdx
import { Meta } from '@storybook/addon-docs/blocks';

<Meta title="Player/Structural" />

# Structural components

These wire the player together and are exercised implicitly by every other
story rather than shown in isolation.

- **`Player.Root`** — owns the `PlayerController`; its imperative handle is the
  controller. Props include `loading` (`eager` | `viewport` | `interaction`),
  `loadMargin`, `preload`, `autoplay`, and native playback options.
- **`Player.Viewport`** — the layout box controls compose into; registers with
  the controller for viewport-triggered activation.
- **`Player.Media`** — mounts the actual media element once a provider attaches.
  Not rendered in stories (the mock provider issues no media), so real playback
  lives in the docs app.
```

- [ ] **Step 5: Build + full storybook suite**

Run: `pnpm --filter @playdeck/storybook build && pnpm --filter @playdeck/storybook test`
Expected: both PASS; the `Player/PosterImage` autodocs page and `Player/Structural` page appear.

- [ ] **Step 6: Commit**

```bash
git add apps/storybook/stories/poster.stories.tsx apps/storybook/stories/loading-indicator.stories.tsx apps/storybook/stories/activation.stories.tsx apps/storybook/stories/poster-image.stories.tsx apps/storybook/stories/structural.mdx
git commit -m "docs(storybook): document visual components, add PosterImage story"
```

---

### Task 5: MDX overview pages

Replace the temporary smoke page with the three real overview pages: an introduction with story conventions, the capabilities matrix, and the data-attribute contract reference.

**Files:**

- Delete: `apps/storybook/stories/Smoke.mdx`
- Create: `apps/storybook/stories/Introduction.mdx`, `apps/storybook/stories/CapabilitiesMatrix.mdx`, `apps/storybook/stories/Contract.mdx`

- [ ] **Step 1: Remove the smoke page**

```bash
git rm apps/storybook/stories/Smoke.mdx
```

- [ ] **Step 2: Introduction + conventions**

Create `apps/storybook/stories/Introduction.mdx`:

```mdx
import { Meta } from '@storybook/addon-docs/blocks';

<Meta title="Overview/Introduction" />

# Playdeck workbench

Headless player primitives staged in isolation. Every story renders under a
mock `Player.Root` backed by an inert provider, so any `PlayerState` and
capability set can be dialed in deterministically — with no media, network, or
SDKs. Real playback lives in the docs app (`apps/docs`).

## Story conventions

- Import primitives as `import * as Player from '@playdeck/react'`; title under
  `Player/<Component>`.
- Dial state with the `ready(capabilityOverrides, statePatch)` helper from
  `stories/support.ts`. Its capability base is derived from the real core
  contract (`createInitialPlayerState().capabilities`) and guarded by
  `support.contract.test.ts`, so stories can only stage states the real
  controller accepts.
- Each story runs as a Vitest browser test with an axe check
  (`a11y.test: 'error'`) and must issue **zero external requests** (enforced by
  `.storybook/vitest.setup.ts`).
- Prove interactions with a `play` function (see `Player/ActivationButton`).
```

- [ ] **Step 3: Capabilities matrix**

Create `apps/storybook/stories/CapabilitiesMatrix.mdx`. Confirm each row against `packages/react/src/index.tsx` (search for `capabilities.<name>.status`) before writing — the gating column is the capability the component reads; a control renders nothing until that capability resolves `available` (the issue's "Capability Unavailable → renders nothing").

```mdx
import { Meta } from '@storybook/addon-docs/blocks';

<Meta title="Overview/Capabilities matrix" />

# Capabilities matrix

Capabilities come from the core `PlayerCapabilities` contract. Each control
below reads one capability (or, for `Controls`, several) and appears only when
that capability resolves `available`; while `unknown` or `unavailable` it
renders nothing.

| Component                 | Gating capability                                     | Renders when                          |
| ------------------------- | ----------------------------------------------------- | ------------------------------------- |
| `Player.PlayButton`       | — (provider presence)                                 | a provider is attached                |
| `Player.MuteButton`       | `setVolume`                                           | `setVolume` is `available`            |
| `Player.VolumeSlider`     | `setVolume`                                           | `setVolume` is `available`            |
| `Player.SeekSlider`       | `seek`                                                | `seek` is `available`                 |
| `Player.FullscreenButton` | `fullscreen`                                          | `fullscreen` is `available`           |
| `Player.PipButton`        | `pictureInPicture`                                    | `pictureInPicture` is `available`     |
| `Player.Time`             | — (display)                                           | always                                |
| `Player.Controls`         | `seek`, `setVolume`, `fullscreen`, `pictureInPicture` | container; children gate individually |

The remaining `PlayerCapabilities` keys — `setPlaybackRate`, `selectQuality`,
`selectTextTrack`, `airPlay`, `customControls` — have no dedicated primitive
yet; they are staged in stories but gate no shipped control.
```

- [ ] **Step 4: Data-attribute contract**

Create `apps/storybook/stories/Contract.mdx`:

```mdx
import { Meta } from '@storybook/addon-docs/blocks';

<Meta title="Overview/Contract" />

# Data-attribute contract

Every primitive exposes a stable styling/testing contract via data attributes.

- **`data-playdeck-part`** — the primitive's stable name (`play-button`,
  `mute-button`, `volume-slider`, `seek-slider` / `seek-buffered`,
  `fullscreen-button`, `pip-button`, `time`, `controls`, `poster`,
  `poster-image`, `loading-indicator`, `activation`, `viewport`, `media`).
- **`data-state`** — the component's derived state (e.g. `paused`/`playing`,
  `muted`/`unmuted`, `idle`/`ready`, `loading`/`loaded`/`error`,
  `global`/`scoped`, or the activation state).
- **`data-provider`** — present on capability-gated interactive controls,
  carrying the active provider name.

Style and query against these attributes rather than internal class names.

Real playback (real providers, real media) is demonstrated in the docs app
(`apps/docs`), driven by the e2e suite — not here.
```

- [ ] **Step 5: Build + suite + typecheck**

Run: `pnpm --filter @playdeck/storybook build && pnpm --filter @playdeck/storybook test && pnpm typecheck`
Expected: all PASS; `Overview/Introduction`, `Overview/Capabilities matrix`, `Overview/Contract` render; no `Smoke` page remains.

- [ ] **Step 6: Commit**

```bash
git add apps/storybook/stories/Introduction.mdx apps/storybook/stories/CapabilitiesMatrix.mdx apps/storybook/stories/Contract.mdx
git commit -m "docs(storybook): add overview, capabilities matrix, contract pages"
```

---

### Task 6: Full verification gate

Run the complete project gate and confirm nothing regressed. No new source in this task — it is the final reviewer gate.

- [ ] **Step 1: Format scratch planning docs (Prettier does not read `.git/info/exclude`)**

Run: `pnpm exec prettier --write ".planning/**/*.md"`

- [ ] **Step 2: Run the full gate serially**

Run:

```bash
pnpm format:check && pnpm lint && pnpm typecheck && pnpm test && pnpm test:e2e && pnpm build && pnpm test:packages && pnpm test:bundle && pnpm test:integrations && pnpm test:storybook
```

Expected: every command exits 0. `test:packages`/`test:bundle` prove the published surface is unchanged (the docs addon is devDep-only). Capture the tail of each as evidence (`superpowers:verification-before-completion` — fresh output, no assumptions).

- [ ] **Step 3: Confirm the build allowlist is unchanged**

Run: `git diff main -- package.json pnpm-workspace.yaml | grep -i onlyBuiltDependencies -A3 || echo "allowlist untouched"`
Expected: the `sharp@0.34.5` allowlist is unchanged (or the diff shows only a reviewed, justified addition).

- [ ] **Step 4: Adversarial code review**

Use `superpowers:requesting-code-review` on the full branch delta (`git diff main...issue-49-storybook-polish`) with a read-only reviewer. Address findings, committing corrections before finishing.

- [ ] **Step 5: Finish**

Follow `superpowers:finishing-a-development-branch`: push `issue-49-storybook-polish`, open a PR titled `Add polished Storybook docs and core-derived mock (#49)`, no attribution footers. After merge: verify the gate on merged `main`, delete the branch + worktree, update `.planning/.continue-here.md` for the next issue.

---

## Acceptance mapping (#49)

- **Every transport primitive has an autodocs/MDX page with usage + a11y + state-attribute docs** → Tasks 2 (autodocs infra), 3 (interactive controls), 4 (visual components + PosterImage).
- **Mock capability/state derives from real core contracts; a drift-guard test exists** → Task 1 (`support.ts` derives from `createInitialPlayerState().capabilities`; `support.contract.test.ts`).
- **Reviewer can see every meaningful + capability-gated state, and docs explain each** → Task 3 gating docs + Task 5 `CapabilitiesMatrix.mdx` + existing per-state stories.

## Out of scope (carried from spec)

Real-playback demo stories (→ #50), hosting the static build, visual regression snapshots, stories for not-yet-existing components, unifying the mock adapter with the contract-test fixture / migrating the 244 existing tests.
