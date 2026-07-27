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

## License

[MIT](LICENSE).
