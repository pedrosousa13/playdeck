# The site's visual system

The direction is **Gamut**. Its palette comes from colour science rather than
from taste: the primaries of a gamut, and one sweep through them. A chromaticity
diagram is a real video concept, which is what separates this from atmosphere.

This document is the prose half of `src/styles/tokens.css`. That file holds the
values; this one holds the reasons and the rules a later page has to obey. Where
the two disagree, the file is right about a number and this document is right
about a rule.

Read this before adding anything to the site. Every rule below exists because
its opposite is what a generated interface looks like.

## The rules

1. **A hex literal appears once**, in the raw scale in `tokens.css`. Role tokens
   point at the scale, components point at the roles. No component writes a
   colour, a font stack, a font size or a duration literal. A missing value is a
   missing token, not a local exception. Syntax highlighting is the one thing
   outside this rule, and it is named as an exception rather than left to be
   discovered — see below.
2. **There is exactly one gradient.** See below.
3. **Functional text never goes below 11px.**
4. **Depth is a surface colour and a hairline. There is no shadow.**
5. **Only `transform` and `opacity` are animated.**

## Palette

Roles, and what each theme assigns them. `--color-*` is what a component reads;
the light and dark columns are the raw scale entries behind it.

| Role                  | Light     | Dark      | Used for                                       |
| --------------------- | --------- | --------- | ---------------------------------------------- |
| `--color-field`       | `#FAFAF8` | `#08080B` | The page                                       |
| `--color-surface`     | `#FFFFFF` | `#131318` | A raised panel                                 |
| `--color-sunken`      | `#F1F1ED` | `#0E0E12` | A recessed well — a switch track, a code block |
| `--color-ink`         | `#131316` | `#F0F0F2` | Body and headings                              |
| `--color-ink-muted`   | `#55555E` | `#A8A8B3` | Secondary prose                                |
| `--color-ink-subtle`  | `#63636C` | `#92929D` | Labels, captions, functional text at 11px      |
| `--color-line`        | `#E3E3DE` | `#26262E` | Hairline separator (decorative)                |
| `--color-line-strong` | `#86867F` | `#6A6A78` | Control boundary (must meet 3:1)               |
| `--color-accent`      | `#1B4FD8` | `#8BACFF` | Links, focus ring, the blue primary            |
| `--color-available`   | `#0B7355` | `#2FD6A0` | Capability: available — the green primary      |
| `--color-unknown`     | `#7D5A00` | `#F0C33C` | Capability: unknown                            |
| `--color-unavailable` | `#C7325E` | `#FF5C8A` | Capability: unavailable — the red primary      |

The dark values are not the light ones inverted. A near-black field swallows
saturated mid-tones, so the accents move up the lightness axis and keep their
hue.

**The three capability states are three points on the sweep**, in sweep order:
available, then unknown, then unavailable. Colour carries domain meaning here, so
it is never spent on decoration — and because colour alone is not a status, each
state is always paired with its word or a shape, never shown as a bare dot.

**Two line tokens, and the difference is obligation rather than weight.**
`--color-line` separates things a reader can already see are separate, so it is
free to be quiet and WCAG asks nothing of it. `--color-line-strong` is the
boundary of a control, or of a swatch whose fill may equal the surface behind
it — the boundary is the information — so it carries the 3:1 that non-text UI
must meet, against all three grounds.

### Three values changed from the design comp

The comp's palette was picked for hue. Three of its entries fail WCAG AA as text,
which is the class of defect that reading a palette cannot catch. Each keeps its
hue and moves only in lightness.

| Role                       | Comp      | Shipped   | Why                                       |
| -------------------------- | --------- | --------- | ----------------------------------------- |
| `--color-available`, light | `#12946A` | `#0B7355` | 3.67:1 on the field, against 4.5 required |
| `--color-unknown`, light   | `#C08A00` | `#7D5A00` | 2.92:1 on the field                       |
| `--color-accent`, dark     | `#1B4FD8` | `#8BACFF` | 2.78:1 on a raised surface                |

`--color-line-strong` has no comp value; it was introduced by this system and
tuned to clear 3:1 directly.

## Measured contrast

Every text-and-ground pair both themes can produce, measured with
`packages/react/test/contrast.ts` — the same WCAG 2.x arithmetic the player's
theme is checked with. Body text needs 4.5:1; the control boundary is non-text
UI and needs 3:1.

There is deliberately **no standing check script** for this. The table is a
record of a measurement, and a value that changes is expected to be re-measured
by whoever changes it, with a throwaway script over these same helpers.

Light theme:

| Foreground            | on field | on surface | on sunken | Needs |
| --------------------- | -------- | ---------- | --------- | ----- |
| `--color-ink`         | 17.74    | 18.54      | 16.38     | 4.5   |
| `--color-ink-muted`   | 7.06     | 7.38       | 6.51      | 4.5   |
| `--color-ink-subtle`  | 5.69     | 5.95       | 5.25      | 4.5   |
| `--color-accent`      | 6.37     | 6.65       | 5.88      | 4.5   |
| `--color-available`   | 5.59     | 5.84       | 5.15      | 4.5   |
| `--color-unknown`     | 6.03     | 6.30       | 5.56      | 4.5   |
| `--color-unavailable` | 4.97     | 5.19       | 4.58      | 4.5   |
| `--color-line-strong` | 3.51     | 3.66       | 3.24      | 3     |

Dark theme:

| Foreground            | on field | on surface | on sunken | Needs |
| --------------------- | -------- | ---------- | --------- | ----- |
| `--color-ink`         | 17.57    | 16.27      | 16.92     | 4.5   |
| `--color-ink-muted`   | 8.49     | 7.86       | 8.18      | 4.5   |
| `--color-ink-subtle`  | 6.50     | 6.01       | 6.26      | 4.5   |
| `--color-accent`      | 8.99     | 8.33       | 8.66      | 4.5   |
| `--color-available`   | 10.71    | 9.92       | 10.32     | 4.5   |
| `--color-unknown`     | 11.98    | 11.09      | 11.54     | 4.5   |
| `--color-unavailable` | 6.81     | 6.30       | 6.56      | 4.5   |
| `--color-line-strong` | 3.76     | 3.48       | 3.62      | 3     |

The tightest pair in the system is light `--color-unavailable` on the sunken
well, at 4.58. It is the comp's own value and it passes, so it stayed — but it
has almost no headroom, and a sunken well that gets any lighter takes it below
AA.

## Type

**IBM Plex Sans and IBM Plex Mono**, one superfamily under the SIL Open Font
Licence, and no third family. Sans carries prose and headings. Mono carries
functional text: a value, an identifier, a state, or machine output — anything
that is not a sentence.

Self-hosted, and the only weights and the only subset the site uses: sans 400,
sans 600, mono 400, latin. They arrive as devDependencies (`@fontsource/*`) so
the faces come through the lockfile with integrity hashes rather than as binaries
committed here, and the build emits the `woff2` files beside its own assets. The
served page makes **no third-party request of any kind**. That is not a
performance preference: this is a library whose headline behaviour is contacting
no provider before a click, and a site that phoned a font host to say so would be
arguing against itself.

The `Applied to` column is what `base.css` actually sets, not a description of
the rung's mood — a heading's size is whatever that file gives its element, and
a page that wants another rung has to ask for it in a class.

| Token        | Size             | Applied to                                    |
| ------------ | ---------------- | --------------------------------------------- |
| `--text-3xl` | 2.75rem (44px)   | `h1`                                          |
| `--text-2xl` | 2rem (32px)      | No element. Opt-in only — see below           |
| `--text-xl`  | 1.5rem (24px)    | `h2`                                          |
| `--text-lg`  | 1.125rem (18px)  | `h3`, and the lead paragraph                  |
| `--text-md`  | 1rem (16px)      | `body`, and so every paragraph                |
| `--text-sm`  | 0.875rem (14px)  | `code`, `kbd`, `samp`, `pre`; secondary prose |
| `--text-xs`  | 0.75rem (12px)   | Captions and table labels, by class           |
| `--text-fn`  | 0.6875rem (11px) | The floor, by class. Functional text only     |

**Nothing defaults to `--text-2xl`.** It is the rung between the page title and
`h2`, and it exists for a page that needs a section title heavier than `h2`'s
default — set it in a class on that page rather than by moving `h2`. The heading
elements keep whatever `base.css` gives them above, which was reviewed as
rendered, so changing what `h2` resolves to is a change to every page at once.

Sizes are in `rem` against the browser's own root size, which is left alone: a
reader who raised their default has said something, and a fixed pixel root
discards it. The pixel figures in the table are therefore what the rungs come
out at when that default is the usual 16px, not fixed measurements.

**`--text-fn` is the floor and the scale has no rung beneath it.** The comps put
reason lines such as `└ browser` at 10.88px, and that is the text carrying the
product's whole argument. Weights are 400 and 600 only. `--tracking-fn` is
applied wherever Plex Mono is — `base.css` sets it on `code`, `kbd`, `samp` and
`pre` along with the face itself — and it opens the tracking slightly rather
than closing it, because mono is already set tight relative to its own width and
functional text at 11px loses more to that than it gains.

## Code, and the one exception to rule 1

The reference pages at `/reference/<package>/` are the package READMEs rendered,
and those documents are mostly code. Colouring it is the one place a colour on
this site comes from somewhere other than `tokens.css`.

The highlighter is **Shiki**, which Astro already ships — no new dependency —
configured in `astro.config.ts` with the `github-light` and `github-dark`
themes. The two names are the exception in full: no hex is written by hand
anywhere, the palette is regenerated from the source text on every build, and
there is no way to express it in this system's own colours, because a scale of
four accents cannot tell a keyword from a string from a comment.

**What the exception does not cover is the block itself.** The well is
`--color-sunken`, which is one of the two things that token exists for. Shiki
emits its theme's background as `--shiki-light-bg` and `--shiki-dark-bg`, and
`base.css` never reads either: a foreign white or near-black panel in a page
whose every other surface is a role token is exactly the seam this system is
built to avoid.

**Which of the two theme colours is spent is an ordinary cascade decision**, in
the same three states and the same order as the role tokens. `defaultColor:
false` is what makes that possible: it stops Shiki writing one theme into a
`color:` declaration on every span — which a stylesheet could then only reach
past with `!important` — and leaves both as custom properties. So the rule in
_Themes_ below holds for code as well as for prose, including the case a lone
`prefers-color-scheme` block gets wrong. A reader who forces light on a
dark-mode machine and gets a dark code block in a light page is what the scoped
selector prevents.

Highlighting colours the fences and changes nothing else about them. That is a
requirement rather than an observation: `scripts/docs-examples.mjs` generates
every marked fence in those READMEs from a real file in `examples/`, and
`pnpm docs:check` compares them byte for byte. A highlighter that re-indented,
re-wrapped or reformatted would put the site and that gate into disagreement
about what the example is.

## The one gradient

`src/components/Sweep.astro` draws the only gradient in the system. It sweeps
blue through green and amber to red — the path a chromaticity diagram traces
round the spectral locus — and its stops are the role tokens rather than colours
of its own, so it re-tunes with the theme and the states it passes through are
literally the state colours.

It is allowed in exactly two forms, and they are the component's `form` prop
rather than something a caller styles:

- `hairline`, the separator between sections;
- `accent`, one band in the hero.

It is **not** a background wash, not a fill behind text, not a border on a card,
and never a second gradient with different stops. Gradients creeping outward
until the page looks like every other generated landing page is the specific
failure this rule exists to prevent. If a design seems to want another one, the
answer is the flat surface tokens.

Its stops are unevenly spaced because the perceptual distance from blue to green
is much larger than from amber to red, and even stops make the warm end read as
one smear.

### It is an SVG, and it must stay one

There is no gradient token, and the sweep is never a CSS background. It is an
inline `<svg>` with a `<linearGradient>` whose `stop-color`s are `var(--color-…)`
references.

The reason is a gate, not a preference. A poster in this library must be a real
`<img>`/`<picture>` element — the player's geometry guarantees and its poster
state machine both depend on that element existing — so a CSS background image is
a regression class. Two halves of one guard enforce that over `apps/**` and
`packages/**`: an AST-based `no-restricted-syntax` block in `eslint.config.js`
for JS and TS, and `e2e/poster.spec.ts`'s "CSS source files do not declare
background images", which scans every stylesheet under those trees. This site is
inside that scope and belongs there — it mounts real players — so it keeps the
guard rather than being carved out of it, and CI fails the moment a stylesheet
here declares one.

Two consequences worth stating outright, because both look like simplifications:

- **The `background` shorthand is not a way out.** It would pass the CSS text
  scan, which matches one literal string, while doing exactly what the guard
  forbids. Reaching for it defeats the gate rather than satisfying it.
- **The separator is a `<div role="separator">`, not an `<hr>`.** `hr` is a void
  element, so the only way to give it the sweep is a CSS background. The role
  keeps the separator announced; the `<svg>` inside is `aria-hidden`, as is the
  hero accent in full, because the sweep is decoration in both forms.

Each rendered sweep gets its own `<linearGradient>` id from a build-wide counter
in `src/components/sweep-id.ts`. Two elements sharing an id is invalid, and the
second `url(#…)` would resolve to the first element rather than its own.

## Themes

Three states, two stored. Tokens are assigned on `:root` (light), reassigned
under `@media (prefers-color-scheme: dark)` scoped away from
`[data-theme="light"]`, and reassigned again under `[data-theme="dark"]`. So an
explicit choice beats the operating system **in both directions** — including the
case a lone media query gets wrong, a reader who picks light on a dark machine.

A reader who has never chosen is represented by the _absence_ of `data-theme`,
not by a stored `light`. That is what keeps the site following a machine that
switches at sunset, and it is why the switch stores a value only on a click.

The attribute is written by a small inline script at the top of the head, before
first paint. A bundled module script is deferred by definition, so it would paint
the light theme and then replace it.

Neither block writes a colour. Both assign `var(--dark-*)` references, so the
values still exist in one place and the two blocks cannot drift apart.

## Depth, motion, and the four audit constraints

A deterministic detector was run against the comps and found real defects. These
are acceptance criteria for anything added to this site, not style advice.

- **No tracked-caps eyebrow chip above an `h1`.** A named tell, and it was on
  every comp.
- **No 1px border under a wide shadow blur** (24px, 60px). That pairing was the
  comps' entire depth system, and it is a named tell too. Depth here is a
  surface colour and a hairline; the system has no shadow token to reach for,
  which is the point.
- **Functional text at 11px or above.** See `--text-fn`.
- **Animate `transform` and `opacity` only.** Never `max-height` or `width`:
  those lay the page out again on every frame, and every effect that seems to
  need them has a composited equivalent — a translate or a scale under
  `overflow: hidden`.

`prefers-reduced-motion: reduce` collapses durations, which lands each transition
on its settled state immediately. That only works because every transition moves
between two settled states. An effect that leaves an element mid-travel or
invisible when its motion is removed is a bug in the effect.

Focus is one treatment for the whole site: a 2px `--color-accent` outline on
`:focus-visible`, offset by 2px. An outline rather than a shadow, so it follows
the element's own shape and survives forced-colors mode.

## Where things live

| File                               | What it is                                   |
| ---------------------------------- | -------------------------------------------- |
| `src/styles/tokens.css`            | Every value. The only file with hex literals |
| `src/styles/base.css`              | Element defaults, spoken in tokens           |
| `src/layouts/Base.astro`           | The document, and the pre-paint theme script |
| `src/components/ThemeToggle.astro` | The control that stores a theme choice       |
| `src/components/Sweep.astro`       | The one gradient, and its two forms          |
| `src/pages/design.astro`           | The specimen sheet, served at `/design`      |
| `src/pages/index.astro`            | The placeholder at `/`, and its links        |
| `src/pages/reference/index.astro`  | The package index, served at `/reference`    |
| `src/pages/reference/[pkg].astro`  | One reference page per publishable package   |
| `src/content.config.ts`            | The READMEs, loaded from `packages/`         |
| `src/reference-packages.mjs`       | Which packages get a page, and from where    |

The reference pages are the site's long-form reading, and the only pages here
whose words are not written in this app: each renders one package's whole
README from `packages/`, word for word. What follows about them is design
decision rather than incident.

**The measure is on the prose and not on the column.** Paragraphs, lists and
quotes are held to `40rem`; code blocks and tables get the full column. A fence
is generated from a real file and this site does not get to decide how long its
lines are, so narrowing it would only add scrolling.

**The table of contents is derived from the rendered headings**, never written
down. A parallel list of section names would go stale the first time somebody
renamed a heading in a README with no idea this page existed, which is the whole
failure the pages exist to avoid. It carries depth 2 and 3: depth 1 is the
document's own title, and depth 4 — which only `packages/react` reaches — would
make a rail that restates an outline rather than one a reader jumps with.

**The version sits at the foot of the rail, not above the title.** A line of
small type on top of an `h1` is the eyebrow this document names as a tell, and
that one would have restated the heading underneath it.

**Two classes of link are re-addressed on the way in, and only two.** A README is
one document read in two places, and a link that is right in the npm tarball can
be wrong here. A target relative to the package directory — `LICENSE` is the one
these documents use — sits beside the README on npm and on GitHub and nowhere
under `/reference/<package>/`, so it is pointed at the file's real home on
GitHub. A link to another package's README, written as a GitHub blob URL because
that is the only address that works from inside a tarball, would send a reader
out to raw Markdown, so it becomes that package's own reference page with its
fragment kept — and only where that package has a page. Everything else is left
as written, including in-page fragments and links to files that are not another
package's README. The rewriting happens in `src/content.config.ts`'s loader,
before the Markdown is parsed, and it steps over fenced blocks: those fences are
generated from `examples/` and compared byte for byte by `pnpm docs:check`, so
nothing inside one may be touched. It is a transform of the source rather than a
copy of it, so editing a README still changes the page.

The specimen sheet at `/design` renders every token in both themes — the type
scale, the surface and ink swatches, the capability colours and both forms of the
sweep — from the tokens themselves rather than from restated values, so a rung or
a role that changed shows the change. It is the living reference a later ticket
checks its work against, and the place to add a specimen when a token is added.

It is not part of the site's own navigation, and `/` links to it only so it is
reachable. The placeholder at `/` is a placeholder: #521 replaces it with the
real landing page, and `/design` stays where it is.

`data-theme` has two writers and they are not interchangeable: the pre-paint
script in `Base.astro` applies a stored choice before the browser paints, and
`ThemeToggle.astro` writes the attribute and the stored value on a click. The
storage key is a literal in both, because an `is:inline` script cannot import
the module that would otherwise hold it.

This system is separate from `@playdeck/react/theme.css`, which is the player's
theme and ships to consumers. That file is layered and zero-specificity because a
stranger's stylesheet has to be able to win against it; nothing here ships
anywhere, so nothing here needs that. The two share no tokens and are not meant
to match.
