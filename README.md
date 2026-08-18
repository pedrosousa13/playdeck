# Playdeck

A performant, composable, accessible React 19 media player with
capability-aware providers.

One API across native MP4/WebM, HLS (VOD and live), YouTube, Vimeo and Wistia.
The primitives are headless — no CSS is imported, nothing is rendered you did
not compose — and every control is gated on what the active provider can
actually do, so a control whose command cannot be honoured is absent rather than
present and disabled.

<!-- example:quickstart -->

```tsx
import * as Player from '@playdeck/react';

// One API across MP4/WebM, HLS, YouTube, Vimeo and Wistia: the source decides
// which provider loads, and nothing else changes.
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

| Package                                                   | What it is                                                    |
| --------------------------------------------------------- | ------------------------------------------------------------- |
| [`@playdeck/react`](packages/react)                       | The React primitives. Start here.                             |
| [`@playdeck/core`](packages/core)                         | Framework-neutral state, commands, events, provider contract. |
| [`@playdeck/provider-native`](packages/provider-native)   | `HTMLMediaElement`: progressive files and native HLS.         |
| [`@playdeck/provider-hls`](packages/provider-hls)         | HLS via hls.js, or the browser's own, chosen per environment. |
| [`@playdeck/provider-youtube`](packages/provider-youtube) | YouTube IFrame Player API.                                    |
| [`@playdeck/provider-vimeo`](packages/provider-vimeo)     | Vimeo player SDK.                                             |
| [`@playdeck/provider-wistia`](packages/provider-wistia)   | Wistia's Aurora `<wistia-player>` element.                    |

Only `@playdeck/react` needs installing: it depends on the rest and loads each
provider lazily, once source detection says the active source needs it. A
consumer playing MP4 ships no YouTube, Vimeo, Wistia or hls.js code in its
initial graph.

## Honesty about providers

The reason for the capability contract is that these five providers do not have
parity, and pretending otherwise moves the surprise from build time to your
users. Every capability answers `available`, `unknown`, or `unavailable` with a
reason, and every provider difference that matters is measured against the real
SDK rather than inferred from its documentation. YouTube will not honour a
quality choice, Vimeo needs a paid plan for chromeless playback, YouTube's
buffered range cannot see buffer loaded before you arrived, Wistia reports no
buffered range at all: each package README says so, and so does the workbench.
The same honesty applies to the network: see
[Third-party requests and CSP](docs/third-party-requests.md) for every origin a
provider reaches and what a page's Content-Security-Policy has to allow for it.

## Docs

The Storybook workbench is the documentation, with every primitive staged
against a mock provider plus real-playback stories:

```sh
pnpm --filter @playdeck/storybook dev
```

**Overview/Introduction**, **Overview/Contract** (the data-attribute and `style`
contract), **Overview/Capabilities matrix** (what each provider reports),
**Overview/Captions** and **Overview/Theme**.

[Third-party requests and CSP](docs/third-party-requests.md) names every
origin a provider reaches and when each request happens.

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

The `@real` e2e tests talk to live YouTube, Vimeo and Wistia. They never run in
CI, and there is no scheduled run either (#118): YouTube will not serve video to
a runner's datacenter IP, so the result reported its opinion of that IP rather
than whether our adapters are correct. Vimeo and Wistia still play there, but
they run on the same goodwill, so they go the same way. Run them by hand when
you touch a provider adapter:

```sh
PLAYDECK_REAL_PROVIDERS=1 pnpm test:e2e --project=chromium --grep @real
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
images as a `visual-diff` artifact, which is also where the images come from
when the refresh workflow is not dispatchable — GitHub only offers
`workflow_dispatch` for workflows already on the default branch, so a workflow
file added on a branch cannot be run until it has merged once.

## Browser support

| Browser     | Minimum |
| ----------- | ------- |
| Chrome/Edge | 99      |
| Firefox     | 97      |
| Safari, iOS | 15.4    |

The floor is set by **CSS, not JavaScript**: `theme.css` uses `@layer`, which is
the newest feature anything in Playdeck requires. The built JavaScript needs nothing
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
