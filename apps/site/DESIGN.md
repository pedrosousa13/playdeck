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
4. **Depth is a surface colour, a hairline, or one of two elevations — and an
   elevated surface never also carries a border.** See below.
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

**Selected text is `--color-field` on `--color-accent`**, which is the same two
colours as the accent row of the table above with the ground and the ink
swapped, and contrast is symmetric: 6.37 in light, 8.99 in dark. So the
selection needed no token of its own and moves nothing in the table. See
_Browser surfaces_ below for why it sets `color` as well as a background.

**The scrollbar thumb is `--color-line-strong`**, on whichever of the three
grounds it happens to be scrolling. That is the row the table already carries at
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

`/` is the only page that spends either on a heading of its own. Its `h1` steps
up to `--text-4xl` at `48rem` and keeps `h1`'s own rung below that, where 88px
would take three quarters of a phone's width and cost the lead its first
screen. A step between two rungs of this scale rather than a `clamp()`, because
a clamp is a font size written into a component and no component here writes
one. `/design` renders a specimen at every rung, these two included, which is
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
width is a separate decision and stays a literal in that page: `46rem` at `/`,
`52rem` on the package index, `74rem` for a reference page's rail-and-document
shell. One column width is not evidence about another, and a shared token would
claim it was.

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
`/providers/<provider>/` carry a working player, from the same `examples/`
machinery, because `docs/provider-setup.md` writes one for YouTube and one for
Vimeo. The landing page carries one block of it too, the composition
example. Colouring it is the one place a colour on this site comes from
somewhere other than `tokens.css`.

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

### Elevation, and what rule 4 used to say

Rule 4 read **"Depth is a surface colour and a hairline. There is no shadow."**
It was written that way because a 1px border under a 24px or 60px blur was the
comps' whole depth system and is a named generated-interface tell, and the
cheapest way to kill one combination is to ban the category it belongs to.

That was too wide. The tell is the _pairing_, not the shadow: a border and a
wide soft blur together, imitating depth that neither states on its own. An
elevation with a real offset and a tight blur, standing alone, is not that
thing — and without it every panel on the site had to be either flat or
outlined, which is why the landing page read as a stack of boxes.

So the rule is now two tokens and one prohibition.

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
instrument. `--elevation-panel` belongs to the bezel around the hero's player —
`.demo__bezel` in `HeroPlayer.astro`, and not the stage inside it, which is a
recessed colour and a hairline. Everything
else on this site is a surface colour and a hairline, as before. A new elevated
element is an edit to this list, not a local decision.

**There is one animation on the site, and it is on `/`.** The hero's sweep band
travels in from the left once on arrival — a `translateX(-100%)` to
`translateX(0)` on an inner box inside an `overflow: hidden` window, at
`--duration-slow`. A translate under a clip rather than a scale, because scaling
the band would compress the gradient instead of revealing it and the warm end
would arrive first; a translate moves the paint across a fixed window at its
final width. Everything below the hero is still. Scattered reveals down a page
are the generated-landing-page tell in motion form, and one authored moment is
worth more than six of them.

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
  than pinning a fourth grey into the page. `scrollbar-width: thin` is applied
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

## Where things live

| File                                   | What it is                                      |
| -------------------------------------- | ----------------------------------------------- |
| `src/styles/tokens.css`                | Every value. The only file with hex literals    |
| `src/styles/base.css`                  | Element defaults, spoken in tokens              |
| `src/styles/doc.css`                   | The shell and the prose of a rendered document  |
| `src/layouts/Base.astro`               | The document, and the pre-paint theme script    |
| `src/components/SiteHeader.astro`      | The shell above every page                      |
| `src/components/ThemeToggle.astro`     | The control that stores a theme choice          |
| `src/components/Sweep.astro`           | The one gradient, and its two forms             |
| `src/components/DocRail.astro`         | The rail beside a document, both sets of them   |
| `src/components/HeroPlayer.astro`      | The hero's two panels, and the player theme     |
| `src/components/HeroPlayerIsland.tsx`  | The hero's composition. The one island          |
| `src/pages/index.astro`                | The landing page at `/`, and its links          |
| `src/pages/design.astro`               | The specimen sheet, served at `/design`         |
| `src/pages/archetypes.astro`           | Two composed players, and the files they are    |
| `src/pages/reference/index.astro`      | The package index, served at `/reference`       |
| `src/pages/reference/[pkg].astro`      | One reference page per publishable package      |
| `src/pages/providers/index.astro`      | The provider index, served at `/providers`      |
| `src/pages/providers/[provider].astro` | One setup page per provider                     |
| `src/content.config.ts`                | The two document collections, and their loaders |
| `src/reference-packages.mjs`           | Which packages get a page, and from where       |
| `src/provider-pages.mjs`               | Which providers get a page, and which sections  |
| `src/shiki.ts`                         | The two theme names, for both readers of them   |

**The header** is the same three things on every page: the wordmark returning
home, the path from the root to where the reader currently is, and the theme
switch. Three jobs and no fourth — this is a documentation shell, not a
marketing bar, so there is no call to action and no product navigation. It is
not sticky: a reference page is a whole README, and the one element a reader
navigates a long document with is the rail, which is sticky already. One per
page.

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

Two constraints on that page are `scripts/check-deploy-artifact.mjs`'s rather
than this system's, and both are load-bearing. Its `h1` is exactly `Playdeck`,
which is how that check identifies the site's root document in a browser. And the
workbench link is the last internal link in the document, because the check
follows every internal link in document order and navigating away from the
workbench abandons requests it is still making.

`data-theme` has two writers and they are not interchangeable: the pre-paint
script in `Base.astro` applies a stored choice before the browser paints, and
`ThemeToggle.astro` writes the attribute and the stored value on a click. The
storage key is a literal in both, because an `is:inline` script cannot import
the module that would otherwise hold it.

## The hero player, and the site's one island

The hero mounts a real player. It is the only interactive thing on the site, the
only place any JavaScript of this site's hydrates, and the only route that ships
a renderer at all — every other page is still HTML, CSS and the two inline theme
scripts. A prose section that shipped a framework would be the defect; a landing
page for a video-player library that showed no player would be a different one.

**The clip is `public/tracer.mp4`, this app's own copy.** An Astro build serves
only its own `public/`, so the file is copied in rather than reached for across
an app boundary. It is a one-second colour-bar test pattern with no audio track,
and the caption under the panel says what it is — the picture is a fixture, not
footage, and a hero that implied otherwise would be the page's only dishonest
frame.

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
