# Issue #19: Storybook Workbench Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up Storybook 10.5.3 as an `apps/storybook` workspace app whose colocated stories all run as Vitest browser-mode tests with axe checks, driven by a mock controller decorator over the private provider-loader seam.

**Architecture:** A private `@playdeck/storybook` app owns all Storybook config and dependencies. Its Vite config aliases `@playdeck/*` packages to source and regex-aliases the private `provider-loaders` module to a mock loader backed by the existing `createFakeProvider` fixture. Stories live in `packages/react/src/*.stories.tsx` and render real `Player.Root` wiring via a global decorator.

**Tech Stack:** Storybook 10.5.3 (`@storybook/react-vite`, `addon-vitest`, `addon-a11y`), Vitest 4.1.10 browser mode with `@vitest/browser-playwright` (Chromium), Vite 8.1.5, React 19.2.8.

**Spec:** `.planning/designs/2026-07-23-issue-19-storybook-design.md` — read it before starting any task.

## Global Constraints

- Every Storybook package pinned **exact `10.5.3`**; vitest packages exact `4.1.10`; `@playwright/test` exact `1.61.1`; vite `8.1.5`; react/react-dom `19.2.8`.
- pnpm `allowBuilds` in `pnpm-workspace.yaml` stays exactly `sharp@0.34.5`. If `pnpm install` warns about a new dependency wanting install scripts, STOP and surface it as a decision — do not add to the allowlist.
- Published packages (`@playdeck/core`, `@playdeck/provider-native`, `@playdeck/react`) get **no new dependencies** and no manifest changes beyond tsconfig excludes.
- No public API additions to `@playdeck/react`. The provider-loader seam stays private.
- No attribution, co-author, generated-by, or reaction-prompt footers in commits, PRs, or comments.
- Work only in the `.worktrees/issue-19-storybook` worktree on branch `issue-19-storybook`. Never commit to `main`.
- Run pnpm install/build/typecheck, Vitest, and Playwright commands **serially** within the worktree.
- All commands below run from the worktree root unless stated otherwise.
- Before every commit: `pnpm format` then `pnpm format:check && pnpm lint && pnpm typecheck`.

---

### Task 1: Scaffold `apps/storybook` — Storybook 10.5.3 boots and builds

**Files:**

- Create: `apps/storybook/package.json`
- Create: `apps/storybook/.storybook/main.ts`
- Create: `apps/storybook/.storybook/preview.ts`
- Create: `apps/storybook/tsconfig.json`
- Create: `packages/react/src/poster.stories.tsx` (minimal — one story)
- Modify: `packages/react/tsconfig.json` (exclude stories)
- Modify: `packages/react/tsconfig.test.json` (exclude stories)
- Modify: `tsconfig.json` (root — add reference)
- Modify: `.gitignore` (ignore `storybook-static/`)
- Modify: `eslint.config.js` (ignore `apps/storybook/storybook-static/**`)

**Interfaces:**

- Produces: workspace package `@playdeck/storybook` with scripts `dev`, `build`; Storybook config with `@playdeck/*` → source aliases that Tasks 2–4 extend; stories glob `packages/react/src/**/*.stories.tsx`.

- [ ] **Step 1: Create the app package manifest**

`apps/storybook/package.json` (all deps for Tasks 1–2 land here in one install cycle):

```json
{
  "name": "@playdeck/storybook",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "storybook dev --port 6006",
    "build": "storybook build",
    "test": "vitest run"
  },
  "devDependencies": {
    "@playwright/test": "1.61.1",
    "@playdeck/core": "workspace:*",
    "@playdeck/provider-native": "workspace:*",
    "@playdeck/react": "workspace:*",
    "@storybook/addon-a11y": "10.5.3",
    "@storybook/addon-vitest": "10.5.3",
    "@storybook/react-vite": "10.5.3",
    "@vitest/browser-playwright": "4.1.10",
    "react": "19.2.8",
    "react-dom": "19.2.8",
    "storybook": "10.5.3",
    "vite": "8.1.5",
    "vitest": "4.1.10"
  }
}
```

- [ ] **Step 2: Create the Storybook main config**

`apps/storybook/.storybook/main.ts`:

```ts
import { fileURLToPath } from 'node:url';
import type { StorybookConfig } from '@storybook/react-vite';
import { mergeConfig } from 'vite';

const fromRepoRoot = (path: string): string =>
  fileURLToPath(new URL(`../../../${path}`, import.meta.url));

const config: StorybookConfig = {
  framework: { name: '@storybook/react-vite', options: {} },
  stories: ['../../../packages/react/src/**/*.stories.tsx'],
  addons: ['@storybook/addon-vitest', '@storybook/addon-a11y'],
  viteFinal: async (viteConfig) =>
    mergeConfig(viteConfig, {
      resolve: {
        alias: [
          {
            find: '@playdeck/react',
            replacement: fromRepoRoot('packages/react/src/index.tsx')
          },
          {
            find: '@playdeck/core',
            replacement: fromRepoRoot('packages/core/src/index.ts')
          },
          {
            find: '@playdeck/provider-native',
            replacement: fromRepoRoot('packages/provider-native/src/index.ts')
          }
        ]
      }
    })
};

export default config;
```

(The alias list mirrors the root `vitest.config.ts`. Task 3 prepends a regex alias for the provider-loader seam; Task 4 adds a plugin. Keep the array form — order matters.)

- [ ] **Step 3: Create the preview config**

`apps/storybook/.storybook/preview.ts`:

```ts
import type { Preview } from '@storybook/react-vite';

const preview: Preview = {
  parameters: {
    a11y: { test: 'error' }
  }
};

export default preview;
```

- [ ] **Step 4: Create the app tsconfig and wire the project graph**

`apps/storybook/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "composite": true,
    "noEmit": true,
    "types": ["node"],
    "tsBuildInfoFile": "dist/.tsbuildinfo"
  },
  "references": [
    { "path": "../../packages/core" },
    { "path": "../../packages/provider-native" },
    { "path": "../../packages/react" }
  ],
  "include": [
    ".storybook",
    "src",
    "vitest.config.ts",
    "../../packages/react/src/**/*.stories.tsx",
    "../../packages/react/test/fixtures/fake-provider.ts"
  ]
}
```

(`src/` and `vitest.config.ts` do not exist yet — a non-matching include pattern is not an error. Stories and the fake-provider fixture are type-checked by THIS project; `@playdeck/*` imports resolve to built declarations via project references, exactly like `apps/docs`.)

In `packages/react/tsconfig.json` add an exclude so the library build never emits story declarations:

```json
  "include": ["src"],
  "exclude": ["src/**/*.stories.tsx"]
```

In `packages/react/tsconfig.test.json` add the same line:

```json
  "include": ["src", "test"],
  "exclude": ["src/**/*.stories.tsx"]
```

In root `tsconfig.json` append to `references`:

```json
{ "path": "./apps/storybook" }
```

- [ ] **Step 5: Ignore build output**

Append to `.gitignore`:

```
storybook-static/
```

In `eslint.config.js`, add to the `ignores` array:

```js
'apps/storybook/storybook-static/**';
```

- [ ] **Step 6: Create the minimal first story**

`packages/react/src/poster.stories.tsx` (Task 4 expands this file; `PosterImage` is self-contained — it needs no `Player.Root` context):

```tsx
import type { Meta, StoryObj } from '@storybook/react-vite';
import * as Player from '@playdeck/react';

const meta = {
  title: 'Player/PosterImage',
  component: Player.PosterImage
} satisfies Meta<typeof Player.PosterImage>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Idle: Story = {};
```

- [ ] **Step 7: Install and verify the build fails/succeeds honestly**

Run (serially):

```sh
pnpm install
pnpm --filter @playdeck/storybook build
```

Expected: install succeeds with **no** new build-script warnings (if any appear, STOP — reviewed decision required); `storybook build` exits 0 and emits `apps/storybook/storybook-static/`. If Storybook errors on the `stories` glob or aliases, fix the config — do not relax the pins.

- [ ] **Step 8: Run the repo gates**

```sh
pnpm format
pnpm format:check && pnpm lint && pnpm typecheck
pnpm test
pnpm build
```

Expected: all exit 0. `pnpm build` now includes the app's `storybook build` (via `pnpm -r --if-present run build`). `pnpm test` still runs only the happy-dom suite (stories are not matched by `packages/**/*.test.{ts,tsx}`).

- [ ] **Step 9: Commit**

```sh
git add -A
git commit -m "feat: scaffold Storybook 10.5.3 workspace app with source aliases"
```

---

### Task 2: Story-test infrastructure — every story is a browser test with axe

**Files:**

- Create: `apps/storybook/vitest.config.ts`
- Create: `apps/storybook/.storybook/vitest.setup.ts`
- Modify: `package.json` (root — add `test:storybook`)
- Modify: `.github/workflows/ci.yml` (append `pnpm test:storybook`)

**Interfaces:**

- Consumes: Task 1's `.storybook/main.ts` config (the vitest plugin loads it, including `viteFinal` aliases).
- Produces: `pnpm test:storybook` at root; a global `afterEach` network assertion every later story runs under.

- [ ] **Step 1: Create the vitest config**

`apps/storybook/vitest.config.ts`:

```ts
import { fileURLToPath } from 'node:url';
import { storybookTest } from '@storybook/addon-vitest/vitest-plugin';
import { playwright } from '@vitest/browser-playwright';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [
    storybookTest({
      configDir: fileURLToPath(new URL('./.storybook', import.meta.url))
    })
  ],
  test: {
    name: 'storybook',
    browser: {
      enabled: true,
      headless: true,
      provider: playwright(),
      instances: [{ browser: 'chromium' }]
    },
    setupFiles: ['./.storybook/vitest.setup.ts']
  }
});
```

- [ ] **Step 2: Create the vitest setup with the no-external-request proof**

`apps/storybook/.storybook/vitest.setup.ts`:

```ts
import * as a11yAddonAnnotations from '@storybook/addon-a11y/preview';
import { setProjectAnnotations } from '@storybook/react-vite';
import { afterEach, beforeAll, expect } from 'vitest';
import * as projectAnnotations from './preview';

const annotations = setProjectAnnotations([
  a11yAddonAnnotations,
  projectAnnotations
]);

beforeAll(annotations.beforeAll);

afterEach(() => {
  const resources = performance.getEntriesByType(
    'resource'
  ) as PerformanceResourceTiming[];
  const names = resources.map((entry) => entry.name);
  const external = names.filter(
    (name) =>
      new URL(name, window.location.href).origin !== window.location.origin
  );
  // Stories must never contact an external origin — no media, SDKs, or CDNs.
  expect(external).toEqual([]);
  // Same-origin checks alone would miss the decorator's fake source.
  const mediaRequests = names.filter((name) =>
    name.includes('/media/sample.mp4')
  );
  expect(mediaRequests).toEqual([]);
});
```

(If `setProjectAnnotations`' exact return shape differs in 10.5.3 — e.g. `beforeAll` name — follow the error message and the `@storybook/addon-vitest` docs; the intent is: apply preview + a11y annotations before story tests run.)

- [ ] **Step 3: Wire root script and CI**

Root `package.json`, after `"test:integrations"`:

```json
    "test:storybook": "pnpm --filter @playdeck/storybook test",
```

(keep JSON key order alphabetical-ish with existing style; place next to the other `test:*` scripts.)

`.github/workflows/ci.yml` — append to the single verify run:

```yaml
- run: pnpm format:check && pnpm lint && pnpm typecheck && pnpm test && pnpm test:e2e && pnpm build && pnpm test:packages && pnpm test:bundle && pnpm test:integrations && pnpm test:storybook
```

(CI already installs Chromium via `playwright install`.)

- [ ] **Step 4: Run the story tests — verify the Idle story passes with axe**

```sh
pnpm test:storybook
```

Expected: 1 story test file, `Player/PosterImage > Idle` PASSES in Chromium, and the a11y check ran (verify by output or by temporarily breaking a11y: e.g. add `render: () => <img src="x" role="presentation" alt="x" />`-style violation and confirm failure, then revert). The `afterEach` network assertion runs and passes.

- [ ] **Step 5: Run repo gates and commit**

```sh
pnpm format
pnpm format:check && pnpm lint && pnpm typecheck && pnpm test
git add -A
git commit -m "feat: run stories as Vitest browser tests with axe and network guards"
```

---

### Task 3: Mock controller decorator + activation stories + play-function reference

**Files:**

- Create: `apps/storybook/src/mock-provider-loader.ts`
- Create: `apps/storybook/src/with-mock-controller.tsx`
- Modify: `apps/storybook/.storybook/main.ts` (prepend regex alias)
- Modify: `apps/storybook/.storybook/preview.ts` (register decorator)
- Create: `packages/react/src/activation.stories.tsx`

**Interfaces:**

- Consumes: `createFakeProvider` from `packages/react/test/fixtures/fake-provider.ts`; `loadProvider` call-signature from `packages/react/src/provider-loaders.ts` (loader receives `{ source, media, nativeOptions }`, returns `Promise<ProviderAdapter>`).
- Produces: `setScenario(scenario: MockScenario)`, `getFakeProviderHandle()`, `MockScenario` type; story parameter contract `parameters.playdeck = { rootProps?, scenario? }`; global decorator `withMockController`.

**Read first:** `packages/react/test/activation.test.tsx` (how the fake adapter drives activation) and the spec's "Mock controller decorator" section.

- [ ] **Step 1: Write the failing stories**

`packages/react/src/activation.stories.tsx`:

```tsx
import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, userEvent, waitFor, within } from 'storybook/test';
import * as Player from '@playdeck/react';

const viewportStyle = { width: 320, height: 180 } as const;

const meta = {
  title: 'Player/ActivationButton',
  component: Player.ActivationButton,
  parameters: {
    playdeck: { rootProps: { loading: 'interaction' } }
  },
  render: () => (
    <Player.Viewport style={viewportStyle}>
      <Player.Media />
      <Player.ActivationButton />
    </Player.Viewport>
  )
} satisfies Meta<typeof Player.ActivationButton>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Dormant: Story = {
  play: async ({ canvasElement }) => {
    const button = within(canvasElement).getByRole('button', {
      name: 'Play video'
    });
    await expect(button).toHaveAttribute('data-state', 'dormant');
  }
};

export const Eligible: Story = {
  // Media omitted: with no media mount the loader never starts, so
  // activation holds at `eligible` deterministically after the click.
  render: () => (
    <Player.Viewport style={viewportStyle}>
      <Player.ActivationButton />
    </Player.Viewport>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole('button', { name: 'Play video' }));
    await waitFor(async () => {
      await expect(canvas.getByRole('button')).toHaveAttribute(
        'data-state',
        'eligible'
      );
    });
  }
};

export const LoadingProvider: Story = {
  parameters: {
    playdeck: {
      rootProps: { loading: 'interaction' },
      scenario: { kind: 'pending' }
    }
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole('button', { name: 'Play video' }));
    await waitFor(async () => {
      await expect(canvas.getByRole('button')).toHaveAttribute(
        'data-state',
        'loading-provider'
      );
    });
    await expect(canvas.getByRole('button')).toHaveAttribute(
      'aria-disabled',
      'true'
    );
  }
};

export const ErrorState: Story = {
  parameters: {
    playdeck: {
      rootProps: { loading: 'interaction' },
      scenario: { kind: 'reject' }
    }
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole('button', { name: 'Play video' }));
    await waitFor(async () => {
      await expect(
        canvas.getByRole('button', { name: 'Retry loading video' })
      ).toHaveAttribute('data-state', 'error');
    });
  }
};

/**
 * Reference play-function interaction pattern for later issues:
 * arrange via `parameters.playdeck`, act with `userEvent`, assert the
 * state transition on the part's `data-state` attribute.
 */
export const ActivatesOnClick: Story = {
  parameters: {
    playdeck: {
      rootProps: { loading: 'interaction' },
      scenario: { kind: 'pending' }
    }
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const button = canvas.getByRole('button', { name: 'Play video' });
    await expect(button).toHaveAttribute('data-state', 'dormant');
    await userEvent.click(button);
    await waitFor(async () => {
      await expect(canvas.getByRole('button')).toHaveAttribute(
        'data-state',
        'loading-provider'
      );
    });
  }
};
```

- [ ] **Step 2: Run tests to verify they fail for the right reason**

```sh
pnpm test:storybook
```

Expected: the new activation stories FAIL (no decorator wraps them in `Player.Root`, so `usePlayer` context is missing — a context/provider error, not a syntax error).

- [ ] **Step 3: Implement the mock provider loader**

`apps/storybook/src/mock-provider-loader.ts`:

```ts
import type { ProviderAdapter, ProviderStatePatch } from '@playdeck/core';
import { createFakeProvider } from '../../../packages/react/test/fixtures/fake-provider';

export type MockScenario =
  | {
      readonly kind: 'resolve';
      readonly patches?: readonly ProviderStatePatch[];
    }
  | { readonly kind: 'pending' }
  | { readonly kind: 'reject'; readonly message?: string };

type FakeProviderHandle = ReturnType<typeof createFakeProvider>;

let scenario: MockScenario = { kind: 'resolve' };
let handle: FakeProviderHandle | null = null;

export const setScenario = (next: MockScenario): void => {
  scenario = next;
  handle = null;
};

export const getFakeProviderHandle = (): FakeProviderHandle | null => handle;

// Same call signature as the real private loader in
// packages/react/src/provider-loaders.ts — the Vite alias substitutes this
// module for it inside the Storybook app only.
export const loadProvider = async (_request: {
  readonly media: HTMLVideoElement | null;
}): Promise<ProviderAdapter> => {
  const current = scenario;
  if (current.kind === 'pending') {
    return new Promise<never>(() => {});
  }
  if (current.kind === 'reject') {
    throw new Error(
      current.message ?? 'Storybook scenario: provider load rejected.'
    );
  }
  const fake = createFakeProvider();
  handle = fake;
  const subscribe = fake.adapter.subscribe;
  let patchesFlushed = false;
  return {
    ...fake.adapter,
    subscribe: (listener) => {
      const unsubscribe = subscribe(listener);
      if (!patchesFlushed) {
        patchesFlushed = true;
        // Flush scripted patches after Root has subscribed so stories can
        // dial post-ready playback states deterministically.
        queueMicrotask(() => {
          current.patches?.forEach((patch) => fake.emit(patch));
        });
      }
      return unsubscribe;
    }
  };
};
```

- [ ] **Step 4: Implement the decorator**

`apps/storybook/src/with-mock-controller.tsx`:

```tsx
import type { ComponentProps } from 'react';
import type { Decorator } from '@storybook/react-vite';
import * as Player from '@playdeck/react';
import { setScenario, type MockScenario } from './mock-provider-loader';

type RootProps = Partial<Omit<ComponentProps<typeof Player.Root>, 'children'>>;

export type PlaydeckParameters = {
  readonly rootProps?: RootProps;
  readonly scenario?: MockScenario;
};

export const withMockController: Decorator = (Story, context) => {
  const playdeck = (context.parameters.playdeck ?? {}) as PlaydeckParameters;
  // Render-phase reset is safe: Root's activation work runs in effects,
  // strictly after this decorator body.
  setScenario(playdeck.scenario ?? { kind: 'resolve' });
  return (
    // preload="none" keeps the browser from fetching the fake source once
    // Media renders <source> children; the fake adapter never calls load().
    <Player.Root
      source="/media/sample.mp4"
      preload="none"
      {...playdeck.rootProps}
    >
      <Story />
    </Player.Root>
  );
};
```

- [ ] **Step 5: Wire the alias and the global decorator**

In `apps/storybook/.storybook/main.ts`, prepend to the alias array (regex FIRST — order matters; it matches the relative `./provider-loaders` specifier used inside `packages/react/src`):

```ts
          {
            find: /provider-loaders(\.ts)?$/,
            replacement: fileURLToPath(
              new URL('../src/mock-provider-loader.ts', import.meta.url)
            )
          },
```

In `apps/storybook/.storybook/preview.ts`:

```ts
import type { Preview } from '@storybook/react-vite';
import { withMockController } from '../src/with-mock-controller';

const preview: Preview = {
  decorators: [withMockController],
  parameters: {
    a11y: { test: 'error' }
  }
};

export default preview;
```

- [ ] **Step 6: Run tests to verify they pass**

```sh
pnpm test:storybook
```

Expected: ALL stories pass, including Task 1's `Idle` (now also wrapped in Root — must keep passing) and every activation story with its axe check. If axe reports `video-caption` on the empty `<video>` mount, disable exactly that rule for exactly the affected stories via story-level `parameters.a11y.config.rules = [{ id: 'video-caption', enabled: false }]` with a comment (`empty mock mount — no media exists`); do not weaken the global gate.

- [ ] **Step 7: Verify the static build still succeeds**

```sh
pnpm --filter @playdeck/storybook build
```

Expected: exit 0.

- [ ] **Step 8: Run repo gates and commit**

```sh
pnpm format
pnpm format:check && pnpm lint && pnpm typecheck && pnpm test
git add -A
git commit -m "feat: add mock controller decorator and activation stories"
```

---

### Task 4: Full poster stories, hanging endpoint, loading-indicator stories

**Files:**

- Create: `apps/storybook/src/hang-endpoint-plugin.ts`
- Modify: `apps/storybook/.storybook/main.ts` (register plugin)
- Modify: `packages/react/src/poster.stories.tsx` (all poster states + custom child)
- Create: `packages/react/src/loading-indicator.stories.tsx`

**Interfaces:**

- Consumes: `parameters.playdeck` contract and `MockScenario` from Task 3; `afterEach` network guard from Task 2.
- Produces: `/__playdeck/hang.png` same-origin endpoint that never responds (dev server + vitest browser server).

- [ ] **Step 1: Write the failing stories**

Replace `packages/react/src/poster.stories.tsx` with:

```tsx
import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, waitFor, within } from 'storybook/test';
import * as Player from '@playdeck/react';

const viewportStyle = { width: 320, height: 180 } as const;

// A same-origin endpoint (served by the Storybook app's Vite middleware)
// that never responds: the image stays in `loading` forever.
const HANGING_SRC = '/__playdeck/hang.png';

// 2x1 blue SVG — loads instantly from memory, no network.
const LOADED_SRC = `data:image/svg+xml,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180"><rect width="320" height="180" fill="#1d4ed8"/></svg>'
)}`;

// Structurally invalid image payload — fires the error event deterministically.
const BROKEN_SRC = 'data:image/png;base64,broken';

const posterImage = (state: string, canvasElement: HTMLElement) =>
  waitFor(async () => {
    const image = canvasElement.querySelector(
      '[data-playdeck-part="poster-image"]'
    );
    await expect(image).toHaveAttribute('data-state', state);
  });

const meta = {
  title: 'Player/Poster',
  component: Player.PosterImage,
  render: (args) => (
    <Player.Viewport style={viewportStyle}>
      <Player.Poster>
        <Player.PosterImage {...args} />
      </Player.Poster>
    </Player.Viewport>
  )
} satisfies Meta<typeof Player.PosterImage>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Idle: Story = {
  play: async ({ canvasElement }) => posterImage('idle', canvasElement)
};

export const Loading: Story = {
  args: { src: HANGING_SRC },
  play: async ({ canvasElement }) => posterImage('loading', canvasElement)
};

export const Loaded: Story = {
  args: { src: LOADED_SRC },
  play: async ({ canvasElement }) => posterImage('loaded', canvasElement)
};

export const ErrorState: Story = {
  args: { src: BROKEN_SRC },
  play: async ({ canvasElement }) => posterImage('error', canvasElement)
};

export const CustomChildren: Story = {
  render: () => (
    <Player.Viewport style={viewportStyle}>
      <Player.Poster>
        <div
          style={{
            display: 'grid',
            placeItems: 'center',
            width: '100%',
            height: '100%',
            background: '#0f172a',
            color: '#f8fafc'
          }}
        >
          Custom poster content
        </div>
      </Player.Poster>
    </Player.Viewport>
  ),
  play: async ({ canvasElement }) => {
    await expect(
      within(canvasElement).getByText('Custom poster content')
    ).toBeInTheDocument();
  }
};
```

Create `packages/react/src/loading-indicator.stories.tsx`:

```tsx
import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, waitFor, within } from 'storybook/test';
import * as Player from '@playdeck/react';

const viewportStyle = { width: 320, height: 180 } as const;

const meta = {
  title: 'Player/LoadingIndicator',
  component: Player.LoadingIndicator,
  render: () => (
    <Player.Viewport style={viewportStyle}>
      <Player.Media />
      <Player.LoadingIndicator />
    </Player.Viewport>
  )
} satisfies Meta<typeof Player.LoadingIndicator>;

export default meta;
type Story = StoryObj<typeof meta>;

// `loading="eager"` + a pending scenario holds `loading-provider` with no
// interaction needed.
export const LoadingProviderState: Story = {
  parameters: {
    playdeck: { rootProps: { loading: 'eager' }, scenario: { kind: 'pending' } }
  },
  play: async ({ canvasElement }) => {
    await waitFor(async () => {
      await expect(within(canvasElement).getByRole('status')).toHaveAttribute(
        'data-state',
        'loading-provider'
      );
    });
  }
};

// Resolve, then a scripted buffering patch after the provider is ready.
export const BufferingState: Story = {
  parameters: {
    playdeck: {
      rootProps: { loading: 'eager' },
      scenario: { kind: 'resolve', patches: [{ buffering: true }] }
    }
  },
  play: async ({ canvasElement }) => {
    await waitFor(async () => {
      await expect(within(canvasElement).getByRole('status')).toHaveAttribute(
        'data-state',
        'buffering'
      );
    });
  }
};
```

- [ ] **Step 2: Run tests to verify the right failure**

```sh
pnpm test:storybook
```

Expected: `Loading` FAILS (the `/__playdeck/hang.png` request 404s instantly, so `data-state` becomes `error`, not `loading`). The loading-indicator stories should pass already (they only need Task 3 machinery) — if they fail, fix before proceeding. All other poster stories pass.

- [ ] **Step 3: Implement the hanging endpoint plugin**

`apps/storybook/src/hang-endpoint-plugin.ts`:

```ts
import type { Plugin } from 'vite';

// Serves a same-origin image URL that never responds, so poster stories can
// hold `data-state="loading"` deterministically without external requests.
export const hangEndpointPlugin = (): Plugin => ({
  name: 'playdeck-hang-endpoint',
  configureServer(server) {
    server.middlewares.use('/__playdeck/hang.png', () => {
      // Intentionally never respond and never call next().
    });
  }
});
```

In `apps/storybook/.storybook/main.ts`, import it and add to the merged config (inside the object passed to `mergeConfig`, alongside `resolve`):

```ts
import { hangEndpointPlugin } from '../src/hang-endpoint-plugin';
// ...
      plugins: [hangEndpointPlugin()],
```

- [ ] **Step 4: Run tests to verify everything passes**

```sh
pnpm test:storybook
```

Expected: ALL stories pass, including `Loading`, with axe checks and the network guard. (The hanging request never completes, so it never produces a resource-timing entry — the guard stays green.)

- [ ] **Step 5: Verify the static build and dev-mode spot check**

```sh
pnpm --filter @playdeck/storybook build
```

Expected: exit 0. (Dev-mode HITL review happens at final review; the vitest run already exercises every story in a real browser.)

- [ ] **Step 6: Run repo gates and commit**

```sh
pnpm format
pnpm format:check && pnpm lint && pnpm typecheck && pnpm test
git add -A
git commit -m "feat: add poster and loading-indicator stories with hanging endpoint"
```

---

### Task 5: Conventions doc + full verification gate

**Files:**

- Create: `apps/storybook/README.md`
- Verify (no expected change): `pnpm-workspace.yaml` allowlist, published package manifests.

**Interfaces:**

- Consumes: everything above; this is the documentation + final-gate task.

- [ ] **Step 1: Write the conventions README**

`apps/storybook/README.md`:

````markdown
# @playdeck/storybook

Component workbench and story-based test runner for `@playdeck/react`.

## Commands

| Command                                 | What it does                                   |
| --------------------------------------- | ---------------------------------------------- |
| `pnpm --filter @playdeck/storybook dev` | Storybook dev server on port 6006              |
| `pnpm test:storybook` (root)            | Runs every story as a Chromium Vitest test     |
| `pnpm build` (root)                     | Includes the static `storybook build` CI check |

## Conventions

- **Stories live next to their component:** `packages/react/src/<part>.stories.tsx`.
- **One story per meaningful state.** A component with four `data-state`
  values gets four stories, named after the state.
- **Stories are tests.** Every story runs in a real browser with an axe
  check (`a11y.test = 'error'`). A story's `play` function is its
  interaction test — see `ActivatesOnClick` in
  `packages/react/src/activation.stories.tsx` for the reference pattern:
  arrange via `parameters.playdeck`, act with `userEvent`, assert on
  `data-state`.
- **No real media, no network.** A global `afterEach` fails any story test
  that touches an external origin or the fake media source. Use data-URI
  images; use `/__playdeck/hang.png` for perpetual-loading states.

## Dialing player state

The global `withMockController` decorator wraps every story in
`Player.Root` backed by a fake provider (the same fixture the contract
tests use). Control it per story:

```ts
parameters: {
  playdeck: {
    rootProps: { loading: 'interaction' },   // any Player.Root props
    scenario: { kind: 'pending' }            // provider-load scenario
  }
}
```

Scenarios:

- `{ kind: 'resolve', patches?: [...] }` (default) — provider loads;
  optional `ProviderStatePatch` list dials post-ready state
  (e.g. `{ buffering: true }`).
- `{ kind: 'pending' }` — provider load never settles
  (`loading-provider`).
- `{ kind: 'reject', message? }` — provider load fails (`error`).

Pre-provider activation states come from real strategy behavior: use
`loading="interaction"` and click (or omit `Player.Media` to hold
`eligible`). In `play` functions, `getFakeProviderHandle()` from
`apps/storybook/src/mock-provider-loader.ts` exposes the live fake
provider for further `emit()` patches.

## Adding stories for a new issue

1. Create `packages/react/src/<part>.stories.tsx`.
2. Cover every visual state the issue defines, one story each.
3. Add at least one `play` interaction story if the component has
   interaction semantics.
4. Run `pnpm test:storybook` — new stories are picked up automatically.
````

- [ ] **Step 2: Confirm the dependency policy held**

```sh
git diff main -- pnpm-workspace.yaml packages/core/package.json packages/provider-native/package.json packages/react/package.json
```

Expected: NO diff (allowlist unchanged, published manifests unchanged).

- [ ] **Step 3: Run the full verification gate (serially, fresh)**

```sh
pnpm format
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm test:e2e
pnpm build
pnpm test:packages
pnpm test:bundle
pnpm test:integrations
pnpm test:storybook
```

Expected: every command exits 0. `pnpm test` count matches main's baseline (244) — stories add no happy-dom tests. `test:bundle` proves published bundles unaffected.

- [ ] **Step 4: Commit**

```sh
git add -A
git commit -m "docs: document story conventions for later issues"
```

---

## Acceptance-criteria trace (from issue #19)

| Criterion                                                             | Where satisfied                            |
| --------------------------------------------------------------------- | ------------------------------------------ |
| Storybook 10.5.x + Vite 8 + React 19; build green in CI               | Task 1 (build via root `pnpm build` in CI) |
| Mock decorator dials any `PlayerState`, proof of no network           | Tasks 2 (guard) + 3 (decorator/scenarios)  |
| Stories for all poster + activation states                            | Tasks 3 + 4                                |
| Every story = browser-mode Vitest test with axe, in root scripts + CI | Task 2                                     |
| ≥1 play-function reference story                                      | Task 3 (`ActivatesOnClick`)                |
| Conventions documented                                                | Task 5                                     |
| Storybook only in devDependencies; published pkgs unaffected          | Task 1 + Task 5 Step 2 + bundle gate       |
