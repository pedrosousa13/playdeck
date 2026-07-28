# Consolidate real-playback into Storybook (Issue #50) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Storybook the single front-facing surface — real-video playback stories alongside the existing mock states, docs, and tests — and retire `apps/docs`, without weakening the deterministic (zero-network) mock story suite.

**Architecture:** Real-playback stories are tagged `['real-playback', '!test']` so the addon-vitest run (which enforces zero external requests) skips them; a guard test proves no leak. The global mock decorator passes such stories through untouched. The live-HLS Vite plugin and static fixtures move into Storybook. A `Fixtures/PlayerFixture` story reproduces the docs fixture's testid/`window.reelyHandle`/arg contract so Playwright e2e retargets from `apps/docs` to `storybook dev`. `apps/docs` is deleted LAST, only after the retargeted e2e is green.

**Tech Stack:** Storybook 10.5.3 (`@storybook/react-vite`), Vitest 4.1.10 browser mode, Playwright 1.61.1, Vite 8, React 19, TypeScript, pnpm workspaces, Turborepo.

## Global Constraints

- Real-playback stories MUST carry both tags `'real-playback'` and `'!test'`. A story tagged `real-playback` without `!test` is a defect (it would enter the zero-network suite and flake).
- The mock story suite (existing per-primitive stories, `support.ts`, the drift guard, `vitest.setup.ts`) MUST stay unchanged in behavior and stay zero-network. `test:storybook` file/test counts for the MOCK stories must not drop.
- Storybook/addons/Vite plugins are devDependencies of the private `@reely/storybook` app only. Published packages unaffected; `pnpm test:bundle`/`test:packages` stay green. The pnpm build allowlist stays exactly `sharp@0.34.5`.
- e2e specs keep every existing `page.route(...)` interception, `window.reelyHandle` probe, testid, and assertion — ONLY the navigation target (`page.goto`) and the webServer change. Behavior asserted must not weaken.
- `apps/docs` / `@reely/docs` deletion happens ONLY in the final task, ONLY after the retargeted e2e is green.
- No attribution / co-author / generated-by / reaction-prompt footers anywhere.

**Execution setup (before Task 1, via `superpowers:using-git-worktrees`):**

- Worktree `.worktrees/issue-50-storybook-consolidation`, branch `issue-50-storybook-consolidation`, off `main` @ `6375ccc`.
- `pnpm install --frozen-lockfile`; confirm clean baseline: `pnpm --filter @reely/storybook test` and `pnpm typecheck` green.
- Run all pnpm/playwright commands serially within the worktree.

---

### Task 1: Tag-gate the mock decorator + real-playback guard test

Let a story opt out of mock wrapping, and pin the `real-playback ⇒ !test` invariant before any real story exists.

**Files:**

- Modify: `apps/storybook/.storybook/mock-player.tsx`
- Create: `apps/storybook/stories/real-playback.contract.test.ts`
- Modify: `vitest.config.ts` (root — include the new contract test, same as the #49 drift guard)

**Interfaces:**

- Consumes: Storybook `Decorator` `context.tags: string[]`.
- Produces: `withMockPlayer` passes `<Story/>` through when `context.tags` includes `'real-playback'`.

- [ ] **Step 1: Write the guard test (characterization — passes vacuously now)**

Create `apps/storybook/stories/real-playback.contract.test.ts`:

```ts
import { readFileSync } from 'node:fs';
import { fileURLToPath, URL } from 'node:url';
import { describe, expect, it } from 'vitest';

// Scans real-playback story source files: any story module tagged
// 'real-playback' must also be tagged '!test' so it never enters the
// zero-network addon-vitest suite. Source-level scan keeps this runnable in
// the root (node) suite without importing story runtimes.
const storyFiles = ['real-playback.stories.tsx', 'player-fixture.stories.tsx'];

const readIfPresent = (name: string): string | null => {
  try {
    return readFileSync(
      fileURLToPath(new URL(`./${name}`, import.meta.url)),
      'utf8'
    );
  } catch {
    return null;
  }
};

describe('real-playback stories opt out of the deterministic suite', () => {
  it('every real-playback story file that exists also declares the !test tag', () => {
    for (const name of storyFiles) {
      const src = readIfPresent(name);
      if (src === null) continue; // not created yet — later tasks add them
      if (!src.includes("'real-playback'")) continue;
      expect(
        src.includes("'!test'"),
        `${name} tags 'real-playback' but is missing '!test'`
      ).toBe(true);
    }
  });
});
```

- [ ] **Step 2: Wire the test into the root suite**

In `vitest.config.ts`, extend `test.include` (it already lists the #49 drift guard):

```ts
include: [
  'packages/**/*.test.{ts,tsx}',
  'apps/storybook/stories/**/*.contract.test.ts'
];
```

(If already matching `**/*.contract.test.ts`, no change needed — verify.)

- [ ] **Step 3: Run the guard test**

Run: `pnpm exec vitest run apps/storybook/stories/real-playback.contract.test.ts`
Expected: PASS (1 test; the story files do not exist yet, so it passes vacuously).

- [ ] **Step 4: Tag-gate the mock decorator**

In `apps/storybook/.storybook/mock-player.tsx`, change the exported decorator so tagged real stories pass through:

```tsx
export const withMockPlayer: Decorator = (Story, context) => {
  if (context.tags?.includes('real-playback')) return <Story />;
  return (
    <MockPlayerRoot
      parameters={(context.parameters.player ?? {}) as MockPlayerParameters}
    >
      <Story />
    </MockPlayerRoot>
  );
};
```

- [ ] **Step 5: Verify mock suite unchanged**

Run: `pnpm --filter @reely/storybook test`
Expected: PASS, same file/test counts as baseline (12 files / 42 tests) — no real stories exist yet, so the gate never triggers.

Run: `pnpm typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/storybook/.storybook/mock-player.tsx apps/storybook/stories/real-playback.contract.test.ts vitest.config.ts
git commit -m "feat(storybook): tag-gate mock decorator for real-playback stories"
```

---

### Task 2: Port fixtures + the live-HLS plugin into Storybook

Give Storybook the static media fixtures and the live-HLS middleware so real native/HLS/live playback works under `storybook dev`.

**Files:**

- Create: `apps/storybook/public/` ← copy of `apps/docs/public/*` (`poster.svg`, `tracer.mp4`, `hls/**`)
- Create: `apps/storybook/.storybook/live-playlist-plugin.ts` (ported)
- Modify: `apps/storybook/.storybook/main.ts` (add `staticDirs` + the live plugin)

**Interfaces:**

- Produces: `storybook dev` serves `/tracer.mp4`, `/poster.svg`, `/hls/master.m3u8`, `/live/index.m3u8`, `/live/seg_N.ts`.

- [ ] **Step 1: Copy the static fixtures**

```bash
mkdir -p apps/storybook/public
cp -R apps/docs/public/. apps/storybook/public/
git add apps/storybook/public
```

Confirm `apps/storybook/public/tracer.mp4`, `poster.svg`, and `hls/v0/seg_000.ts` exist.

- [ ] **Step 2: Port the live plugin (fix the segment path)**

Copy `apps/docs/live-playlist-plugin.ts` to `apps/storybook/.storybook/live-playlist-plugin.ts` verbatim EXCEPT the segment path, which must resolve from the new location to `apps/storybook/public/hls/v0/seg_000.ts`:

```ts
const SEGMENT_PATH = fileURLToPath(
  new URL('../public/hls/v0/seg_000.ts', import.meta.url)
);
```

(The plugin file sits in `.storybook/`, fixtures in `../public/` — hence `../public/...`. Everything else — `handleLive`, `renderPlaylist`, the dual `configureServer`/`configurePreviewServer` hooks — is unchanged.)

- [ ] **Step 3: Wire into main.ts**

In `apps/storybook/.storybook/main.ts`: import the plugin, add `staticDirs`, and append the plugin to viteFinal `plugins` (next to `pendingAssetPlugin()`):

```ts
import { liveHlsFixture } from './live-playlist-plugin';
// ...
const config: StorybookConfig = {
  stories: ['../stories/**/*.mdx', '../stories/**/*.stories.tsx'],
  staticDirs: ['../public'],
  addons: [/* unchanged */],
  framework: '@storybook/react-vite',
  viteFinal: (viteConfig) => ({
    ...viteConfig,
    plugins: [
      ...(viteConfig.plugins ?? []),
      pendingAssetPlugin(),
      liveHlsFixture()
    ],
    resolve: {/* unchanged */}
  })
};
```

- [ ] **Step 4: Verify the fixtures serve under storybook dev**

Run (in the worktree):

```bash
pnpm --filter @reely/storybook dev --ci -p 4173 > /tmp/sb50.log 2>&1 &
sleep 12
curl -s -o /dev/null -w "tracer.mp4 %{http_code}\n" http://127.0.0.1:4173/tracer.mp4
curl -s -o /dev/null -w "hls master %{http_code}\n" http://127.0.0.1:4173/hls/master.m3u8
curl -s -w "live playlist:\n%{http_code}\n" http://127.0.0.1:4173/live/index.m3u8 | head -8
curl -s -o /dev/null -w "live seg %{http_code}\n" http://127.0.0.1:4173/live/seg_0.ts
lsof -ti:4173 | xargs kill 2>/dev/null
```

Expected: `tracer.mp4 200`, `hls master 200`, live playlist `200` with `#EXTM3U`/`#EXT-X-MEDIA-SEQUENCE` and NO `#EXT-X-ENDLIST`, `live seg 200`.

- [ ] **Step 5: Mock suite + typecheck still green**

Run: `pnpm --filter @reely/storybook test && pnpm typecheck`
Expected: PASS (staticDirs/plugin don't affect the mock stories).

- [ ] **Step 6: Commit**

```bash
git add apps/storybook/public apps/storybook/.storybook/live-playlist-plugin.ts apps/storybook/.storybook/main.ts
git commit -m "feat(storybook): host media fixtures and live-HLS plugin"
```

---

### Task 3: Real-playback showcase stories

Add watchable real-video stories, excluded from the deterministic suite.

**Files:**

- Create: `apps/storybook/stories/real-playback.stories.tsx`

**Interfaces:**

- Consumes: `Player.*` from `@reely/react`; the fixtures from Task 2; sources `/tracer.mp4`, `{ type: 'hls', src: '/hls/master.m3u8', engine }`, `{ type: 'hls', src: '/live/index.m3u8', engine }`, `https://www.youtube.com/watch?v=M7lc1UVf-VE`, `https://vimeo.com/76979871`.

- [ ] **Step 1: Write the stories**

Create `apps/storybook/stories/real-playback.stories.tsx`. `meta` carries the opt-out tags; each story renders a real `Player.Root` with `loading="interaction"` (click-to-load, avoids autoplay-policy noise). Provide a small reusable frame.

```tsx
import * as Player from '@reely/react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import type { ReactNode } from 'react';

const Stage = ({ children }: { readonly children: ReactNode }) => (
  <Player.Viewport style={{ width: 640, height: 360, background: '#0b0e13' }}>
    <Player.Poster>
      <Player.PosterImage src="/poster.svg" />
    </Player.Poster>
    {children}
    <Player.ActivationButton aria-label="Load and play" />
  </Player.Viewport>
);

const meta = {
  title: 'Real playback/Providers',
  tags: ['real-playback', '!test'],
  parameters: {
    docs: {
      description: {
        component:
          'Real providers, real media, real network — excluded from the deterministic story test suite (tagged `!test`). Click the activation overlay to load. HLS/live/native are local fixtures; YouTube and Vimeo hit the network.'
      }
    }
  }
} satisfies Meta;

export default meta;

type Story = StoryObj;

export const NativeMp4: Story = {
  render: () => (
    <Player.Root loading="interaction" source="/tracer.mp4">
      <Stage>
        <Player.Media />
      </Stage>
    </Player.Root>
  )
};

export const HlsVodNative: Story = {
  render: () => (
    <Player.Root
      loading="interaction"
      source={{ type: 'hls', src: '/hls/master.m3u8', engine: 'native' }}
    >
      <Stage>
        <Player.Media />
      </Stage>
    </Player.Root>
  )
};

export const HlsVodHlsJs: Story = {
  render: () => (
    <Player.Root
      loading="interaction"
      source={{ type: 'hls', src: '/hls/master.m3u8', engine: 'hls.js' }}
    >
      <Stage>
        <Player.Media />
      </Stage>
    </Player.Root>
  )
};

export const LiveHls: Story = {
  render: () => (
    <Player.Root
      loading="interaction"
      source={{ type: 'hls', src: '/live/index.m3u8', engine: 'hls.js' }}
    >
      <Stage>
        <Player.Media />
      </Stage>
    </Player.Root>
  )
};

export const YouTube: Story = {
  render: () => (
    <Player.Root
      loading="interaction"
      source="https://www.youtube.com/watch?v=M7lc1UVf-VE"
    >
      <Stage>
        <Player.Media />
      </Stage>
    </Player.Root>
  )
};

export const Vimeo: Story = {
  render: () => (
    <Player.Root loading="interaction" source="https://vimeo.com/76979871">
      <Stage>
        <Player.Media />
      </Stage>
    </Player.Root>
  )
};
```

**Note for the implementer:** confirm the exact `Player.Root` `source` shape and `engine`/`loading` prop names against `packages/react/src/index.tsx` and the retired-but-still-present `apps/docs/src/main.tsx` (which uses these exact sources). Adjust the `source` literal to the real accepted type if it differs (e.g. HLS may take `{ type: 'hls', src, engine }` — mirror what `apps/docs` passes). Do not invent props.

- [ ] **Step 2: Guard test passes with real tags present**

Run: `pnpm exec vitest run apps/storybook/stories/real-playback.contract.test.ts`
Expected: PASS — the file now contains `'real-playback'` AND `'!test'`.

- [ ] **Step 3: Deterministic suite excludes them**

Run: `pnpm --filter @reely/storybook test`
Expected: PASS, mock file/test counts UNCHANGED (12/42) — the real stories are tagged `!test` and never run here. If the count rises or a network-guard failure appears, the `!test` tag isn't taking effect — stop and report.

- [ ] **Step 4: Visual check (controller will drive this)**

Report DONE_WITH_CONCERNS noting the stories need a live `storybook dev` visual confirmation (the controller screenshots native/HLS/live/YouTube/Vimeo playback). Build check: `pnpm --filter @reely/storybook build` exit 0.

- [ ] **Step 5: Commit**

```bash
git add apps/storybook/stories/real-playback.stories.tsx
git commit -m "feat(storybook): real-playback showcase stories"
```

---

### Task 4: `Fixtures/PlayerFixture` story — the e2e target

Reproduce the `apps/docs` `PlayerFixture` contract as a Storybook story so e2e can retarget to it. This PORTS existing code — `apps/docs/src/main.tsx` is the reference implementation.

**Files:**

- Create: `apps/storybook/stories/player-fixture.stories.tsx`

**Port contract (MUST preserve, verified against `apps/docs/src/main.tsx` and the e2e specs):**

- `tags: ['real-playback', '!test']`, `title: 'Fixtures/PlayerFixture'`, one primary story `Default` (id `fixtures-playerfixture--default`).
- **Arg-driven source selection** mirroring the docs `URLSearchParams` logic (lines ~11-68 of `main.tsx`): args `source` (`hls|live|vimeo|vimeo-unlisted|https://…|undefined→/tracer.mp4`), `engine` (`native|hls.js|auto`), `activationSource` (`youtube|external`), `autoplay`, `loading`, `preload`, `defaultMuted`, `airplay`, `sourceChange`. Storybook injects `?args=key:val;…` into the story's args — read them in `render`/`args` and map to `Player.Root` props exactly as `main.tsx` does.
- **Same testids/DOM** the specs assert: `data-testid` `viewport`, `youtube-example`, `presentation-capabilities` (+ `fullscreen-toggle`, `pip-toggle`, `airplay-picker`), `live-panel` (+ `live-indicator`, `live-time`, `live-seek-back`, `live-seek-edge`), `hls-engine`, `error-category`, plus the `data-*` state attributes those panels expose.
- **`window.reelyHandle`** set to the `Player.Root` handle via ref (docs `main.tsx` line ~268), so specs' imperative probes work.

- [ ] **Step 1: Read the reference and port**

Read `apps/docs/src/main.tsx` in full. Port the `PlayerFixture` (+ `YouTubeExample`, `presentation-capabilities`, `live-panel` sub-surfaces) into a single Storybook story `Default`, replacing `URLSearchParams` reads with Storybook `args`. Keep the doc prose OUT (only the interactive fixture surfaces the specs touch). Set `window.reelyHandle` in an effect from the Root ref.

Because the arg→prop mapping is the crux, define an explicit `argTypes` for each arg and a `render(args)` that builds the `Player.Root` source/props from `args` using the SAME branching as `main.tsx`. Do not change the branching logic — only the input (args instead of query string).

- [ ] **Step 2: Story renders under storybook dev**

Confirm the story loads at `/iframe.html?id=fixtures-playerfixture--default&viewMode=story` and that args flow through, e.g.:

```bash
pnpm --filter @reely/storybook dev --ci -p 4173 > /tmp/sb50b.log 2>&1 &
sleep 12
curl -s -o /dev/null -w "fixture story %{http_code}\n" "http://127.0.0.1:4173/iframe.html?id=fixtures-playerfixture--default&viewMode=story"
lsof -ti:4173 | xargs kill 2>/dev/null
```

Expected: `200`. (Full behavior is verified by the retargeted e2e in Task 5.)

- [ ] **Step 3: Deterministic suite unaffected**

Run: `pnpm --filter @reely/storybook test`
Expected: PASS, mock counts unchanged (fixture is `!test`).

Run: `pnpm typecheck` — PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/storybook/stories/player-fixture.stories.tsx
git commit -m "feat(storybook): PlayerFixture story reproducing the docs e2e contract"
```

---

### Task 5: Retarget Playwright e2e to Storybook

Point the e2e suite at `storybook dev` and the fixture story. Preserve every route/assert.

**Files:**

- Modify: `playwright.config.ts` (webServer command)
- Modify: every `e2e/*.spec.ts` that navigates (`goto`) — rewrite the target only

**Goto rewrite map** (query → args on the fixture iframe URL; Storybook args use `key:val;key2:val2`):

| Spec                   | Old goto                                                 | New goto                                                                              |
| ---------------------- | -------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| native-mp4             | `/`                                                      | `/iframe.html?id=fixtures-playerfixture--default&viewMode=story`                      |
| autoplay               | `/?autoplay=muted` / `audible`                           | `…--default&viewMode=story&args=autoplay:muted` / `:audible`                          |
| activation             | `/?loading=interaction&activationSource=external` (+2)   | `…&args=loading:interaction;activationSource:external` (+2)                           |
| poster                 | `/` ×4                                                   | `…--default&viewMode=story` ×4                                                        |
| platform               | `/`, `/?airplay=demo`                                    | `…--default&viewMode=story`, `…&args=airplay:demo`                                    |
| hls                    | `/?source=hls&engine=hls.js` / `native`                  | `…&args=source:hls;engine:hls.js` / `;engine:native`                                  |
| live                   | `/?source=live&engine=hls.js` / `native`                 | `…&args=source:live;engine:hls.js` / `;engine:native`                                 |
| youtube                | `/?loading=interaction&activationSource=youtube` ×2, `/` | `…&args=loading:interaction;activationSource:youtube` ×2, `…--default&viewMode=story` |
| youtube-real (`@real`) | `/?loading=interaction&activationSource=youtube`         | `…&args=loading:interaction;activationSource:youtube`                                 |
| vimeo                  | `/?source=vimeo…`, `vimeo-unlisted`                      | `…&args=source:vimeo…`, `source:vimeo-unlisted`                                       |
| vimeo-smoke (`@real`)  | `/?source=vimeo&loading=interaction…`                    | `…&args=source:vimeo;loading:interaction…`                                            |

- [ ] **Step 1: Retarget the webServer**

In `playwright.config.ts`, replace the `webServer.command` (keep `url`, `baseURL`, `gracefulShutdown`, `reuseExistingServer`):

```ts
  webServer: {
    command:
      'pnpm --filter @reely/storybook exec storybook dev --ci --no-open -p 4173 --host 127.0.0.1',
    url: 'http://127.0.0.1:4173/iframe.html?id=fixtures-playerfixture--default&viewMode=story',
    gracefulShutdown: { signal: 'SIGTERM', timeout: 500 },
    reuseExistingServer: !process.env.CI
  },
```

(Set `url` to a Storybook route that returns 200 once ready. If `storybook dev` needs longer than Playwright's default webServer timeout, add `timeout: 120_000`.)

- [ ] **Step 2: Rewrite the gotos**

Apply the rewrite map above to each spec — change ONLY the `goto` string. Leave every `page.route(...)`, `window.reelyHandle`, testid, `data-*`, and engine-chunk assertion exactly as-is. For the HLS engine-chunk assertion (`hls.spec.ts` expects a `/assets/hls-*.js` chunk), verify the chunk path under `storybook dev`; if the dev-server serves the hls.js chunk at a different path than `/assets/hls-*.js`, update THAT assertion to match the real path (and note it) — do not delete the assertion.

- [ ] **Step 3: Run the non-`@real` e2e locally**

Run: `pnpm exec playwright test 2>&1 | tail -30`
Expected: all non-`@real` specs pass across chromium/firefox/webkit (`@real` is grep-inverted by default). Iterate on any goto/arg-mapping mismatch. If a spec depends on a fixture surface not yet reproduced in Task 4, report back — Task 4's fixture may need that sub-surface added (treat as a Task 4 gap, fix there, re-review).

- [ ] **Step 4: Commit**

```bash
git add playwright.config.ts e2e
git commit -m "test(e2e): retarget Playwright from apps/docs to Storybook fixture"
```

---

### Task 6: Update root script + CI

Drop the docs build from the e2e path and move the CI path filter.

**Files:**

- Modify: `package.json` (root — `test:e2e`)
- Modify: `.github/workflows/ci.yml`

- [ ] **Step 1: test:e2e no longer builds docs**

In root `package.json`, change:

```json
    "test:e2e": "playwright test",
```

(The Playwright `webServer` now starts `storybook dev`; no pre-build needed. `storybook dev` aliases `@reely/*` to source, same as the old docs preview.)

- [ ] **Step 2: Move the CI path filter**

In `.github/workflows/ci.yml`, the `hls-paths` job's path filter that greps `apps/docs/` must become `apps/storybook/` (the e2e now depends on Storybook). Read the job (~line 97-118) and update the path pattern; leave the rest of the gating logic intact. Verify no other job references `@reely/docs` build outputs for e2e.

- [ ] **Step 3: Full gate (local)**

Run serially:

```bash
pnpm format:check && pnpm lint && pnpm typecheck && pnpm test && pnpm build && pnpm test:packages && pnpm test:bundle && pnpm test:integrations && pnpm test:storybook && pnpm test:e2e
```

Expected: all green. (`apps/docs` still exists at this point; that's fine — it's just no longer the e2e target. It is deleted in Task 7.)

- [ ] **Step 4: Commit**

```bash
git add package.json .github/workflows/ci.yml
git commit -m "ci: run e2e against Storybook, drop docs build from e2e path"
```

---

### Task 7: Retire apps/docs

Delete the now-redundant app. ONLY after Task 5–6 e2e is green.

**Files:**

- Delete: `apps/docs/` (entire directory)

- [ ] **Step 1: Confirm no remaining references**

Run: `grep -rn "@reely/docs\|apps/docs" --include='*.ts' --include='*.tsx' --include='*.json' --include='*.yml' --include='*.mjs' . | grep -v node_modules | grep -v '\.planning/'`
Expected: no hits outside `apps/docs/` itself. If any remain (e.g. a stray script or CI reference), resolve them before deleting.

- [ ] **Step 2: Delete the app**

```bash
git rm -r apps/docs
```

- [ ] **Step 3: Full gate after deletion**

Run serially:

```bash
pnpm install && pnpm format:check && pnpm lint && pnpm typecheck && pnpm test && pnpm build && pnpm test:packages && pnpm test:bundle && pnpm test:integrations && pnpm test:storybook && pnpm test:e2e
```

Expected: all green. `pnpm build` no longer builds `@reely/docs`; `test:e2e` runs against Storybook.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "chore: retire apps/docs (real playback now lives in Storybook)"
```

---

## Acceptance mapping (#50)

- **Real-playback stories exist in Storybook for the providers apps/docs demoed** → Tasks 3 (showcase) + 4 (fixture). e2e covers them against Storybook → Tasks 5-6.
- **Zero-request determinism guard is tag-scoped; a meta-test prevents real stories entering the tested set** → Task 1 (`!test` gate + guard test).
- **apps/docs removed; CI builds only Storybook for e2e; full gate green** → Tasks 6-7.

## Out of scope

Hosting/deploying the static build; visual regression snapshots; new player/provider features; changing the mock story suite, `support.ts`, or the drift guard.

## Fail-safe

Tasks 1-4 deliver real video in Storybook regardless of the e2e migration. If Tasks 5-6 prove intractable across browsers, land 1-4 and defer 5-7 to a follow-up — do NOT delete `apps/docs` until its e2e replacement is green.
