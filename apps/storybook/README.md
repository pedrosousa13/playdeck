# @playdeck/storybook

Component workbench for the Playdeck player. Every story doubles as a
real-browser component test: `@storybook/addon-vitest` runs each one under
Vitest browser mode (Playwright/Chromium), including an axe accessibility
check and a guard that fails the test if anything is requested from outside
the test origin.

## Commands

- `pnpm dev` — workbench at `http://localhost:6006`.
- `pnpm build` — static build (also part of the root `pnpm build`). This is
  what `.github/workflows/deploy-site.yml` assembles into the published artifact
  one segment inside the site, which takes the root of the domain (#519). The
  documents a consumer is sent to are rendered by the site itself, from these
  sources — `apps/site/src/guide-pages.mjs` says which — so the workbench is a
  development tool for this repository rather than the documentation it used to
  be.
- `pnpm test` — run every story as a browser test (root: `pnpm test:storybook`).

The workbench is served from `/storybook/` and never from `/`, so the deploy
sets `PLAYDECK_BASE_PATH` to that prefix and the fixtures under `public/` are
addressed through `stories/asset-url.ts` rather than by a root-absolute
literal. To reproduce the deployed build locally, pass the value the deploy
passes:

```sh
PLAYDECK_BASE_PATH=/storybook/ pnpm build
```

`scripts/check-deploy-artifact.mjs` builds both surfaces this way, assembles the
artifact and drives a browser through it, which is what proves the prefix is
honoured rather than merely configured.

## Story conventions

- Stories live in `stories/<part>.stories.tsx`, titled `Player/<Component>`. A
  composition with a component file of its own keeps both in a subdirectory.
- One story per meaningful component state, named after the state
  (`Dormant`, `Buffering`, ...). New visual states added by later issues get
  their story in the same change.
- Single-component interaction semantics are `play`-function tests using the
  context's `canvas`/`userEvent` plus `expect`/`waitFor` from
  `storybook/test`. `ActivatesOnClick` in `stories/activation.stories.tsx` is
  the reference. Whole-player flows with real media belong in Playwright e2e,
  logic-level tests in plain Vitest — not here.
- Stories must be deterministic and offline: **no story may request anything
  from outside the test origin**, and no external URL may reach the DOM. Use
  data URIs for images that must load or fail, and `/__playdeck__/pending.png`
  (held open forever by a dev-server middleware in `.storybook/main.ts`) for
  permanently-pending loads. The guard in `.storybook/vitest.setup.ts` enforces
  it per story, checking fetch, resource timing, and the URLs the DOM declares.
- `Player.Media` may render only where no source is committed. It returns null
  until activation commits one, so a story that never activates mounts no media
  and an external `source` never reaches the DOM — which is what lets a wrapper
  story pass a real provider URL as an argument. Committing a source loads a
  provider and hits the network, so any story that activates one carries both
  `real-playback` and `!test` — which keeps it out of the automated run. The
  tag pairing is what matters and is enforced by
  `stories/real-playback.contract.test.ts`; the title is not, and such stories
  sit under `Real playback/*` or their own section (`Fixtures/*`) as suits.

## Fixture media

`public/` holds the clips the `Real playback/*` stories play. All are one
second, 30fps and video-only, so they behave identically offline and in CI; the
two MP4s are H.264 with `+faststart`.

- `tracer.mp4` — 320×180 (16:9). It arrived whole in the commit that added it
  and how it was produced is recorded nowhere, which is why the next entry
  exists.
- `tracer.webm` — 320×180 (16:9), 8,863 bytes, VP8. The same clip as
  `tracer.mp4`, transcoded from it, and the reference example offers both as one
  `<source>` set with the MP4 first.

  It exists for engines with no H.264 decoder, and specifically for a locally
  installed Playwright Linux WebKit, which answers `''` for `avc1`. That engine
  does not fail to decode an MP4 — it rejects a `<source type="video/mp4">`
  during source selection and never requests it (`networkState` 3), so a lone
  MP4 left the reference composition stuck at `activation: 'loading-provider'`
  with its control row `hidden` and every e2e test over it failing on the
  arrangement. With the WebM behind it, `e2e/reference.spec.ts` and
  `e2e/rapid-slider-presses.spec.ts` run locally on all three engines. HLS still
  does need the codec, so the HLS swap remains CI-only.

  Reproduce it with:

  ```sh
  ffmpeg -y -i public/tracer.mp4 \
    -c:v libvpx -b:v 48k -deadline best -cpu-used 0 -an \
    public/tracer.webm
  ```

- `tracer-portrait.mp4` — 360×640 (9:16), 8,373 bytes. Added for
  `Real playback/AspectRatio`, which needs a source that is visibly not 16:9.
  9:16 rather than the issue's 1080×1920 because only the ratio is load-bearing
  and a small encode keeps the fixture under 10KB. Reproduce it with:

  ```sh
  ffmpeg -y \
    -f lavfi -i "color=c=0x0b0e13:s=360x640:r=30:d=1" \
    -f lavfi -i "color=c=0x3ea6ff:s=344x24:r=30:d=1" \
    -filter_complex "[0:v]drawbox=x=8:y=8:w=344:h=624:color=0x3ea6ff:t=4[bg];\
  [bg][1:v]overlay=x=8:y='8+(600)*t'[v0];\
  [v0]drawtext=fontfile=/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf:\
  text='9\:16':fontcolor=white:fontsize=88:x=(w-text_w)/2:y=(h-text_h)/2-60,\
  drawtext=fontfile=/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf:\
  text='PORTRAIT':fontcolor=0x3ea6ff:fontsize=40:x=(w-text_w)/2:y=(h-text_h)/2+50[out]" \
    -map "[out]" -c:v libx264 -profile:v high -preset veryslow -crf 30 \
    -pix_fmt yuv420p -an -movflags +faststart \
    public/tracer-portrait.mp4
  ```

  The sweeping bar is an `overlay`, not a `drawbox`: `t` inside a `drawbox`
  expression is the box's thickness, not the timestamp, so the box silently
  lands off-frame and the clip renders as a still.

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

A story whose own component renders `Player.Root` — because a prop of its own
decides the source — cannot be staged through the decorator's root, which that
inner root shadows. Hand the ref from `useMockPlayer` (same module) to the root
the component owns: it stages the same `parameters.player` into that
controller, so both paths share one implementation.

## Theme toggle

The toolbar's **Theme** control (Headless / Themed) switches every story
between the raw primitives and the optional `@playdeck/react/theme.css`. It
defaults to Headless, because that is what the library ships and what most
stories assert. The decorator in `.storybook/theme.tsx` is the only place
the stylesheet is mounted: it renders it as a `<style>` inside the story, so
it is torn down with the story rather than left in the shared preview
document. A story that needs the theme regardless of the toolbar pins itself
with `globals: { theme: 'themed' }` — `stories/theme.stories.tsx` does, on its
meta.
