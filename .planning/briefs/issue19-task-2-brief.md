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
