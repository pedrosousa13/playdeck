# Playdeck

A performant, composable, accessible React 19 media player with
capability-aware providers.

One API across native MP4/WebM, HLS (VOD and live), YouTube, Vimeo and Wistia.
The primitives are headless — no CSS is imported, nothing is rendered you did
not compose — and every control is gated on what the active provider can
actually do, so a control whose command cannot be honoured is absent rather than
present and disabled.

Install `@playdeck/react`. It is the only package a consumer installs:

```sh
pnpm add @playdeck/react
```

`react` and `react-dom` are peer dependencies, at `>=19 <20`.

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

The primitives set the geometry they need inline, so the player works with no
stylesheet at all — what it lacks is appearance. The default theme is one
optional import:

<!-- example:ignore one import line; the theme.css subpath export and its presence in the tarball are gated by packages/react/test/theme.test.ts -->

```ts
import '@playdeck/react/theme.css';
```

A YouTube or Vimeo source is the same prop and nothing else — no extra package,
no registration: `source="https://www.youtube.com/watch?v=dQw4w9WgXcQ"`,
`source="https://vimeo.com/76979871"`, or `source="https://vimeo.com/76979871?h=<hash>"`
for an unlisted video. Those are three of the forms the detector accepts;
[Provider setup](docs/provider-setup.md) lists every one per provider, names the
forms it refuses, and covers each provider's `providerOptions`.

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
against a mock provider plus real-playback stories. It is published from `main`
at [pedrosousa13.github.io/playdeck](https://pedrosousa13.github.io/playdeck/), so
reading it needs no clone. The
same pages run against your own working tree with:

```sh
pnpm --filter @playdeck/storybook dev
```

[**Overview/Introduction**](https://pedrosousa13.github.io/playdeck/?path=/docs/overview-introduction--docs),
[**Overview/Contract**](https://pedrosousa13.github.io/playdeck/?path=/docs/overview-contract--docs)
(the data-attribute and `style` contract),
[**Overview/Capabilities matrix**](https://pedrosousa13.github.io/playdeck/?path=/docs/overview-capabilities-matrix--docs)
(what each provider reports),
[**Overview/Captions**](https://pedrosousa13.github.io/playdeck/?path=/docs/overview-captions--docs)
and
[**Overview/Theme**](https://pedrosousa13.github.io/playdeck/?path=/docs/overview-theme--docs).

[Provider setup](docs/provider-setup.md) lists the source values each provider
accepts and the ones it refuses, plus each provider's own options.
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
and driven in a browser (`pnpm test:integrations`). That integration serves two
routes: one imports `@playdeck/react` from a `'use client'` component, and one
is a React Server Component that imports it directly and passes no directive of
its own, so the build fails there unless the package carries `'use client'` on
its entry. Its limit is that it depends on `@playdeck/react` through the
workspace protocol, so what it drives is this repository's source rather than an
installed artifact. What a consumer's install resolves to is
`pnpm test:packages`'s subject, and that run reads the directive back out of the
packed tarball rather than out of the working tree.

`pnpm test:packages` installs those tarballs into a fixture it copies to a temp
directory, and replays `tests/packaging/fixture/pnpm-lock.yaml` there so that
install is pinned like every other one in the pipeline (#336). That lockfile is
generated and committed, and the run fails naming the packages it re-resolved
if the two have drifted. Regenerate it after changing the fixture's
dependencies, or after a root advisory floor moves one of them:

```sh
node scripts/verify-packaging.mjs --update-fixture-lockfile
```

Then commit the lockfile.

That fixture is a consumer's project rather than a smoke script: it is
type-checked against the installed tarballs under every resolution setting
these packages claim to support, and under the ones they do not claim — which
have to keep failing, since a setting that ignores export maps cannot reach the
declarations. `scripts/resolution-modes.mjs` holds that set. The fixture also
imports the theme by the subpath the documentation gives consumers, so the
build has to resolve it and the browser check reads it back off the page.

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

## Releasing

A release is cut by hand, from `main`, with `release.yml`. There is no push
trigger: the version bump lands as an ordinary pull request first, and
dispatching the workflow is the separate, deliberate act that publishes it.

The bump is `pnpm version:packages`, which applies the pending changesets, moves
the versions, writes each package's `CHANGELOG.md`, and ends by naming the tags
the release will need. Once that pull request has landed, tag `main` before
dispatching anything:

```sh
pnpm tag:packages
```

One tag per package, named the way changesets names one — `@playdeck/core@0.2.0`
— because these packages version independently, so one repo-wide tag would name
a version most of them are not at. It runs before the publish rather than after
it, so a release that
fails halfway still leaves a tag to diff against, and a second run pushes
nothing. `scripts/release-tags.mjs` carries the rest of the reasoning, including
why the tag is not created by `changeset version` itself and not pushed from the
workflow.

```sh
gh workflow run release.yml --ref main -f dry_run=true   # resolve and pack only
gh workflow run release.yml --ref main -f dry_run=false  # publish
```

`dry_run` defaults to true, so an accidental dispatch cannot publish. Either way
the job runs `typecheck`, `test`, `test:audit`, `build`, `test:packages`,
`test:budgets`, `test:bundle` and `test:integrations` before it goes near the
registry, so the provenance attestation covers artifacts that run actually
checked.

Every package ships its own `CHANGELOG.md`, so an installed copy carries the
history of the version installed rather than sending its reader back to GitHub.
`test:packages` fails a tarball that carries no changelog, or one whose
changelog does not name the version being packed.

The publish is `pnpm publish -r`, never `npm publish`: the packages depend on
each other through pnpm's `workspace:^` protocol, and only pnpm rewrites that to
a real version range when it packs. `-r` takes every workspace package that is
not `private` and whose version is not already on the registry, so the set comes
from the manifests and no name is listed in the workflow.

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

React is a separate peer requirement rather than a browser one; its range is
given with the [install command](#playdeck) at the top of this file.

The reference example in the workbench uses `@container`, which is newer than
this floor. It is a Storybook composition, not published code — see
[**Overview/Reference example**](https://pedrosousa13.github.io/playdeck/?path=/docs/overview-reference-example--docs)
in the workbench docs.

## License

[MIT](LICENSE).
