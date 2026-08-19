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
