### Task 3: Mock controller decorator + activation stories + play-function reference

**Files:**

- Create: `apps/storybook/src/mock-provider-loader.ts`
- Create: `apps/storybook/src/with-mock-controller.tsx`
- Modify: `apps/storybook/.storybook/main.ts` (prepend regex alias)
- Modify: `apps/storybook/.storybook/preview.ts` (register decorator)
- Create: `packages/react/src/activation.stories.tsx`

**Interfaces:**

- Consumes: `createFakeProvider` from `packages/react/test/fixtures/fake-provider.ts`; `loadProvider` call-signature from `packages/react/src/provider-loaders.ts` (loader receives `{ source, media, nativeOptions }`, returns `Promise<ProviderAdapter>`).
- Produces: `setScenario(scenario: MockScenario)`, `getFakeProviderHandle()`, `MockScenario` type; story parameter contract `parameters.reely = { rootProps?, scenario? }`; global decorator `withMockController`.

**Read first:** `packages/react/test/activation.test.tsx` (how the fake adapter drives activation) and the spec's "Mock controller decorator" section.

- [ ] **Step 1: Write the failing stories**

`packages/react/src/activation.stories.tsx`:

```tsx
import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, userEvent, waitFor, within } from 'storybook/test';
import * as Player from '@reely/react';

const viewportStyle = { width: 320, height: 180 } as const;

const meta = {
  title: 'Player/ActivationButton',
  component: Player.ActivationButton,
  parameters: {
    reely: { rootProps: { loading: 'interaction' } }
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
    reely: {
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
    reely: {
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
 * arrange via `parameters.reely`, act with `userEvent`, assert the
 * state transition on the part's `data-state` attribute.
 */
export const ActivatesOnClick: Story = {
  parameters: {
    reely: {
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
import type { ProviderAdapter, ProviderStatePatch } from '@reely/core';
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
import * as Player from '@reely/react';
import { setScenario, type MockScenario } from './mock-provider-loader';

type RootProps = Partial<Omit<ComponentProps<typeof Player.Root>, 'children'>>;

export type ReelyParameters = {
  readonly rootProps?: RootProps;
  readonly scenario?: MockScenario;
};

export const withMockController: Decorator = (Story, context) => {
  const reely = (context.parameters.reely ?? {}) as ReelyParameters;
  // Render-phase reset is safe: Root's activation work runs in effects,
  // strictly after this decorator body.
  setScenario(reely.scenario ?? { kind: 'resolve' });
  return (
    // preload="none" keeps the browser from fetching the fake source once
    // Media renders <source> children; the fake adapter never calls load().
    <Player.Root source="/media/sample.mp4" preload="none" {...reely.rootProps}>
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
pnpm --filter @reely/storybook build
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
