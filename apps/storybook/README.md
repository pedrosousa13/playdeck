# @reely/storybook

Component workbench for the Reely player. Every story doubles as a
real-browser component test: `@storybook/addon-vitest` runs each one under
Vitest browser mode (Playwright/Chromium), including an axe accessibility
check and a guard that fails the test if anything is requested from outside
the test origin.

## Commands

- `pnpm dev` — workbench at `http://localhost:6006`.
- `pnpm build` — static build (also part of the root `pnpm build`).
- `pnpm test` — run every story as a browser test (root: `pnpm test:storybook`).

## Story conventions

- Stories live in `stories/<part>.stories.tsx`, titled `Player/<Component>`.
- One story per meaningful component state, named after the state
  (`Dormant`, `Buffering`, ...). New visual states added by later issues get
  their story in the same change.
- Single-component interaction semantics are `play`-function tests using the
  context's `canvas`/`userEvent` plus `expect`/`waitFor` from
  `storybook/test`. `ActivatesOnClick` in `stories/activation.stories.tsx` is
  the reference. Whole-player flows with real media belong in Playwright e2e,
  logic-level tests in plain Vitest — not here.
- Stories must be deterministic and offline: never render `Player.Media`,
  never reference an external URL. Use data URIs for images that must load or
  fail, and `/__reely__/pending.png` (held open forever by a dev-server
  middleware in `.storybook/main.ts`) for permanently-pending loads. The
  no-external-request guard in `.storybook/vitest.setup.ts` enforces this per
  story.

## Mock player decorator

`.storybook/mock-player.tsx` wraps every story in a `Player.Root` backed by a
mock provider adapter (same `ProviderAdapter` surface the contract tests
fake), so player components render against any `PlayerState` without media,
provider SDKs, or network. Dial state per story via `parameters.player`:

```tsx
export const Buffering: Story = {
  parameters: {
    player: {
      // Emitted through the mock provider after mount; any Partial<PlayerState>.
      state: { activation: 'ready', lifecycle: 'ready', buffering: true },
      // Optional: autoplay mode + the mock provider's play() result, e.g.
      // blocked autoplay:
      //   autoplay: 'muted',
      //   playResult: { ok: false, reason: 'blocked' },
      // Optional: override the Player.Root props the decorator renders
      // (defaults: loading="interaction" and a mock source).
      rootProps: { defaultMuted: true }
    }
  }
};
```

Without `parameters.player` the player stays pristine and dormant, which is
what interaction stories want: clicking `Player.ActivationButton` walks the
real `dormant -> eligible` transition (and stops there — no `Player.Media`
means no provider load).

The parameter shape is `MockPlayerParameters` in `.storybook/mock-player.tsx`;
see its doc comments for the full contract.

## Theme toggle

The toolbar's **Theme** control (Headless / Themed) switches every story
between the raw primitives and the optional `@reely/react/theme.css`. It
defaults to Headless, because that is what the library ships and what most
stories assert. The decorator in `.storybook/theme.tsx` is the only place
the stylesheet is mounted: it renders it as a `<style>` inside the story, so
it is torn down with the story rather than left in the shared preview
document. A story that needs the theme regardless of the toolbar pins itself
with `globals: { theme: 'themed' }` — `stories/theme.stories.tsx` does, on its
meta.
