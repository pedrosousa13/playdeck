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

- Produces: workspace package `@reely/storybook` with scripts `dev`, `build`; Storybook config with `@reely/*` → source aliases that Tasks 2–4 extend; stories glob `packages/react/src/**/*.stories.tsx`.

- [ ] **Step 1: Create the app package manifest**

`apps/storybook/package.json` (all deps for Tasks 1–2 land here in one install cycle):

```json
{
  "name": "@reely/storybook",
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
    "@reely/core": "workspace:*",
    "@reely/provider-native": "workspace:*",
    "@reely/react": "workspace:*",
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
            find: '@reely/react',
            replacement: fromRepoRoot('packages/react/src/index.tsx')
          },
          {
            find: '@reely/core',
            replacement: fromRepoRoot('packages/core/src/index.ts')
          },
          {
            find: '@reely/provider-native',
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

(`src/` and `vitest.config.ts` do not exist yet — a non-matching include pattern is not an error. Stories and the fake-provider fixture are type-checked by THIS project; `@reely/*` imports resolve to built declarations via project references, exactly like `apps/docs`.)

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
import * as Player from '@reely/react';

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
pnpm --filter @reely/storybook build
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
