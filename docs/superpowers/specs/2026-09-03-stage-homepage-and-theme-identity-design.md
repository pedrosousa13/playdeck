# A stage for the player, and a new identity for both themes

## What this amends

`2026-09-02-player-themes-design.md` gave `@playdeck/react` two standalone
stylesheets over one control bar, and `2026-09-02-bench-two-themes-design.md`
put a switch between them on `/`. Both shipped. On 2026-09-03 the maintainer
asked for the page and the themes to be remade as a marketing page that sells
the player to React developers: the player featured as it is, the themes
redrawn with a new identity, the page made to "pop", and four features
advertised: composability, customisability, capability querying, and autoplay
recovery.

Every ruling of the two specs above and of
`2026-08-31-landing-page-bench-542-design.md` stands unless this document
names it. In particular:

- No capability table, grid, list, or one-line report on `/`. The word
  "ledger" appears nowhere.
- No autoplay demonstration on `/`. The bench mounts with
  `loading="interaction"`, so a refusal cannot be shown there. Autoplay
  recovery is **advertised** in a feature card with its real prop name. That
  is a claim, not a demonstration, and the maintainer confirmed on 2026-09-03
  that advertising is what was asked.
- No claim about any other library.
- The archetypes stay on `/archetypes` (as of 2026-09-04, the page is
  `/examples/`; the ruling itself — the archetypes stay off `/` — is
  unchanged, and now reads against that route).
- The two sheets stay standalone. Shared rules are duplicated, never imported.
- The two sheets differ in layout on desktop, not only in colour.
- Nothing is pushed until the maintainer has seen the page running.

## What was asked and settled

| Question                                   | Ruling                                                                                    |
| ------------------------------------------ | ----------------------------------------------------------------------------------------- |
| Start from the earlier theme previews?     | No. Start from the two sheets as they exist.                                              |
| Capability querying and autoplay on `/`    | Advertised as features in cards. Not demonstrated. Rulings above stand.                   |
| "Mobile has controls below video (docked)" | `theme.css` itself docks its bar below the picture under 48rem. The bench is unchanged.   |
| How far the theme look moves               | New identity. Token names kept so consumer overrides keep working.                        |
| Page scope                                 | Everything, the bench included, within the rulings.                                       |
| What "pop" means                           | Motion, colour, type, and depth, all four.                                                |
| Page direction                             | A, "The Stage": the player lit on a stage under one big line, four feature cards after.   |
| Control bar direction                      | 2, "Edge bar": no container, controls on the scrim, the seek bar as the hero.             |
| Colour scheme of `/`                       | Follows the site's header toggle. Not always dark.                                        |
| Docked theme on desktop                    | Same visual language as the floating theme, drawn in the page's scheme under the picture. |
| Bench signal on a switch flip              | The changed composition lines highlight briefly; the stage crossfades.                    |
| Feature order                              | Compose, Style, Query, Recover.                                                           |
| The close                                  | Replaced: one large install command, one line of measured facts, the links.               |
| Bar fades when not interacted with         | Kept. The maintainer restated it on 2026-09-03.                                           |
| Who implements                             | Sonnet subagents, one task each. The orchestrating session reviews every diff.            |

## The floating theme, `theme.css`

The bar sits on the scrim at the foot of the picture, with no container of
its own. Two rows out of one `controls` part, by the same `flex-wrap` and
`flex: 1 1 100%` mechanism the sheet already uses.

**Scrim.** `--playdeck-overlay-scrim` keeps its name and its gradient shape,
`linear-gradient(to top, …)`, deepened to about 78% black at the bottom and
made taller by moving the transparent stop up, so the thicker seek bar and
the larger hit targets sit on enough dark to keep the 3:1 slider boundaries.

**Seek bar.** `--playdeck-slider-thickness` moves from `0.25rem` to
`0.375rem` (6px). On `:hover` and `:focus-within` of the `seek-slider` part
the thickness grows to `0.5rem` (8px) by redeclaring the custom property on
that part, so every rule that reads it follows. The fill (`seek-progress`) is
`linear-gradient(to right, var(--playdeck-color-accent), var(--playdeck-color-accent-tint))`,
where `--playdeck-color-accent-tint` is a new token defaulting to a lighter
tint of the accent. `linear-gradient` is already in the sheet's pinned
function list. The thumb is hidden at rest (`inline-size: 0; block-size: 0`
on the `::-webkit-slider-thumb` and `::-moz-range-thumb` rules with the
opacity kept at 1, so it still receives pointer events on the track) and
becomes 16px under the same hover and focus conditions. It grows by size, not
by `transform: scale()`, because `scale` is not a pinned function and the
sheet has no reason to add one. The existing contrast ring stays on the
thumb.

**Buttons.** 44px hit target and 20px icon, unchanged. Hover fill
`--playdeck-control-hover` with `--playdeck-radius` corners raised to
`0.625rem`. A pressed state, `:active`, one step darker via a second token
`--playdeck-control-pressed`, defaulting to `rgb(255 255 255 / 0.2)`. Focus
stays the existing visible outline.

**Times.** `font-variant-numeric: tabular-nums`. The `duration` instance and
the consumer's separator get `opacity: 0.64`. The current time stays at full
ink.

**Auto-hide.** Unchanged in mechanism: `[data-idle='true']` fades the
`controls` part to `opacity: 0` and removes its pointer events, and
`:focus-within` holds it visible. The transition is 200ms. Under
`prefers-reduced-motion: reduce` the transition goes, the behaviour stays.

**Docking under 48rem.** New. Inside the existing `@media (max-width: 48rem)`
block, which today only flattens the scrim and drops the volume slider, the
sheet moves the bar into its own grid row under the picture, the same rows
rule `docked.css` uses on the `viewport` part. The scrim goes, the
`data-idle` rules are overridden back to `opacity: 1` and `pointer-events:
auto` so nothing hides on a phone, and the bar's colours come from the
scheme tokens: `--playdeck-color-surface`, `--playdeck-color-on-surface`,
`--playdeck-color-track`, `--playdeck-color-buffered`, and the new
`--playdeck-color-hairline` for the 1px top border, each with the same
light default `docked.css` uses and the same dark default under
`@media (prefers-color-scheme: dark)`. The sheet gains a second `@media`
query string, `(prefers-color-scheme: dark)`, which the feature inventory
test does not pin. The volume slider stays hidden on coarse pointers.

`test/theme.test.ts`'s existing `flattens the scrim and drops the volume
slider below 48rem` test asserts the exact contents of the sole
`(max-width: 48rem)` block, including a `background:` fallback that this
design removes. That test is rewritten, not extended, to assert the docked
row, the scheme-token colours, and the `data-idle` override.

**Cut from the mockup.** A hover time tip and a centre play glyph on pause.
Neither has a part the primitives emit, and a theme does not add components.

## The docked theme, `docked.css`

Same seek bar, thumb, hover fill, pressed state, icon size, radius, and
times as above, drawn under the picture in the page's scheme. The top
hairline stays. No auto-hide, and the sheet still never reads `data-idle`.

The fill gradient needs `linear-gradient` added to the sheet's pinned
function list in `test/theme.test.ts`, which is a one-entry change and is
inside the support floor.

## Colour

Both sheets read the same token names, and the site already sets its own
values on `<html>` via `data-theme`, so the header toggle recolours the
docked bar and the phone-docked floating bar with no page code. The desktop
floating bar is over the picture in both schemes and keeps white ink on the
dark scrim.

The player family gets one accent, `--playdeck-color-accent`, a more
saturated blue than the docs use for links. Its default in `theme.css` stays
`#3ea6ff`, which already clears the pinned boundaries against the ring and
the backdrop. `docked.css` keeps its light and dark accent defaults. The new
`--playdeck-color-accent-tint` defaults to `#9dd0ff` in `theme.css` and to a
lighter tint of each scheme's accent in `docked.css`. The measured ratios in
`test/theme.test.ts` are recomputed with the same script that computed the
current ones, and the assertions on the 3:1 floor stay. If any boundary
falls under the floor with the new scrim depth, the scrim is deepened, not
the assertion loosened.

## Budget

`scripts/bundle-budgets.mjs` budgets each sheet's rules at 2.5 kB gzipped.
Measured on 2026-09-03: `theme.css` rules 2.00 kB, `docked.css` rules
2.15 kB. The docking rules are a real cost. The implementation measures
after each task. If a sheet exceeds 2.5 kB, its budget is raised to 3.0 kB
in the same commit that exceeds it, with the reason in the commit message.
The design is not thinned to fit.

## The page

One column, `max-inline-size: 72rem`, everything set against the left edge
except the stage, which spans the full measure. Sequence: hero, stage,
switch row, composition, four cards, close.

**Hero.** The `h1` stays exactly `Playdeck` and small, since
`scripts/check-deploy-artifact.mjs` and `e2e/site-nav.spec.ts` identify the
page by it. The display line under it at `--text-4xl` from 48rem up, in the
condensed display face, one phrase in `--color-accent`. The lede under that.
Then the install command with its copy button, and a Start link. The
install block moves here from the close and keeps `data-install`,
`data-install-command`, `data-install-copy`, and `data-install-status`, so
`e2e/site-landing.spec.ts`'s copy tests hold.

**Stage.** `Bench.astro`'s frame gets a soft accent glow behind it, drawn as
a `radial-gradient` on a pseudo-element of `.bench__frame` in
`--color-accent` at low alpha, a 1px ring in `--color-line`, and a deep drop
shadow. The pinned function list applies to the package sheets only, not to
the site's own CSS. The existing `Sweep` under the picture stays.

**Switch row.** `BenchSwitches` keeps its `fieldset`, `legend`, and radio
`label` markup, and every `data-bench-switch` and `data-value` hook. The
labels are restyled as segmented pills: one rounded container per group in
`--color-sunken` with a `--color-line` border, the chosen position filled
in `--color-ink` with `--color-surface` text. The two groups and the quiet
line (`.bench__quiet`) sit in one flex row under the stage, the quiet line
pushed to the end. The skin group stays `hidden md:block`, and `BenchIsland`
keeps mounting `docked` at rest under 48rem, unchanged.

**Composition.** `CompositionPanel` moves to a full-width row under the
switch row. It keeps `data-bench-composition` and its Shiki HTML. On a
switch flip, `BenchIsland` diffs the previous and next composition strings
line by line and passes the changed line indices down; the panel sets
`data-changed` on those `.line` spans, and site CSS gives them a
`--color-accent` background at low alpha that transitions to transparent
over 900ms. The attribute is removed after the transition by a timeout in
the panel, so a second flip restarts the highlight. The stage crossfades:
`.bench__stage` gets `opacity` 0.6 to 1 over 240ms keyed on a
`data-skin` attribute change. Under `prefers-reduced-motion: reduce` the
changed lines get the background with no transition and the stage does not
fade.

**Four cards.** A grid of four at 48rem and up, one column below. Each card
is a numbered label in the mono face, a headline in the display face, two
lines in `--color-ink-muted`, a Shiki-highlighted snippet built at build
time by the same `shiki.ts` helper the composition uses, and a link. Draft
copy, to be corrected at review:

| No. | Headline                      | Lines                                                                                                                 | Snippet                                                                                  | Link                           |
| --- | ----------------------------- | --------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- | ------------------------------ |
| 01  | Compose it                    | Every control is a component. Reorder them, drop one, put your own between them.                                      | `<Player.Controls>` with `<Player.PlayButton />`, a consumer `<Logo />`, `<Player.Time>` | `/reference/`                  |
| 02  | Style it                      | No CSS ships in the bundle. Two authored themes, or write your own against stable part names.                         | `[data-playdeck-part='play-button'] { … }`                                               | `/design/`                     |
| 03  | Ask before you render         | Every provider declares what it can do. A control it cannot honour renders nothing, and you can read the same answer. | `usePlayerState((s) => s.capabilities.pictureInPicture)`                                 | `/guides/capabilities-matrix/` |
| 04  | Recover from refused autoplay | Ask for sound. If the browser refuses, the player retries muted once and tells you, so you can draw the unmute.       | `<Player.Root autoplay="audible-then-muted">`                                            | `/reference/`                  |

Every name in a snippet is a real export or prop: `usePlayerState` and
`capabilities` from `packages/react/src/index.tsx` and
`packages/core/src/types.ts`, `AutoplayMode`'s `'audible-then-muted'` from
`packages/core/src/types.ts`. Card 03 is not a capability table: it names
one hook and no provider.

**The close.** The four figures go. A large repeat of the install command,
then one line of measured facts read from `measureBundles`, as the page
already does: the primitives' gzipped size, the cost of adding YouTube, and
"0 requests to a provider before play". Then the links: Start, Reference,
Providers, Archetypes. "Unstyled by default" and "one adapter, not five"
now live in cards 02 and 01.

**Motion.** One entrance: the hero text and the stage rise 12px and fade
in, staggered by 80ms, once, on load, driven by CSS animation with no
scroll observer. Cards lift 2px on hover. All motion is inside
`@media (prefers-reduced-motion: no-preference)`, and the entrance is
additionally keyed on `html[data-entered]`, an attribute a two-line inline
script in `index.astro` sets before first paint. With no script the
attribute is never set, the elements render at their resting opacity and
transform, and nothing animates. This is what keeps
`e2e/site-landing.spec.ts`'s two "settled and readable" tests passing
unchanged: the no-JavaScript one because the attribute is absent, and the
reduced-motion one because the media query excludes it. Neither test
polls, so the animation must never be observable in either condition.

**Type.** The display face and the `--text-4xl` rung already exist in
`tokens.css`. No new font is loaded.

## What gets deleted

- `index.astro`'s `figures` array and the `.figures` and `.figure` styles.
- `BenchIsland.tsx`'s two-column grid (`md:grid-cols-2`) that placed the
  switches beside the composition. `Bench.astro`'s own `.bench__frame` grid,
  which stacks the picture over the docked bar, stays.

## Amendments to DESIGN.md

A section recording this spec's rulings from the table above, the new
tokens (`--playdeck-color-accent-tint`, `--playdeck-control-pressed`,
`--playdeck-color-hairline` in `theme.css`), the budget rule, and that the
four feature cards are advertising and not the capability argument. The
"autoplay recovery are not sold on `/` at all" sentence is amended to say it
is advertised, not demonstrated.

## Verification

- `packages/react/test/theme.test.ts` passes against both sheets with the
  pinned function list, token list, and measured ratios updated to the new
  values. The 3:1 and 4.5:1 floors are asserted as before.
- `pnpm test:budgets` passes, with any raised budget in the same commit.
- `e2e/site-landing.spec.ts`, `e2e/site-bench.spec.ts`, and
  `e2e/site-quiet.spec.ts` pass unchanged, because every selector they use
  is kept.
- One new test in `e2e/site-bench.spec.ts`: after a skin flip, at least one
  `[data-changed]` line exists in the composition, and none exists after
  1500ms.
- One new test in `e2e/site-landing.spec.ts`: the four cards are present
  with their numbered labels in order.
- A new theme test: under a 375px viewport `theme.css` places the controls
  part in a grid row of its own below the media, and `data-idle='true'`
  does not hide it.
- Screenshots at 375, 768, and 1440, both schemes, both skins, at rest and
  after a switch flip, saved to the scratchpad and shown to the maintainer.
  Nothing is pushed before that.

## Open questions

None. Copy in the cards is a draft and is corrected at the screenshot
review.
