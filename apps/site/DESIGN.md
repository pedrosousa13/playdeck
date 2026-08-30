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
4. **Depth is a step on the surface ladder, a hairline, or one of two
   elevations — and an elevated surface never also carries a border.** See
   below.
5. **Only `transform` and `opacity` are animated.**

Rules 1 and 5 govern what this app writes. The two archetype stylesheets
mounted on `/archetypes` are outside both, and that is named here rather than
left to be found — see _The archetypes, and why they are outside rules 1 and 5_
below.

## Palette

Roles, and what each theme assigns them. `--color-*` is what a component reads;
the light and dark columns are the raw scale entries behind it.

| Role                  | Light     | Dark      | Used for                                       |
| --------------------- | --------- | --------- | ---------------------------------------------- |
| `--color-field`       | `#FAFAF8` | `#08080B` | The page                                       |
| `--color-surface`     | `#FFFFFF` | `#131318` | A raised panel                                 |
| `--color-raised`      | `#FFFFFF` | `#17171D` | A surface on a surface — a row, an inner card  |
| `--color-overlay`     | `#FFFFFF` | `#1B1B22` | A surface over the page — a dialog, a popover  |
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

**The surface ladder is asymmetric between the themes, and that is a fact about
the colour space rather than an omission.** In light the rungs run
`--color-sunken` `#F1F1ED` → `--color-field` `#FAFAF8` → `--color-surface`
`#FFFFFF`, and the top rung is white: no value exists above it, and a step
_down_ from a panel would read backwards — a raised thing dimmer than what it
sits on. So light has no `--light-raised` and no `--light-overlay` in the raw
scale, and both roles resolve to `--light-surface`. Dark has the room, and the
two new raw entries take it: `--dark-raised` `#17171D` and `--dark-overlay`
`#1B1B22`.

What makes the collapse acceptable rather than a hole is that `--color-raised`
is still a real step in light wherever it sits on `--color-field` — 1.045, the
same as the light `--color-field` → `--color-surface` step. It collapses only in
the one case where a raised surface sits directly on `--color-surface`, and that
case is what the two elevations and the hairline are for. Depth was never only a
colour here.

**The dark rungs were chosen by measurement, not by eye.** The ladder already
steps 1.038 from field to sunken and 1.040 from sunken to surface; surface to
raised is 1.038 and raised to overlay is 1.042. They sit in the same band as the
steps the system already spends, which is the whole argument for their size —
a new rung sized to be noticed would have said the old ones were too quiet.
**The ceiling is around `#1F1F26`**, and it is `--color-line-strong` that sets
it: at that value the control boundary falls to 3.08 and a third rung stops
being available at all. `#24242C` was tried and rejected — line-strong measures
2.89 against it, below the 3:1 a control boundary owes. That figure is recorded
here so nobody re-derives it, and it is why depth above the overlay is an
elevation rather than a lighter surface.

**The three capability states are three points on the sweep**, in sweep order:
available, then unknown, then unavailable. Colour carries domain meaning here, so
it is never spent on decoration — and because colour alone is not a status, each
state is always paired with its word or a shape, never shown as a bare dot.

**Two line tokens, and the difference is obligation rather than weight.**
`--color-line` separates things a reader can already see are separate, so it is
free to be quiet and WCAG asks nothing of it. `--color-line-strong` is the
boundary of a control, or of a swatch whose fill may equal the surface behind
it — the boundary is the information — so it carries the 3:1 that non-text UI
must meet, against all five grounds. It was three until the ladder grew two
rungs; it still clears 3:1 against every one of them, and where it would stop
clearing it is what fixes the ladder's ceiling above.

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

The two grounds the ladder gained sit in tables of their own rather than as two
more columns above, because in light they are not a second measurement: both
grounds are `#FFFFFF`, so both columns repeat the `on surface` column exactly.
That repetition is the point rather than an artefact of the layout — it is the
collapse the palette section describes, stated in the arithmetic — and a pair of
identical columns wedged into the light table would have read as a copying
mistake instead.

Light theme, on the two new grounds:

| Foreground            | on raised | on overlay | Needs |
| --------------------- | --------- | ---------- | ----- |
| `--color-ink`         | 18.54     | 18.54      | 4.5   |
| `--color-ink-muted`   | 7.38      | 7.38       | 4.5   |
| `--color-ink-subtle`  | 5.95      | 5.95       | 4.5   |
| `--color-accent`      | 6.65      | 6.65       | 4.5   |
| `--color-available`   | 5.84      | 5.84       | 4.5   |
| `--color-unknown`     | 6.30      | 6.30       | 4.5   |
| `--color-unavailable` | 5.19      | 5.19       | 4.5   |
| `--color-line-strong` | 3.66      | 3.66       | 3     |

Dark theme, on the two new grounds:

| Foreground            | on raised | on overlay | Needs |
| --------------------- | --------- | ---------- | ----- |
| `--color-ink`         | 15.68     | 15.04      | 4.5   |
| `--color-ink-muted`   | 7.58      | 7.27       | 4.5   |
| `--color-ink-subtle`  | 5.80      | 5.56       | 4.5   |
| `--color-accent`      | 8.02      | 7.70       | 4.5   |
| `--color-available`   | 9.56      | 9.17       | 4.5   |
| `--color-unknown`     | 10.69     | 10.25      | 4.5   |
| `--color-unavailable` | 6.08      | 5.83       | 4.5   |
| `--color-line-strong` | 3.35      | 3.22       | 3     |

**The three capability colours clear AA against both new surfaces in both
themes**, and that is checked rather than assumed. Colour carries domain meaning
on this site, and a ladder that had flattened available, unknown and unavailable
against a new ground — or taken any of them under 4.5 — would have broken the
site's central claim on whichever panel first used one. The lowest of the
capability figures in either table is `--color-unavailable` at 5.19 on the light
pair, which is the number the light `on surface` column already carried.

The tightest new pair is dark `--color-line-strong` on the overlay, at 3.22.
That is the measurement the ladder's ceiling is derived from: it clears the 3:1
a control boundary owes, and the next rung up would not.

The tightest text pair in the system is still light `--color-unavailable` on the
sunken well, at 4.58. It is the comp's own value and it passes, so it stayed —
but it has almost no headroom, and a sunken well that gets any lighter takes it
below AA.

**Selected text is `--color-field` on `--color-accent`**, which is the same two
colours as the accent row of the table above with the ground and the ink
swapped, and contrast is symmetric: 6.37 in light, 8.99 in dark. So the
selection needed no token of its own and moves nothing in the table. See
_Browser surfaces_ below for why it sets `color` as well as a background.

**The scrollbar thumb is `--color-line-strong`**, on whichever of the five
grounds it happens to be scrolling. That is the row the tables already carry at
3.51 / 3.76 against the field, and a thumb is non-text UI, so 3:1 is what it
owes.

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
| `--text-4xl` | 5.5rem (88px)    | No element. Opt-in only — see below           |
| `--text-3xl` | 2.75rem (44px)   | `h1`                                          |
| `--text-2xl` | 2rem (32px)      | No element. Opt-in only — see below           |
| `--text-xl`  | 1.5rem (24px)    | `h2`                                          |
| `--text-lg`  | 1.125rem (18px)  | `h3`, and the lead paragraph                  |
| `--text-md`  | 1rem (16px)      | `body`, and so every paragraph                |
| `--text-sm`  | 0.875rem (14px)  | `code`, `kbd`, `samp`, `pre`; secondary prose |
| `--text-xs`  | 0.75rem (12px)   | Captions and table labels, by class           |
| `--text-fn`  | 0.6875rem (11px) | The floor, by class. Functional text only     |

**Nothing defaults to `--text-2xl` or to `--text-4xl`**, and both are opt-in for
the same reason. `--text-2xl` is the rung between the page title and `h2`, for a
page that needs a section title heavier than `h2`'s default. `--text-4xl` is the
display rung above `h1`, for a page whose title is a thesis rather than a
document's name. Set either in a class on that page rather than by moving the
element: the heading elements keep whatever `base.css` gives them above, which
was reviewed as rendered, so changing what `h1` or `h2` resolves to is a change
to every page at once — including the reference documents, whose titles are
package names and want no display treatment at all.

**The display rung is what the `argument` stance spends and the `document`
stance does not.** That is now sayable in one word where it used to take a
sentence about which page: `/` is the only route served in the `argument`
stance — see _Stances_ below — and it is the only page that spends either of
these two rungs on a heading of its own. A document page's title names the
document — a package, a provider, this sheet — and no stance in this system
dresses a name as a thesis.

That page's `h1` steps up to `--text-4xl` at `48rem` and keeps `h1`'s own rung
below that, where 88px would take three quarters of a phone's width and cost
the lead its first screen. A step between two rungs of this scale rather than a
`clamp()`, because a clamp is a font size written into a component and no
component here writes one. `/design` renders a specimen at every rung, these two included, which is
the same exemption a specimen sheet already has for both forms of the sweep: it
is showing the scale, not spending it.

Sizes are in `rem` against the browser's own root size, which is left alone: a
reader who raised their default has said something, and a fixed pixel root
discards it. The pixel figures in the table are therefore what the rungs come
out at when that default is the usual 16px, not fixed measurements.

Three non-colour values are tokens because more than one component wants them,
and each is named for what it does rather than for where it was first needed:

| Token              | Value    | What it is                                         |
| ------------------ | -------- | -------------------------------------------------- |
| `--tracking-fn`    | 0.01em   | Opens Plex Mono. Applied wherever the mono is      |
| `--tracking-tight` | -0.015em | Closes Plex Sans set large: headings, the wordmark |
| `--measure`        | 42rem    | The inline size prose is held to                   |
| `--hit-target`     | 2.75rem  | The smallest comfortable pointer target            |

**The measure is a property of a paragraph, not of a page.** `--measure` holds
prose — the reference documents' paragraphs, lists and quotes, and the lead on
the package index. It was chosen to put a line at the body rung inside the 65–75
character band, so a page that sets prose at another rung is choosing a
different character count and says so where it does it. A page's own maximum
width is a separate decision and stays a literal where that decision is made:
`72rem` at `/`, `64rem` on `/archetypes`, `46rem` on `/design`, `52rem` on each
of the two indexes — written twice, once in `src/pages/reference/index.astro`
and once in `src/pages/providers/index.astro`, because two pages agreeing on a
number is not the same fact as one number. The `74rem` rail-and-document shell
is the exception and lives in `src/styles/doc.css`: the reference pages and the
provider pages are one page shape rendered from two sources, so their width is
one decision and the stylesheet they already share is where it belongs. One
column width is not evidence about another, and a shared token would claim it
was.

**`--text-fn` is the floor and the scale has no rung beneath it.** The comps put
reason lines such as `└ browser` at 10.88px, and that is the text carrying the
product's whole argument. Weights are 400 and 600 only. `--tracking-fn` is
applied wherever Plex Mono is — `base.css` sets it on `code`, `kbd`, `samp` and
`pre` along with the face itself — and it opens the tracking slightly rather
than closing it, because mono is already set tight relative to its own width and
functional text at 11px loses more to that than it gains.

## Code, and the one exception to rule 1

The reference pages at `/reference/<package>/` are the package READMEs rendered,
and those documents are mostly code; two of the provider setup pages at
`/providers/<provider>/` carry a highlighted code example, because
`docs/provider-setup.md` writes one for YouTube and one for Vimeo and none for
the other three. No provider page mounts a player — the hero island is still
the site's only one. The landing page carries one block of code too, the
composition example. Colouring it is the one place a colour on this site comes
from somewhere other than `tokens.css`.

The highlighter is **Shiki**, which Astro already ships — no new dependency —
set to the `github-light` and `github-dark` themes. The two names live in
`src/shiki.ts` and are read twice: `astro.config.ts` hands them to
`markdown.shikiConfig` for the READMEs' fences, and the landing page hands them to
Astro's `<Code>` component, which reads nothing from that configuration. The two
names are the exception in full: no hex is written by hand
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

## The archetypes, and why they are outside rules 1 and 5

`/archetypes` mounts `examples/archetype-streaming-service.tsx` and
`examples/archetype-course-platform.tsx`. Each carries its own stylesheet as a
`<style>` element inside the component, and each writes hex literals by the
dozen and animates `background-color`. Read against rules 1 and 5 those are
violations; they are allowed, and the reason is what the page is for.

Those two files are not this app's. They live in `examples/`, they are the
files a consumer copies, and `apps/storybook` mounts the same two. A stylesheet
spoken in `tokens.css`'s role tokens would render as unstyled text everywhere
outside this one site, and an archetype that borrowed its look from the page
around it would be proving something about this page rather than about the
library. The point of mounting them here is that the site and the workbench show
the same player; that is only true if the appearance travels with the
composition.

So the boundary is ownership rather than taste: a file under `apps/site/src`
writes no colour and animates nothing but `transform` and `opacity`. A file
under `examples/` is a consumer's code that this site happens to render, and it
answers to `examples/`'s own constraints — one paste, no imports, no design
system. `/archetypes` itself, everything around the two players, is inside the
rules like every other page.

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

**"Exactly one" is a count of renders and not only a count of stops.** The rule
was read for a while as a licence to place the hairline after every section,
and `/` shipped five of them plus the hero band. Six sweeps down one page is the
creep this rule exists to stop, drawn from the one component that was supposed
to make it impossible. So the landing page now renders the sweep once — the
hero band — and separates its sections with `--space-9` and nothing else. Where
a page genuinely needs a line, `--color-line` is the line; the sweep is not a
general-purpose separator that happens to be pretty. `/design` is the exception
that proves nothing, because a specimen sheet's job is to show both forms.

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

## Stances

A marketing page and a reference document have different jobs, and pretending
otherwise costs one of them. So a page declares which of two treatments it is
served in. `Base.astro` takes `stance?: 'argument' | 'document'`, defaulting to
`document`, and writes it to the `<body>` as `data-stance`.

| Route                   | Stance     |
| ----------------------- | ---------- |
| `/`                     | `argument` |
| `/reference`            | `document` |
| `/reference/<package>`  | `document` |
| `/providers`            | `document` |
| `/providers/<provider>` | `document` |
| `/archetypes`           | `document` |
| `/design`               | `document` |

`argument` is the treatment `/` is written in: larger type, more negative space,
the entry motion below, and the demos. `document` is the quiet treatment every
other page on this site already had. Only `/` passes anything; every other route
takes the default and says nothing.

**What the attribute itself drives today is the entry motion, and only that.**
The larger type and the wider gaps on `/` are that page's own rules in its own
`<style>`, as they were before the prop existed; the stance did not move them
and does not need to. What the attribute buys is a place for the rules that must
_not_ be one page's private decision — a reveal is the first of them, because a
reveal written locally is a reveal every later page can write locally too. The
name is the fact stated on the document; the CSS keyed off it is what the fact
is spent on.

**The word is `stance`, and it was chosen the same way `rail` was.** A stance is
the posture a page takes toward its reader, which is what the two treatments
differ in — not where anything sits, and not what a page is made of. Every
shorter word was taken. `archetype` already means a composed example player here
and is also a route. `surface` already names two things. `register` had 151 hits
across the repository, `treatment` 20, and `mode` and `kind` are both the
player's own domain. `stance` had none, in `apps/`, `packages/`, `docs/` or
`CONTEXT.md`, so it arrives meaning one thing.

**The default is the load-bearing half.** Every route but one is a document, so
a page added later gets the quiet treatment with nothing to remember — no list
to append to and no attribute to copy — and the one page that argues is the one
that has to say so. That is the same shape of decision the `documentation` prop
already makes about its own default, for the same reason: the property that
holds for almost every page is the one that must not need an author to remember
it.

**`/archetypes` is a `document` deliberately, not by omission.** The persuading
happens on `/`; that page exists so a reader can read the source of two composed
players. A second marketing register there would be the site making its argument
twice and being inconsistent about how, which is worse than either treatment on
its own.

**`/design`'s public status is not decided here.** Whether this sheet is listed,
unlisted or moved is another issue's to rule on. It is given a stance so that it
has a shape whatever that ruling is, and nothing more should be read into it.

**`stance` and `documentation` are two axes and only correlated.**
`documentation` answers whether a page belongs in the search index; `stance`
answers how it is dressed. `/design` is `documentation={false}` and
`stance="document"`, and that pair is the proof they are not one prop:
collapsing them would make either fact unstatable without the other. `/` happens
to sit at one end of both, which is what makes the two look like the same
question until a third page appears.

`e2e/site-stance.spec.ts` pins the parts of this a reviewer would otherwise have
to take on trust: that `/` carries the argument stance, that a document route
carries the other and animates nothing, and that the entry motion's targets rest
visible when the motion does not run.

## Depth, motion, and the four audit constraints

A deterministic detector was run against the comps and found real defects. These
are acceptance criteria for anything added to this site, not style advice.

- **No tracked-caps eyebrow chip above an `h1`.** A named tell, and it was on
  every comp.
- **No 1px border under a wide shadow blur** (24px, 60px). That pairing was the
  comps' entire depth system, and it is a named tell too. It is still banned,
  and the rule below is written so that it cannot be assembled by accident.
- **Functional text at 11px or above.** See `--text-fn`.
- **Animate `transform` and `opacity` only.** Never `max-height` or `width`:
  those lay the page out again on every frame, and every effect that seems to
  need them has a composited equivalent — a translate or a scale under
  `overflow: hidden`.

### Depth, and what rule 4 used to say

Rule 4 first read **"Depth is a surface colour and a hairline. There is no
shadow."** It was written that way because a 1px border under a 24px or 60px
blur was the comps' whole depth system and is a named generated-interface tell,
and the cheapest way to kill one combination is to ban the category it belongs
to.

That was too wide. The tell is the _pairing_, not the shadow: a border and a
wide soft blur together, imitating depth that neither states on its own. An
elevation with a real offset and a tight blur, standing alone, is not that
thing — and without it every panel on the site had to be either flat or
outlined, which is why the landing page read as a stack of boxes. So the rule
gained two tokens and one prohibition, and read **"Depth is a surface colour, a
hairline, or one of two elevations — and an elevated surface never also carries
a border."**

"A surface colour" was accurate while there were three of them and a panel had
exactly one place to be. It stopped being accurate when the ladder grew: a row
picked out of a panel and a dialog laid over the page are both a surface on a
surface, and that wording made them sound like a choice of paint rather than a
position on a scale. So the second amendment is one word. Depth is a _step_ on
the surface ladder, which says the values are ordered and that the order is what
carries the meaning. Nothing else in the rule moved. The two elevations are the
same two tokens with the same two jobs, and **an elevated surface still never
also carries a border** — which is the sentence that keeps the banned pairing
unassemblable, and the new rungs are no help in assembling it, because a surface
colour is not a blur and cannot become one. More depth here means a rung, never
a wider shadow.

The two elevations are these.

| Token                    | Value                    | For                                  |
| ------------------------ | ------------------------ | ------------------------------------ |
| `--elevation-panel`      | `0 2px 4px` shadow       | A surface at rest on the field       |
| `--elevation-instrument` | `0 8px 16px` deep shadow | The one panel a page is built around |

The geometry is theme-independent and only the ink changes, so the two themes
cannot drift into casting differently-shaped shadows. The names say what a thing
_is_, not how big its shadow is, which is what stops the scale growing a third
step the first time something wants to sit between them.

**An elevated surface never also carries a border.** Elevation replaces the
hairline; it does not accompany it. That single sentence is what keeps the
banned pairing unassemblable, and it is the reason this rule could be relaxed at
all.

**This rule is unenforced, and the old one was not.** "There is no shadow" was
kept by the absence of a shadow token: there was nothing to write, so writing
one meant writing a colour, and rule 1 fails that in review at the first hex.
The amended rule has two tokens and a prohibition made of prose, and nothing in
the repository fails when a third `box-shadow` appears or when an elevated
element also takes a border. That was accepted rather than overlooked. The
guards this site does carry — the background-image scan, the packaging and
budget gates — each answer a question with one right answer that a scan can
read. "Is this element the one panel this page is built around" is not that
question, and a scan that only counted `box-shadow` declarations would pass the
pairing this rule exists to ban while failing nothing that matters. So the
allowlist above is the enforcement, and it works only if a new elevated element
is an edit to it.

Also still banned: coloured glows, zero-offset halos, and stacked shadows
imitating one large soft one. A shadow is cast by a surface above a surface. It
is not a way to tint an edge.

**What may spend an elevation, by name.** `--elevation-instrument` belongs to
the capability ledger on `/` and to nothing else — it is the panel that page is
built around, and a second instrument on one page means neither is the
instrument. `--elevation-panel` belongs to two things: the bezel around the
hero's player — `.demo__bezel` in `HeroPlayer.astro`, and not the stage inside
it, which is a recessed colour and a hairline — and the search dialog in
`DocsSearch.astro`, which is a panel over a page rather than the panel a page is
built around, and which carries no border because rule 4 forbids an elevated
surface one. Everything else on this site is a step on the surface ladder and a
hairline, as before. A new elevated element is an edit to this list, not a local
decision.

The ladder has a top, and it is measured rather than felt: see _Palette_ above
for the `#1F1F26` ceiling and the rejected `#24242C`. Above the overlay the
answer is an elevation. There is no third rung waiting to be added, and a page
that seems to want one is a page with too many surfaces on it.

**No component spends either new role yet.** The two are declared in
`tokens.css` and rendered as swatches on `/design`, and that is the whole of
their present use: the ladder is stated and measured before anything leans on
it, so the first panel that wants a surface on a surface reaches for a rung that
has already been checked against ink rather than inventing one. Stating that
here is what keeps a later reader from inferring, from the roles' existence,
that some panel on this site is already relying on them.

**There are two animations on the site, and both are on `/`.** The count is the
rule; the argument it was making is why the count is two and not seven.
Scattered reveals down a page are the generated-landing-page tell in motion
form, and one authored moment is worth more than six of them — a second one is
spent here only because it is the same moment, on the page's central claim.

The first is the hero's sweep band, which travels in from the left once on
arrival — a `translateX(-100%)` to `translateX(0)` on an inner box inside an
`overflow: hidden` window, at `--duration-slow`. A translate under a clip rather
than a scale, because scaling the band would compress the gradient instead of
revealing it and the warm end would arrive first; a translate moves the paint
across a fixed window at its final width.

The second is the entry motion below, which reaches exactly three elements: the
three `.status` columns of the three-state comparison on `/`, which are one
comparison rather than three things and move together as such. Nothing else on
the site moves on entry, and the hero's band is untouched by any of it.

`prefers-reduced-motion: reduce` collapses durations, which lands each transition
on its settled state immediately. That only works because every transition moves
between two settled states. An effect that leaves an element mid-travel or
invisible when its motion is removed is a bug in the effect. The hero's
animation meets the same condition and meets it the same way: its second
keyframe is the band in place, and `animation-fill-mode: both` is what holds it
there, so a collapsed duration produces a drawn band rather than one parked off
to the left.

Focus is one treatment for the whole site: a 2px `--color-accent` outline on
`:focus-visible`, offset by 2px. An outline rather than a shadow, so it follows
the element's own shape and survives forced-colors mode.

Every control carries a rest, a hover, a focus and a pressed state, and none of
them is a lift. The theme switch darkens to `--color-sunken` on hover and takes
an accent border while pressed. Every link on the site presses to
`--color-ink-subtle`, which is one rule in `base.css` — a step down the ink
scale reads the same way from any of the rest colours a link here takes, whether
that is the accent, the muted ink of a crumb or the full ink of the wordmark. A
component that styles its own `a:hover` outranks that selector and restates the
press: the rail's links and the header's crumbs both do.

Colour changes are not transitioned, because colour is not one of the two
properties this system animates. The one transition on a control is the switch's
knob, which translates; its colour changes at the same moment and snaps.

### Entry motion

`base.css` holds the site's one entry-motion vocabulary: a fade and a small
rise, `opacity` and `transform` only, at `--duration-slow` and `--ease`. Both
tokens already existed and no token was added for this. The rise is
`var(--space-3)`, a step of the spacing scale rather than a length of its own,
because a reveal that travels further reads as an arrival from off-screen rather
than as a thing settling.

It is keyed off `[data-stance='argument']`, so it reaches `/` and can reach
nothing else. A document page could carry the class and would still not move.
That is the point: the way to stop a page growing scattered reveals is to make
them unreachable, not to write a rule asking a later author not to write one.

Three constraints, and each is a rule rather than a description of what the code
happens to do today.

- **The resting state is what the CSS gives the element.** There is no
  `opacity: 0` default anywhere in this vocabulary. The script on `/` _adds_
  `data-enter` and removes it on intersection, so a reader whose script fails or
  is blocked gets the settled page. Written the other way round it would blank
  the page on the one failure it has to survive — the same reasoning that makes
  the hero's island `client:only`.
- **`prefers-reduced-motion: reduce` skips the observer entirely.**
  `matchMedia` is checked before anything else and the `IntersectionObserver` is
  never constructed, so the from-state is never written to anything and there is
  no state for the site-wide duration collapse above to have to rescue. That
  collapse is deliberately not what handles this case: it rescues a transition
  by landing it on its settled state, and the honest answer to a reader who
  asked for no motion is that no transition was started.
- **Scroll-linked and parallax effects are rejected outright.** They have no
  expression in this vocabulary and are not to be given one. A page whose paint
  is a function of scroll offset is this section's tell drawn continuously
  instead of once.

One implementation detail is worth a sentence, because it is not obvious and a
later reader would undo it: an element already inside the viewport when the
deferred script runs is skipped rather than given the from-state. Handing an
element the from-state after first paint and then taking it back is a blink
rather than a reveal.

## Search

Search is **Pagefind**: an index built from the emitted HTML after `astro build`
finishes, shipped as files beside the pages, and queried by WebAssembly in the
reader's browser. There is no service, no key and no query log, and that is the
decision rather than a side effect. This site's whole argument is that
`loading="interaction"` contacts no provider before a click, and a page that
posted every keystroke of its search box to a search vendor would be arguing
against itself — the same reasoning that self-hosts the fonts.

**The claim is observed, not asserted, in both directions.** At query time,
`e2e/site-search.spec.ts` records every request the page makes while searching
and fails if any of them leaves this origin; it also checks that the Pagefind
bundle was among them, so an empty list is evidence rather than a listener
attached to the wrong page. At build time, `apps/site`'s build was traced with
`strace -f -e trace=connect` — Pagefind opened no socket at all, and Astro
opened one to port 443, which is its anonymous telemetry. Hence
`ASTRO_TELEMETRY_DISABLED=1` in front of every `astro` invocation in
`package.json`, after which the traced build makes no outbound connection. That
figure is a measurement and re-measurable the same way; the environment variable
is the durable part.

**Which pages are indexed is opt-out, and that is the design.** Pagefind walks
the built directory and indexes every page whose `<body>` does not carry
`data-pagefind-ignore`, which `Base.astro` writes for a page passing
`documentation={false}`. So a documentation page added later is searchable with
nothing to remember — no glob to widen, no list to append to — which is what a
list of files could not have given, since the provider pages were being written
in parallel with this and would have landed unsearchable with nothing failing to
say so. The two pages that opt out are `/`, which is an argument rather than a
document, and `/design`, which is this sheet. The header and the document
rail carry the same attribute for a different reason: they appear on every page,
so indexed they would put the navigation into every excerpt. The rail's copy of
it sits in `DocRail.astro` rather than on the routes that render one, so the
provider pages inherited the exclusion without anyone wiring it a second time.

**The keyboard model is the platform's wherever it can be.** `/` opens and
focuses, arrows move, Enter opens the highlighted result, Escape dismisses —
and the focus trap, the Escape handling and the return of focus to the button
that opened it all arrive with `<dialog>` and `showModal()`. The field is
`type="text"` and not `type="search"` because a search field eats the first
Escape to clear itself. The results are an ARIA listbox named by
`aria-activedescendant`, so focus stays in the field while a screen reader
follows the highlighted row, and the count is announced through a `role="status"`
line.

**Both URLs it needs are derived from `import.meta.env.BASE_URL`** — where the
bundle is fetched from, and what a result's recorded path resolves against.
Pagefind stores a page's path inside the build output, which is the site root
and not the prefix the site is served under, so `baseUrl` has to be handed to it.
Both ways of getting this wrong are silent, so the spec runs everything twice:
against the shipped build at `/`, and against a second build made with
`--base /playdeck/` and served at that prefix. A literal and a derived path are
the same string at the root, which is why a root-only test would prove nothing.

## Browser surfaces

`::selection`, the scrollbars and the caret are drawn by the browser, and left
alone they are the engine's defaults — a palette belonging to no design system,
sitting on top of one. They are themed in `base.css` from the roles above:

- **Selection** is `--color-accent` behind `--color-field`. It sets `color` as
  well as the background, which is what makes a selection inside a code block
  legible: the highlighter has written a colour onto every span, and a
  background alone would paint behind whatever that colour is.
- **Scrollbars** use `scrollbar-color` with a `--color-line-strong` thumb and a
  transparent track, so the track takes the surface it is scrolling over rather
  than pinning another grey into the page. `scrollbar-width: thin` is applied
  only to the inner scrollers — a code block and the rail — where a
  platform-width bar reads as a second border; the page's own scrollbar keeps
  its full hit target. Standard properties only, never `::-webkit-scrollbar`,
  which would be a second and engine-specific description of the same thing.
- **The caret** is `--color-accent`. Nothing on the site takes text input today;
  this is for caret browsing and for whatever a later page adds.

The utility classes live beside them in `base.css`. They are the classes in this
system not owned by one component, and a new one has to earn that:

- `.u-tabular` sets `font-variant-numeric: tabular-nums`, for figures that sit
  above one another — a version number in a list. Plex Sans's default figures
  are proportional and do not line up. Applied by class rather than to `code`,
  because an identifier gains nothing from it.
- `.u-visually-hidden` is present for assistive technology and absent for
  everyone else. It exists for the case where the visible text is deliberately a
  fragment of the real name: the rail shows `core`, and this is what keeps the
  link named `@playdeck/core`.
- `.u-enter` marks an element the entry motion applies to. What earned it is
  that the alternative is worse: written into `/`'s own `<style>` it would be
  one page's private effect, and the next page that wanted a reveal would write
  a second one with its own duration and its own distance. Site-wide, there is
  one fade, one rise and one easing, and the `[data-stance='argument']` key on
  the rule is what keeps a site-wide class from being a site-wide effect — the
  class is inert on every page but one. See _Entry motion_ above.

## Where things live

| File                                   | What it is                                               |
| -------------------------------------- | -------------------------------------------------------- |
| `src/styles/tokens.css`                | Every value. The only file with hex literals             |
| `src/styles/base.css`                  | Element defaults, spoken in tokens                       |
| `src/styles/doc.css`                   | The shell and the prose of a rendered document           |
| `src/layouts/Base.astro`               | The document, its stance, and the pre-paint theme script |
| `src/components/SiteHeader.astro`      | The shell above every page                               |
| `src/components/ThemeToggle.astro`     | The control that stores a theme choice                   |
| `src/components/DocsSearch.astro`      | Search over the documentation, and its dialog            |
| `src/components/Sweep.astro`           | The one gradient, and its two forms                      |
| `src/components/DocRail.astro`         | The rail beside a document, both sets of them            |
| `src/components/HeroPlayer.astro`      | The hero's two panels, and the player theme              |
| `src/components/HeroPlayerIsland.tsx`  | The hero's composition: the player and ledger            |
| `src/pages/index.astro`                | The landing page at `/`, and its links                   |
| `src/pages/design.astro`               | The specimen sheet, served at `/design`                  |
| `src/pages/archetypes.astro`           | Two composed players, and the files they are             |
| `src/pages/reference/index.astro`      | The package index, served at `/reference`                |
| `src/pages/reference/[pkg].astro`      | One reference page per publishable package               |
| `src/pages/providers/index.astro`      | The provider index, served at `/providers`               |
| `src/pages/providers/[provider].astro` | A setup page per provider group                          |
| `src/content.config.ts`                | The two document collections, and their loaders          |
| `src/reference-packages.mjs`           | Which packages get a page, and from where                |
| `src/provider-pages.mjs`               | Which providers get a page, and which sections           |
| `src/shiki.ts`                         | The two theme names, for both readers of them            |

**The header** carries the wordmark returning home, the path from the root to
where the reader currently is, search, and the theme switch. This is a
documentation shell and not a marketing bar, so there is still no call to action
and no product navigation. It is not sticky: a reference page is a whole README,
and the one element a reader navigates a long document with is the rail, which is
sticky already. One per page.

**It used to read "three jobs and no fourth", search named among the things it
would not carry.** That rule was aimed at everything a reader did not come for,
and search is the one thing in that strip a reader of a long document does come
for — see _Search_ below. What the rule still forbids is unchanged: a header
here gains nothing that sells, and nothing that duplicates a page's own
navigation.

Search is on documentation pages only. `/` and `/design` pass
`documentation={false}` to both `SiteHeader.astro` and `Base.astro`, which is
the same fact said to the two halves that need it — the control, and the search
index.

**The wordmark is the trail's first item, not a thing beside it.** It sits
inside `<nav aria-label="Breadcrumb">` as the root of the path, and the
separator is generated between crumbs rather than before every one, so the trail
opens with a name instead of a stray slash. The separator is not hidden from
assistive technology and could not usefully be: generated content is announced,
and a breadcrumb read as root-separator-ancestor-separator-leaf is the trail
saying what it draws.

**The leaf carries no `aria-current`.** It is identified by being last in the
trail and by being the one entry rendered without an `href`, and styled from
`:last-child`. On a reference page the rail already marks the current package
with `aria-current="page"`, on a link among sibling links, which is where the
attribute does work; a second marker on a non-interactive `span` in the header
would leave a reader to work out which of the two was meant.

On `/` the header renders only the switch. There is nowhere for a wordmark to
return to, the page's own `h1` is already the wordmark at the title rung — and
that `h1` cannot move, because `scripts/check-deploy-artifact.mjs` identifies
the site's root document in a browser by a heading named exactly `Playdeck`. The
same check follows every internal link on `/` in document order and needs the
workbench to be the last, which is a second reason a header there does not add
one.

The reference pages and the provider setup pages are the site's long-form
reading, and the only pages here whose words are not written in this app. A
reference page renders one package's whole README from `packages/`, word for
word. A provider setup page is a selection of `docs/provider-setup.md` — the
introduction, that provider's own material and every section that applies to all
of them — with nothing paraphrased and nothing added. What follows about them is
design decision rather than incident, and it holds for both: they are the same
page shape, which is why `src/components/DocRail.astro` and `src/styles/doc.css`
are shared rather than written twice.

**The rail** is the narrow sticky column beside one of those documents,
`DocRail.astro`. It holds two lists — which document, and where in this one —
and it is the word this document and that file both use for it, in preference to
"sidebar", which says where a thing sits rather than what it does.

**On a narrow screen the rail is a disclosure, closed.** Stacked above the
document it ran to several phone screens — a link per package, an entry per
heading of the README, and the version — so a reader who followed a link to
`/reference/core/` scrolled past the whole of the site's navigation before
reaching the first word of the document they had asked for. Closed, the
document's own title is the first thing under the header.

It is a `<details>` and not a button with a script, because that is the element
the platform already made for this: the affordance, the keyboard behaviour and
the focus ring all arrive with no JavaScript. Moving the rail below the document
was the other option and it is worse — source order is what a screen reader and
the keyboard follow, and it would have put the navigation where neither meets it
until after several hundred lines of prose.

**At `60rem` and up a script opens the element and the summary leaves the
flow.** This is the one place on the site where a script is load-bearing for
layout, and the reason is that CSS cannot change an element's state. Revealing
the content with `::details-content` while the element stays closed tells
assistive technology "collapsed" about a list the reader is looking at, and at
that width the summary that could have corrected it is gone from the tree as
well. `open` is a property and the accessible state follows it, so the property
is what the script sets — together with the `data-rail` attribute the column
rules key off, so the announced state and the visible state are written in one
place and cannot disagree.

With no JavaScript nothing runs, the attribute is never written, the column
rules never match, and the rail is the closed disclosure the markup already is
at every width — both lists present, labelled, keyboard operable, announcing the
state they are in. That is the right thing to degrade to.

**The rail is sticky, and for a while it only said so.** `position: sticky`
travels inside its own containing block, and the grid aligned its items to
`start`, so the rail was exactly as tall as the box inside it, had nowhere to
travel, and had never stuck at any scroll offset. It now stretches to the grid
row and the disclosure is given that height too, because every box between the
scrollport and the sticky one has to be tall enough for it to move inside. Those
rules are unconditional at that width and not behind the `@supports` guard: a
reader who opens the rail by hand — in an engine without `::details-content`, or
with JavaScript off in any engine — would otherwise get the original defect
back. Only the `::details-content` rule itself sits behind the guard, because
where that anonymous box exists the height has to pass through it and where it
does not there is no box between the two.

**On a reference page the rail states `@playdeck/` once and lists what
differs.** Repeated down a 16rem column, the scope spent the width that tells
`provider-vimeo` from `provider-wistia` on characters identical in every row.
The prefix sits in the group's own label; each link keeps the whole name in its
accessible name through `.u-visually-hidden`, because `core` on its own is not
what a reader would say out loud. It is a prop rather than something the rail
assumes, and so is the mono face those names are set in: a provider setup page
lists `YouTube` and `Vimeo`, which are proper nouns and share no prefix. The
foot of the rail is a slot for the same reason — the version on a reference
page, the adapter's package on a provider page, and neither route describing the
other by naming what it carries.

**The measure is on the prose and not on the column.** Paragraphs, lists and
quotes are held to `--measure`; code blocks and tables get the full column. A
fence is generated from a real file and this site does not get to decide how
long its lines are, so narrowing it would only add scrolling.

**The package index is a list and not a grid of cards.** Cards of identical size
are the shape a container reaches for when nothing has been decided about the
contents, and they cost a reader the one thing an index is for: every name close
enough to the next to compare in one glance. Rows separated by a hairline, the
name aligned in its own column, no chrome. The version is stated once above the
list rather than in every row, and whether it can be is derived — the page
collects the set of versions, prints one line when there is one member, and
falls back to a figure per row when there is more than one. A number repeated
down a column is a number nobody reads.

**The provider index is that same list, and its second column is the adapter's
own sentence.** The rows are the four setup pages, and beside each is the
package that ships the adapter with the `description` npm shows for it — which
is the only description of a provider on this site that this app did not have to
write. One row carries two, because native files and HLS are one passage of
`docs/provider-setup.md` and two packages. The names are set in the mono face
and the provider is not, which is what says one of them is a thing you type.

**The table of contents is derived from the rendered headings**, never written
down. A parallel list of section names would go stale the first time somebody
renamed a heading in a README with no idea this page existed, which is the whole
failure the pages exist to avoid. It carries depth 2 and 3: depth 1 is the
document's own title, and depth 4 would make a rail that restates an outline
rather than one a reader jumps with. A README that goes deeper is still rendered
in full, and its fourth level is still styled — a heading a reader scrolls past
has to look like one whether or not the rail indexes it.

**The version sits at the foot of the rail, not above the title.** A line of
small type on top of an `h1` is the eyebrow this document names as a tell, and
that one would have restated the heading underneath it.

**A provider setup page is a selection of one document, and the selection is
made in code.** `src/provider-pages.mjs` slices `docs/provider-setup.md` at its
own headings and composes a page out of the pieces; no sentence of it is written
in this app. Two things are done to the text and both are transforms rather than
edits — the heading or the bold lead naming the provider is dropped, because the
page's `h1` is that name, and the provider's own material is moved above the
shared sections, because a reader on `/providers/vimeo/` came for Vimeo. A
section of that document that the module can place in neither category fails the
build rather than appearing on all four pages or on none, which is what keeps a
sixth provider from being documented and never published. One sentence of the
source reaches no page, and the module names it.

**Two classes of link are re-addressed on the way in, and only two.** A README is
one document read in two places, and a link that is right in the npm tarball can
be wrong here. A target relative to the package directory sits beside the README
on npm and on GitHub and nowhere under `/reference/<package>/`, so it is pointed
at the file's real home on
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

`docs/provider-setup.md` gets the same treatment under its own rules, in
`src/provider-pages.mjs` rather than in the loader: its relative targets are
resolved against `docs/` and sent to GitHub, except a link to a package the site
publishes, which becomes that package's reference page. A fragment is left as
written, and that is load-bearing rather than lazy — the two the document links
to name shared sections, and every provider page carries every shared section,
so the fragment resolves wherever the link was read.

The specimen sheet at `/design` renders every token in both themes — the type
scale, the surface and ink swatches, the capability colours and both forms of the
sweep — from the tokens themselves rather than from restated values, so a rung or
a role that changed shows the change. It is the living reference a later ticket
checks its work against, and the place to add a specimen when a token is added.

It is not part of the site's own navigation, and `/` links to it only so it is
reachable.

The landing page at `/` is the site's front door, and two of the things it prints
are measured at build time rather than written down. The bundle figures come from
`scripts/bundle-budgets.mjs`, the module `pnpm test:budgets` gates with, so the
page and the gate cannot state different numbers. The composition example is
`examples/react-composition.tsx`, read as bytes and highlighted with the same two
Shiki themes the reference pages use — which is why those two names now live in
`src/shiki.ts`: Astro's `<Code>` component reads nothing from
`markdown.shikiConfig`, so a page that typed them out again would eventually
colour one block differently from every fence beside it.

**Its sections are shaped by what they hold, and deliberately not alike.** A
page whose every section is a small heading, a paragraph and a block gives the
thesis and the budget table the same weight, which is a way of saying nothing
about either. So the three capability states are one comparison in three
columns on a `subgrid`, aligned row for row so a reader travels across rather
than round three boxes; the composition example is prose beside code; the
providers and the budgets are a list and a table, at the page's full width
rather than at the measure. Prose inside any of them is still held to
`--measure` — the width buys columns, not longer lines — and the page's own
maximum is `72rem`, which is the literal that section names as a page's own
decision.

**Cards of identical size are the container this page does not reach for.** It
is the same finding the package index records: three or five boxes the same size
are what a layout defaults to when nothing has been decided about the contents,
and they cost a reader the alignment that makes a set comparable. The capability
ledger takes the opposite treatment for the opposite reason — it is genuinely
one panel of machine output, so it is one raised surface, and it carries no
hairline at all. `--color-surface` on `--color-field` is built to raise a panel
with no border; the player's stage beside it is `--color-sunken`, which sits
close to the field, and that is what a hairline is for.

One constraint on that page is `scripts/check-deploy-artifact.mjs`'s rather
than this system's, and it is load-bearing: its `h1` is exactly `Playdeck`,
which is how that check identifies the site's root document in a browser.

There used to be a second — the workbench link had to be the last internal link
in the document, because the check followed every internal link in one page
context and navigating away from the workbench abandoned requests it was still
making. That check now visits each link in a page of its own (#528), so a link
may be added anywhere in the list. The constraint is written down here as gone
rather than deleted silently, because it governed the order of that list for
long enough to look deliberate.

`data-theme` has two writers and they are not interchangeable: the pre-paint
script in `Base.astro` applies a stored choice before the browser paints, and
`ThemeToggle.astro` writes the attribute and the stored value on a click. The
storage key is a literal in both, because an `is:inline` script cannot import
the module that would otherwise hold it.

## The hero player, and the site's islands

The hero mounts a real player. Two routes ship a renderer — `/`, whose island is
the player and the capability ledger reading it, and `/archetypes`, which mounts
the two compositions beside the source of each. Every other page is HTML, CSS,
the inline theme and rail scripts, and the search module. A prose section that
shipped a framework would be the defect; a landing page for a video-player
library that showed no player would be a different one.

The two are the same decision applied twice, not a drift: a page whose argument
is what a player does has to run one, and no page here mounts a framework for
anything else.

**The clip is `public/tracer.mp4`, this app's own copy.** An Astro build serves
only its own `public/`, so the file is copied in rather than reached for across
an app boundary. It is a one-second colour-bar test pattern with no audio track,
and the caption under the panel says what it is — the picture is a fixture, not
footage, and a hero that implied otherwise would be the page's only dishonest
frame.

`public/archetype-captions.vtt` is the same rule a second time, and is stated
here so the copy does not read as an accident. The archetypes mount in two
surfaces — this site and the workbench — and each build serves only its own
`public/`, so the fixture exists byte-identically in both. What makes that safe
rather than drift is that neither copy is authored: it is a fixture whose text
marks time in a clip, and a change to one that did not reach the other would
show up as a caption that did not match what the other surface played.

**Nothing about the player contacts a third party, and that is the point.** The
source is a file on this origin, driven through the native provider, and
`loading="interaction"` holds the root dormant until the play affordance is
pressed: no fetch, no provider attached. The page argues that in prose two
sections further down, and the hero is where it is either demonstrated or merely
asserted.

**With no JavaScript the panel is a plain `<video controls preload="none">`** on
the same file, inside `<noscript>`. The island is `client:only`, so it renders
nothing on the server and there is never a button in the document that a script
has to arrive to make work.

**The player's theme is imported, and it is a second system meeting this one.**
`@playdeck/react/theme.css` is layered and matches only elements carrying a
`data-playdeck-part` attribute, so it cannot reach anything else on the site and
loses to every unlayered rule here. It declares no token of its own — every value
is read as `var(--playdeck-…, fallback)` — so `HeroPlayer.astro` maps the whole
of it onto this system's roles in one block, and the player re-tunes with the
theme switch because it is reading the roles every other panel reads. Two of
those choices are not free:

- **The control bar is `--color-surface`, not the theme's scrim.** That default
  is a gradient, and this system has exactly one gradient. A flat surface and a
  hairline is the depth treatment the rest of the page uses.
- **Layer geometry is the page's.** The library's stylesheet states appearance
  and leaves position out, so the picture, the activation affordance and the
  control bar are stacked in one grid cell by rules in `HeroPlayer.astro`.

**A click anywhere on the picture works the player, and neither half of that is
a handler.** Before the clip is loaded the target is the activation button
itself, restored to the full-bleed box the library ships it with — the bundled
theme's 4rem is what had been shrinking it, and `HeroPlayer.astro` takes that
size back and redraws the badge as a background so the picture is not painted
over. Once the clip is running the target is a second `Player.PlayButton`, laid
into the same cell with its control-bar chrome removed, so the click toggles
playback the way every desktop player's does. The two never coexist: the
activation button removes itself at the moment the surface toggle is rendered.
The surface toggle is out of the tab order: once focus is in the bar the
keyboard reaches the same command twice already — the bar's own play button, and
Space or `k` anywhere inside `Player.Controls` — and a third stop named "Pause"
in front of the bar would be an obstacle rather than an affordance. The bar
keeps its own clicks by painting in front: both layers take `z-index: 1` and the
bar comes later.

**The keyboard is put into the bar when the player appears, and only the
keyboard.** The activation button unmounts while it holds focus, and a browser
drops focus to `<body>` when the focused element leaves the document — so a
reader who pressed Enter would be left with nothing focused and no media
shortcut, `shortcuts` being scoped to `Player.Controls` rather than global. The
library restores focus for controls that unmount from inside that region, and
this button is outside it. `HeroPlayerIsland.tsx` moves focus to the bar's play
button, which is the command that was just given. It does so only when the
activation button matched `:focus-visible` at the moment it was pressed — the
browser's own record of whether a ring was on screen — because a ring appearing
after a mouse click or a touch tap is its own defect.

**The seek input is `display: block`, and that is a library defect worked around
rather than a choice.** A range input is inline-level, so the theme's
`seek-slider` box grows past it by the descender space under the baseline, while
the theme centres the track on that box — leaving the thumb and the bar it runs
along without a shared centre. How far apart is a function of the consumer's
font, so every consumer of the bundled theme has some version of it and this
panel, whose `--playdeck-font-size` is the site's mono, had its own. Removing
the line box makes the container the input's own
44px and the two centres one. The 44px target is untouched. The defect is
`theme.css`'s and reaches every consumer of the bundled theme; it is reported
separately rather than fixed here.

Measured with `packages/react/test/contrast.ts`, in the same arithmetic as the
table above. Text on the bar is the `--color-ink` on `--color-surface` row that
table already carries; these are the pairs the player adds:

| Pair                           | Light | Dark  | Needs |
| ------------------------------ | ----- | ----- | ----- |
| Loaded range on the track      | 3.24  | 3.62  | 3     |
| Thumb ring on the track        | 16.38 | 16.92 | 3     |
| Thumb ring on the loaded range | 5.06  | 4.68  | 3     |
| Progress fill on the track     | 5.88  | 8.66  | 3     |
| Focus ring on the bar          | 6.65  | 8.33  | 3     |

**The thumb carries a ring because its fill cannot carry the boundary.** The
accent measures 1.82 light and 2.39 dark against the loaded range, and no accent
value clears 3:1 against both that and the track — which is the library's own
finding, and why its theme draws a ring at all. The ring is what the table above
holds to 3:1, and the fill is decoration on top of it.

**The track is `--color-sunken`.** That is the recessed-well role, which names a
switch track outright, and it is also what the first row of the table needs: on
`--color-line` the loaded range measures 2.85 light and 2.82 dark, below what
non-text UI owes.

This system is separate from `@playdeck/react/theme.css`, which is the player's
theme and ships to consumers. That file is layered and zero-specificity because a
stranger's stylesheet has to be able to win against it; nothing here ships
anywhere, so nothing here needs that. The two share no tokens and are not meant
to match — the hero maps one onto the other at a single seam, and that mapping is
the whole of the contact between them.
