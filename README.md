# Reely

A performant, composable, accessible React 19 media player with
capability-aware providers.

One API across native MP4/WebM, HLS (VOD and live), YouTube and Vimeo. The
primitives are headless — no CSS is imported, nothing is rendered you did not
compose — and every control is gated on what the active provider can actually
do, so a control whose command cannot be honoured is absent rather than present
and disabled.

<!-- example:quickstart -->

```tsx
import * as Player from '@reely/react';

// One API across MP4/WebM, HLS, YouTube and Vimeo: the source decides which
// provider loads, and nothing else changes.
export const Clip = () => (
  <Player.Root source="https://example.com/clip.mp4">
    <Player.Viewport>
      <Player.Media />
      <Player.Controls>
        <Player.PlayButton />
        <Player.SeekSlider />
        <Player.Time type="current" />
        <Player.FullscreenButton />
      </Player.Controls>
    </Player.Viewport>
  </Player.Root>
);
```

<!-- /example -->

## Packages

| Package                                                | What it is                                                    |
| ------------------------------------------------------ | ------------------------------------------------------------- |
| [`@reely/react`](packages/react)                       | The React primitives. Start here.                             |
| [`@reely/core`](packages/core)                         | Framework-neutral state, commands, events, provider contract. |
| [`@reely/provider-native`](packages/provider-native)   | `HTMLMediaElement`: progressive files and native HLS.         |
| [`@reely/provider-hls`](packages/provider-hls)         | HLS via hls.js, or the browser's own, chosen per environment. |
| [`@reely/provider-youtube`](packages/provider-youtube) | YouTube IFrame Player API.                                    |
| [`@reely/provider-vimeo`](packages/provider-vimeo)     | Vimeo player SDK.                                             |

Only `@reely/react` needs installing: it depends on the rest and loads each
provider lazily, once source detection says the active source needs it. A
consumer playing MP4 ships no YouTube, Vimeo or hls.js code in its initial
graph.

## Honesty about providers

The reason for the capability contract is that these four backends do not have
parity, and pretending otherwise moves the surprise from build time to your
users. Every capability answers `available`, `unknown`, or `unavailable` with a
reason, and every provider difference that matters is measured against the real
SDK rather than inferred from its documentation. YouTube will not honour a
quality choice, Vimeo needs a paid plan for chromeless playback, YouTube's
buffered range cannot see buffer loaded before you arrived: each package README
says so, and so does the workbench.

## Docs

The Storybook workbench is the documentation, with every primitive staged
against a mock provider plus real-playback stories:

```sh
pnpm --filter @reely/storybook dev
```

**Overview/Introduction**, **Overview/Contract** (the data-attribute and `style`
contract), **Overview/Capabilities matrix** (what each provider reports),
**Overview/Captions** and **Overview/Theme**.

## Development

```sh
pnpm install
pnpm test              # unit tests (vitest)
pnpm test --coverage   # ... with per-package coverage
pnpm test:e2e          # Playwright, deterministic suites
pnpm test:storybook    # story tests, with axe checks
pnpm typecheck && pnpm lint && pnpm format:check
pnpm build
```

Packaging is verified against real tarballs (`pnpm test:packages`), bundle
budgets are enforced (`pnpm test:budgets`), and a Next.js integration is built
and driven in a browser (`pnpm test:integrations`).

The `@real` e2e tests talk to live YouTube and Vimeo. They are excluded from
every ordinary run and go on a schedule instead, so a third-party outage never
turns an unrelated PR red:

```sh
REELY_REAL_PROVIDERS=1 pnpm test:e2e --project=chromium --grep @real
```

`e2e/visual.spec.ts` runs in its own `visual` Playwright project (chromium
only) and is the one suite that checks how the player _looks_: overlay
layering, containment and overflow, plus five PNG baselines of the reference
example in `e2e/__screenshots__`.

The baselines are generated on `ubuntu-latest` and compared there, because
macOS and Linux render text differently — on macOS those five tests skip and
the layering assertions still run. To refresh them after an intentional visual
change:

```sh
gh workflow run visual-baselines.yml --ref "$(git branch --show-current)"
gh run download <run-id> --name visual-baselines --dir e2e/__screenshots__
```

Then commit the PNGs. A red `visual` CI job uploads the `-actual` and `-diff`
images as a `visual-diff` artifact.

## Browser support

| Browser     | Minimum |
| ----------- | ------- |
| Chrome/Edge | 99      |
| Firefox     | 97      |
| Safari, iOS | 15.4    |

The floor is set by **CSS, not JavaScript**: `theme.css` uses `@layer`, which is
the newest feature anything in Reely requires. The built JavaScript needs nothing
above Safari 14.1, so a consumer who never imports the optional stylesheet is
bound only by that.

`env()`, `forced-colors` and `prefers-reduced-motion` do not raise the floor even
where support arrived later — a media query that never matches simply does not
apply, so they are progressive enhancement rather than requirements.

React 19 is a separate peer requirement (`react` and `react-dom` `>=19 <20`).

The reference example in the workbench uses `@container`, which is newer than
this floor. It is a Storybook composition, not published code — see **Reference
example** in the workbench docs.

## License

[MIT](LICENSE).
