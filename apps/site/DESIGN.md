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
   missing token, not a local exception.
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

| Token        | Size             | Use                                      |
| ------------ | ---------------- | ---------------------------------------- |
| `--text-3xl` | 2.75rem (44px)   | Page title                               |
| `--text-2xl` | 2rem (32px)      | Section title                            |
| `--text-xl`  | 1.5rem (24px)    | Subsection                               |
| `--text-lg`  | 1.125rem (18px)  | Lead paragraph                           |
| `--text-md`  | 1rem (16px)      | Body                                     |
| `--text-sm`  | 0.875rem (14px)  | Secondary prose, functional text at rest |
| `--text-xs`  | 0.75rem (12px)   | Captions and labels                      |
| `--text-fn`  | 0.6875rem (11px) | The floor. Functional text only          |

Sizes are in `rem` against the browser's own root size, which is left alone: a
reader who raised their default has said something, and a fixed pixel root
discards it.

**`--text-fn` is the floor and the scale has no rung beneath it.** The comps put
reason lines such as `└ browser` at 10.88px, and that is the text carrying the
product's whole argument. Weights are 400 and 600 only. `--tracking-fn` opens the
two smallest mono sizes slightly, because mono at 11px loses more to tight
tracking than it gains.

## The one gradient

`--gradient-chroma` is the only gradient in the system. It sweeps blue through
green and amber to red — the path a chromaticity diagram traces round the
spectral locus — and it is built from the role tokens rather than from colours of
its own, so it re-tunes with the theme and the states it passes through are
literally the state colours.

It is allowed in exactly two forms:

- a hairline, as the `hr` rule;
- one accent in the hero.

It is **not** a background wash, not a fill behind text, not a border on a card,
and never a second gradient with different stops. Gradients creeping outward
until the page looks like every other generated landing page is the specific
failure this rule exists to prevent. If a design seems to want another one, the
answer is the flat surface tokens.

Its stops are unevenly spaced because the perceptual distance from blue to green
is much larger than from amber to red, and even stops make the warm end read as
one smear.

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
| `src/components/ThemeToggle.astro` | The only writer of `data-theme`              |

This system is separate from `@playdeck/react/theme.css`, which is the player's
theme and ships to consumers. That file is layered and zero-specificity because a
stranger's stylesheet has to be able to win against it; nothing here ships
anywhere, so nothing here needs that. The two share no tokens and are not meant
to match.
