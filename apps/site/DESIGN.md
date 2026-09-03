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
   discovered — two theme names and the five colours in them this site repaints
   for contrast, all in `src/shiki.ts`. See below.
2. **There is exactly one gradient.** See below.
3. **Functional text never goes below 11px.**
4. **Depth is a step on the surface ladder, a hairline, or one of two
   elevations — and an elevated surface never also carries a border.** See
   below.
5. **Only `transform`, its individual longhands (`translate`, `scale`,
   `rotate`) and `opacity` are animated.** It read `transform` and `opacity`
   until the longhands were measured in the built page. See below.

Rules 1 and 5 govern what this app writes. The two archetype stylesheets are
outside both, on `/archetypes`, and that is named here rather than left to be
found. See _The archetypes, and why they are outside rules 1 and 5_ below.

## Palette

Roles, and what each theme assigns them. `--color-*` is what a component reads;
the light and dark columns are the raw scale entries behind it.

| Role                  | Light     | Dark      | Used for                                       |
| --------------------- | --------- | --------- | ---------------------------------------------- |
| `--color-field`       | `#FAFAF8` | `#08080B` | The page                                       |
| `--color-surface`     | `#FFFFFF` | `#131318` | A raised panel                                 |
| `--color-raised`      | `#FFFFFF` | `#17171D` | A step up from its ground — a row, a readout   |
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

**There is a sixth set of colour roles, `--stage-*`, and it is not a third
theme.** `--stage-field`, `--stage-ink`, `--stage-surface`, `--stage-sunken`,
`--stage-line-strong` and `--stage-accent` are declared once in `tokens.css` and
never reassigned, so they do not move with `data-theme` or with
`prefers-color-scheme`. Five of the six are the dark theme's own raw values, and
`--stage-field` `#0A0A0F` is a near-black of its own, a shade lighter than the
dark theme's field. They exist because a picture
is watched in the dark whatever the room is lit like, and a player frame that
went white in the light theme would be the page changing what the media looks
like to match its own chrome.

They belong to `Bench.astro` and to nothing else. That file paints the frame
with them and maps the whole of `@playdeck/react/theme.css`'s custom properties
onto them, which is the one seam where this system speaks to the library's own.
A page that wanted a dark panel of its own would be asking for a surface rung
rather than for these, and the ladder above is where it should be looking. This
document listed the five `--color-*` grounds for a long time without mentioning
this set at all, which is why the player's own contrast table further down was
measured in two columns when the pairs it holds are the same in both themes.

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

**There is a standing check, and this is the second thing that rule has said.**
It used to read that there was deliberately no check script: the tables were a
record of a measurement, and whoever changed a value was expected to re-measure
it with a throwaway script over these same helpers. That held for as long as the
palette was the only thing moving. It stopped holding when #540 made "every
text/background pair still meets WCAG AA, measured" a condition on the site as a
whole — a measurement taken once and deleted satisfies that word once, and the
next token edit takes a pair under its floor with nothing to say so and this
document still reporting the figure the pair used to have.

So `e2e/site-contrast.spec.ts` computes every pair below from a served page in a
real browser, on every run of the e2e suite, and fails under 4.5 for text and
under 3 for `--color-line-strong`. It reads the used colour an engine resolved
rather than re-parsing `tokens.css`, because the value a pair actually gets is
the one the cascade picks out of three assignments of the same role, and a
re-parse would be checking its own reimplementation of that as much as the
stylesheet. The floors alone would let the palette drift towards them in
silence, so the spec also pins the two tightest pairs named below, by pair and
by figure — which is what makes the two sentences at the foot of this section
fail rather than rot when a token moves.

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

### The syntax palette, which is measured here and repainted in five places

The colours inside a code block are the one set of inks on this site that a
`--color-*` role does not name — see _Code, and the one exception to rule 1_ —
and they were the one set nobody had measured. Every one of them is body text at
body size on `--color-sunken`, so every one owes 4.5.

Five did not have it. Measured on the built site before the fix: keywords
`#d73a49` at **4.04** in light, comments `#6a737d` at **4.25** in light and
**4.00** in dark, `variable` `#e36209` at **3.08** in light and
`entity.name.tag` `#22863a` at **4.09** in light. The comment colour is the one
that matters most in kind rather than in number, because the prose inside an
example is what a reader reads most closely.

The cause is not the themes' carelessness. `github-light` and `github-dark` are
tuned against their own backgrounds, and this site paints a code block on
`--color-sunken` instead — which is the whole of the paragraph _What the
exception does not cover is the block itself_. So no off-the-shelf pair fixes
it: `github-light-default`'s comment colour measures 4.55 against the white it
was tuned for and 4.02 against this ground, and `github-light-high-contrast`'s
reaches only 4.45. `src/shiki.ts` repaints those five and nothing else, each
holding its hue and moving only in lightness, which is what
_Three values changed from the design comp_ above already did to three role
tokens for the same reason.

Light theme, on `--color-sunken`:

| Colour                    | Scope                | Ratio | Needs |
| ------------------------- | -------------------- | ----- | ----- |
| `#24292e`                 | plain text           | 12.95 | 4.5   |
| `#032f62`                 | strings              | 11.69 | 4.5   |
| `#6f42c1`                 | entities             | 5.75  | 4.5   |
| `#a04100` _was_ `#e36209` | `variable`           | 5.70  | 4.5   |
| `#586069` _was_ `#6a737d` | comments             | 5.63  | 4.5   |
| `#005cc5`                 | constants, `support` | 5.56  | 4.5   |
| `#176f2c` _was_ `#22863a` | `entity.name.tag`    | 5.54  | 4.5   |
| `#cb2431` _was_ `#d73a49` | keywords, `storage`  | 4.83  | 4.5   |

Dark theme, on `--color-sunken`:

| Colour                    | Scope                | Ratio | Needs |
| ------------------------- | -------------------- | ----- | ----- |
| `#e1e4e8`                 | plain text           | 15.10 | 4.5   |
| `#85e89d`                 | `entity.name.tag`    | 12.87 | 4.5   |
| `#9ecbff`                 | strings              | 11.41 | 4.5   |
| `#ffab70`                 | `variable`           | 10.38 | 4.5   |
| `#79b8ff`                 | constants, `support` | 9.28  | 4.5   |
| `#b392f0`                 | entities             | 7.60  | 4.5   |
| `#f97583`                 | keywords, `storage`  | 7.25  | 4.5   |
| `#959da5` _was_ `#6a737d` | comments             | 7.01  | 4.5   |

The tightest of them is light `#cb2431` at 4.83, and it is the one entry that
clears its floor by less than its neighbours on purpose: the next step down that
hue is `#b31d28`, which `github-light` already spends on `invalid` and
`message.error`, and a keyword that looks like an error would be a worse defect
than a red with less headroom. `e2e/site-contrast.spec.ts` pins that figure
along with the whole set, so this table fails rather than rots.

It measures the palette from two served pages — `/archetypes/`, which highlights
through Astro's `<Code>` component, and `/reference/react/`, which highlights
through `markdown.shikiConfig` — because those are the site's two independent
highlighting paths and, as it happens, the only two pages whose blocks paint all
eight colours. The set is asserted in both directions, so a page that stopped
rendering the last JSX tag fails the check rather than quietly measuring seven.

## Type

**IBM Plex Sans, IBM Plex Mono and IBM Plex Sans Condensed**, three cuts of one
superfamily under the SIL Open Font Licence, and no second family. Sans carries
prose and headings. Mono carries functional text: a value, an identifier, a
state, or machine output — anything that is not a sentence. Condensed carries the
display rung and nothing else, through `--font-display`, which falls back to
`--font-sans` rather than to a generic, because a condensed cut is a width and a
weight rather than a different voice.

**This paragraph used to read "and no third family", and the site had already
grown one.** The condensed cut arrived with the shell rebuild in `f80c6d3`, the
sentence above it was left as written, and nothing on this site fails when a
font import and a paragraph disagree, so it stayed false through every commit
since. Why that cut was wanted is written down
nowhere in the repository and this paragraph does not invent a reason. What the
rule was actually defending is that a page may not reach for a face nobody
chose, and three cuts of one superfamily is still one decision, so the count
moves and the rule does not. A fourth family would still be refused.

**Two places spend `--font-display` and they are both on `/`**: the thesis
sentence under the `h1`, and the four figures in the close. Nothing else on the
site may take it without an edit here, for the same reason the elevation
allowlist below is written by hand. `tokens.css`'s own comment beside the face
still claims the wordmark and a chapter title among its consumers; neither
exists any more, and the file is wrong about that where this document is right.

Self-hosted, and the only weights and the only subset the site uses: sans 400,
sans 600, mono 400, condensed 700, latin. They arrive as devDependencies (`@fontsource/*`) so
the faces come through the lockfile with integrity hashes rather than as binaries
committed here, and the build emits the `woff2` files beside its own assets. The
served page makes **no third-party request of any kind** until a reader asks for
one, and it never makes one for a font. That is not a performance preference:
this is a library whose headline behaviour is contacting no provider before a
click, and a site that phoned a font host to say so would be arguing against
itself.

**This site reaches a third party in exactly two places, and both only because a
reader asked.** The bench's source switch on `/` loads whichever provider is
pressed, and the two archetypes on `/archetypes` play Blender open-movie
trailers from that foundation's own host once somebody presses them. Nothing is
contacted before that press on either page. That is the claim worth defending,
and it is the same claim the library itself makes about `loading="interaction"`.
On `/` it is observed rather than
asserted: `e2e/site-quiet.spec.ts` records every request the page makes at
rest and fails if any of them leaves this origin, then presses a hosted provider
and fails if none does, so an empty list is evidence rather than a listener
attached to the wrong page. The fonts keep the absolute guarantee above, because
nobody asks for a font.

**The maintainer cannot serve video from this site, and the switch is hosted
providers only now.** `native` and `hls` are gone from `bench-sources.ts`,
along with `public/bunny.mp4` and `public/hls/` — there is no same-origin clip
left to point either one at. `youtube` and `vimeo` are `ready: true` and play
Blender Studio's own uploads of _Sprite Fright_, verified by channel rather
than re-uploaded: `bench-sources.ts` records the `oembed` check for each.
`wistia` has no Blender upload and no account behind it, and stays
`ready: false` — turning it on is still a three-character change, when there
is a clip to point it at. `youtube` is listed first, which is what makes it
the switch's default position. See "The bench's player, and the site's
islands" below for which film, why both positions currently play the same one,
and why the fact that they do is not load-bearing.

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
these two rungs at all. A document page's title names the
document — a package, a provider, this sheet — and no stance in this system
dresses a name as a thesis.

**Neither rung sets a heading on `/` either, and that is worth saying because
the sentence above used to promise one.** `--text-4xl` goes to the thesis
paragraph, for the reason below, and `--text-2xl` goes to the four figures in
the close, which are `dt` elements and not headings. Both are still classes on
that page and neither moves what an element resolves to, which is the whole of
what the rule asks. What changed is that the argument stance no longer has a
heading large enough to be worth an exception.

**On `/` the display rung now sets a paragraph rather than the heading.**
`scripts/check-deploy-artifact.mjs` finds this site's root document by an `h1`
reading exactly `Playdeck`, so that heading is fixed by a build gate, and
`Playdeck` is the document's name rather than its argument. The thesis is the
sentence under it. So the `h1` takes `--text-lg` in `--color-ink-muted` and the
thesis paragraph takes `--text-4xl` above `48rem`, stepping down to `--text-3xl`
below it. The rung follows what the page is arguing, which is the reason the
rung exists at all. Every other page still takes whatever `base.css` gives its
heading elements, and nothing here changes what an element resolves to.

A component mounted only on one page may set a rung in a class of its own for
the same reason: what the rule is against is moving what an element resolves to,
not where the class is written. **This paragraph used to name
`ProviderTruth.astro`'s heading as the example, and it is no longer one.** That
component moved to `/providers`, which is a document, and its heading takes
`h2`'s own rung there. The sentence it was supporting also named "`/`'s own
section titles", and `/` has no section titles now: it is a thesis, an
instrument and a close, and the only thing in it at a heading rung is the `h1`
the deploy check pins. The permission survives with no current user, which is
the honest state to leave it in rather than deleting a rule because nothing is
currently exercising it.

That page's thesis paragraph takes `--text-4xl` at `48rem` and the rung below
it under that, where 88px would take three quarters of a phone's width and cost
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
`72rem` at `/`, `64rem` on `/archetypes`, `56rem` on `/start`, `46rem` on
`/design`, `52rem` on each of the two indexes — written twice, once in `src/pages/reference/index.astro`
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
the other three; and `/start` is mostly two of them, because a quickstart that
described the composition instead of printing it would be the second copy this
site is built to avoid. No provider page mounts a player; the routes that do are `/`
and `/archetypes`, and that has held through every rebuild of the landing page,
including the one that took `/` back down to a single island. The landing page
carries one block of code too, the composition the bench's switches build, and
that one is the exception to the exception: it is the only block on this site
that is not coloured at all, for the reason two paragraphs down. Colouring the
rest is the one place a colour on this site comes
from somewhere other than `tokens.css`.

The highlighter is **Shiki**, which Astro already ships — no new dependency —
set to the `github-light` and `github-dark` themes. The two names live in
`src/shiki.ts` and are read by two paths: `astro.config.ts` hands them to
`markdown.shikiConfig` for the READMEs' fences, and a page that prints a file
from `examples/` hands them to Astro's `<Code>` component, which reads nothing
from that configuration. `/archetypes` does that for the source wells beside its
players, and `/start` for the two compositions it prints. The landing page was
once the `<Code>` reader, printing four hand-written snippets and one real file;
it prints no highlighted code at all now.

**The exception used to be two theme names and is now two theme names and five
hex literals**, and that is the part of it worth reading carefully, because the
argument for the exception used to lean on a fact that is no longer true. It ran:
no hex is written by hand anywhere, the palette is regenerated from the source
text on every build, and there is no way to express it in this system's own
colours. The middle clause still holds and the first does not. `src/shiki.ts`
writes five colours of its own and hands Shiki a transformer that repaints them,
because five of the sixteen the two themes paint did not meet AA on the ground
this site puts a code block on — the figures are in _The syntax palette_ under
_Measured contrast_.

**The exception is kept, and on the clause that survived.** What made syntax an
exception was never that the colours arrived from outside; it was that they
cannot be roles. A role token is a promise about meaning that any component on
this site may spend — `--color-ink-muted` means the same thing in a table, a
rail and a caption. "Keyword", "string" and "comment" are not that. They are one
highlighter's vocabulary, spent only inside a `<pre>` by markup this app does
not author, and a scale of four accents cannot tell one from another in any
case. Moving them into `tokens.css` would put sixteen names into the palette
that no component may read, and would not even reach the code: Shiki writes both
themes onto every token inline as `--shiki-light` and `--shiki-dark`, so a token
in the stylesheet could only be applied by rewriting the highlighter's output —
which is exactly what the five overrides already do, at build time, in the one
file that names the themes.

So the exception is now stated with its cost: this app writes five colours, they
are in `src/shiki.ts` and nowhere else, and `e2e/site-contrast.spec.ts` measures
every colour a code block paints on every e2e run.

**`/`'s composition panel is not highlighted, and it is the one block on this
site that is not.** The panel prints what the bench's two switches just
composed, so it rewrites itself on every press, and Astro's `<Code>` runs on the
server only: colouring it means shipping a highlighter to the reader. The
smallest one that could do it — Shiki's `createHighlighterCore` with the
JavaScript regex engine, the `tsx` grammar and the two themes named above, and
nothing else — measures 72.5 kB gzipped (353.7 kB raw), of which the engine and
core are 52.6 kB. The close of that page prints 17 kB as the gzipped size of
every primitive this library publishes. A page that spent four times its own
product to colour four keywords would be arguing against itself in the object it
was arguing with, so the panel is a plain `<pre>` in `--color-ink` and the
highlighter stays where it costs a reader nothing: the reference pages' fences,
the two provider examples and `/archetypes`'s two source wells, all rendered at
build time. That figure is a
measurement and re-measurable the same way, with esbuild over the same imports.

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
`examples/archetype-course-platform.tsx`. `/` mounted the same two files for
two of its lives and no longer does. Each carries its own stylesheet as a `<style>`
element inside the component, and each writes hex literals by the dozen and
animates `background-color`. Read against rules 1 and 5 those are violations;
they are allowed, and the reason is what the pages are for.

Those two files are not this app's. They live in `examples/`, they are the
files a consumer copies, and `apps/storybook` mounts the same two. Two surfaces,
not the three this paragraph once counted: `/` was the third for two of its
lives and is not one now. A stylesheet
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
system. Everything around the two players is inside the rules like every other
page: `/archetypes` itself, and the container the compositions are
mounted in, which is deliberately no container at all — no surface colour, no
elevation, no hairline, because a bezel drawn by this site around a file that
brings its own appearance would be this site's paint on a consumer's example.

**Both are mounted `client:only`, and the two rules this used to need are
retired rather than quietly dropped.** The first was about server rendering:
`/` mounted them `client:visible`, which defers hydration but still renders the
components on the server, so whatever heading each composition drew over its
picture was in the document before any script ran and landed in `/`'s heading
outline. There is no Astro directive that defers the mount and skips the server
render, so that was the cost of the deferral rather than an oversight. It is
gone because the mount is gone: `/` mounts no archetype, and `/archetypes` uses
`client:only`, which renders nothing on the server at all.

The second was about the words. `/` handed each composition a `media` prop
carrying the clip and the copy describing it as one thing, so that a surface
replacing the clip could not fail to replace the sentence naming it, which is
how the streaming card stopped announcing the title `Sintel` over a colour-bar
test pattern. That prop still exists on both files and both compositions still
take it. Nothing passes it now. `/archetypes` passes only the captions fixture
and a resume position, so both players keep the Blender trailers the examples
ship and the headings say what is actually on screen with no override at all.
The design of the prop is worth keeping written down because the failure it was
built against returns the moment any surface overrides a source again, and the
next such surface will be written by somebody who never saw the first one.

None of those headings may ever be named `Playdeck`:
`scripts/check-deploy-artifact.mjs` identifies this site's root document by a
heading with exactly that name, and `e2e/site-nav.spec.ts` asserts there is
exactly one such heading on the page and that it is the `h1`.

## The one gradient

`src/components/Sweep.astro` draws the only gradient in the system. It sweeps
blue through green and amber to red — the path a chromaticity diagram traces
round the spectral locus — and its stops are the role tokens rather than colours
of its own, so it re-tunes with the theme and the states it passes through are
literally the state colours.

It is allowed in exactly two forms, and they are the component's `form` prop
rather than something a caller styles:

- `hairline`, the separator between sections;
- `accent`, one band, at most once per page.

It is **not** a background wash, not a fill behind text, not a border on a card,
and never a second gradient with different stops. Gradients creeping outward
until the page looks like every other generated landing page is the specific
failure this rule exists to prevent. If a design seems to want another one, the
answer is the flat surface tokens.

**"Exactly one" is a count of renders and not only a count of stops.** The rule
was read for a while as a licence to place the hairline after every section,
and `/` shipped five of them plus the hero band. Six sweeps down one page is the
creep this rule exists to stop, drawn from the one component that was supposed
to make it impossible. So the landing page renders the sweep once, and the one
render is the `accent` band along the bottom edge of the bench's frame,
`Bench.astro`'s only call to the component. It is not a decorative strip above a
heading any more: it sits on the one element the page is built around. The two
parts either side of the frame are separated by space, and the close by
`--color-line-strong`, not by a second sweep. Where
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

**All of that is now observed rather than asserted.** It was read by people for
as long as it has existed, and it is the kind of rule any edit to the cascade in
`tokens.css` can falsify without failing anything — the scoping that makes an
explicit `light` beat a dark machine is one selector, and losing it leaves a
site that still switches on a click and still looks right on the machine
whoever changed it was using. `e2e/site-theme.spec.ts` drives the switch the
way a reader does and reads back the colour the browser actually painted, in
both directions, across a reload, and on a document page as well as on `/`. The
colour rather than the attribute, because a `data-theme` the cascade has stopped
reading would satisfy an attribute check and fail every reader.

## Stances

A marketing page and a reference document have different jobs, and pretending
otherwise costs one of them. So a page declares which of two treatments it is
served in. `Base.astro` takes `stance?: 'argument' | 'document'`, defaulting to
`document`, and writes it to the `<body>` as `data-stance`.

| Route                   | Stance     |
| ----------------------- | ---------- |
| `/`                     | `argument` |
| `/start`                | `document` |
| `/guides`               | `document` |
| `/guides/<guide>`       | `document` |
| `/reference`            | `document` |
| `/reference/<package>`  | `document` |
| `/providers`            | `document` |
| `/providers/<provider>` | `document` |
| `/archetypes`           | `document` |
| `/design`               | `document` |

`argument` is the treatment `/` is written in: larger type, more negative space,
the one authored moment of motion below, and the running player. `document` is
the quiet treatment every other page on this site already had. Only `/` passes
anything; every other route takes the default and says nothing.

**What the attribute drives today is nothing, and that is stated here as a
judgement rather than left to be found.** It used to drive an entry-motion
vocabulary that applied to a class any page could write; that vocabulary was
deleted and replaced by a single rule in `base.css` that faded the bench's
reason line in when a provider refused something. The reason line is deleted
too — #542's capability argument went from a five-row panel, to a ledger, to
one line, to nothing, because that one line picked which refusal to name by
the iteration order of a lookup table, and the maintainer's own assessment was
that this reads as arbitrary because it is. `bench-refusal`, the keyframe the
rule played, is gone from `base.css` with it. **This app now authors no
animation at all** — not counted down from a shrinking total the way this
section used to, but zero, stated once.

The larger type and the wider gaps on `/` remain that page's own rules in its
own `<style>`, as they were before the prop existed and as they will stay
regardless of what, if anything, is ever keyed off the stance again. `data-stance`
itself is not deleted alongside the rule that used to read it: it still
distinguishes `/` from every document route, correctly, in every state
`e2e/site-stance.spec.ts` checks. What it buys today is only the place for a
rule that must not be one page's private decision, should one be written again —
a reveal written locally is a reveal every later page can write locally too,
and a rule in a site-wide stylesheet that only one stance can reach is
unreachable elsewhere in a way a component's own rule is merely unclaimed. That
argument is what originally justified the attribute and is why it survives
having nothing to key off twice now. **It does earn its place, and what it earns
it as has changed**: the attribute's consumer is no longer a stylesheet but a
check. `e2e/site-stance.spec.ts` reads it on every route the site serves and
holds each one to the stance this document assigns it, which is what makes "every
page is one of a named set" a thing that fails a run rather than a claim nobody
can falsify. An attribute driving no CSS would be dead weight; one that is the
only machine-readable statement of a rule in this document is the opposite. If a
rule is ever keyed off the stance again it inherits a marker already proven
correct on every page, which is the cheaper order to do those two things in.

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

**`/design` is public and unlisted, and that is ruled rather than pending.** The
sheet stays served at `/design/`, and the header's navigation does not name it.
Nothing else on the site links to it either. It keeps the `document` stance it
was given, so a reader who types the address meets a page shaped like every
other page rather than a developer artefact with a layout of its own, and it
keeps the shared header, so that reader is one press from the rest of the site
instead of stranded on it.

Unlisted rather than listed, because of what the sheet is for. It is a wall of
token names that exists so a later ticket can check its work against the
rendered system, and a reader who came to find out what this library does is not
its audience — another name in the strip would spend the site's navigation on
the site's own scaffolding. Public rather than moved or made build-only,
because it has to be rendered by the same build, in the same themes, from the
same tokens, or it stops being evidence about the shipped site; and a served
address a reader can type costs nothing a build-only artefact would not also
cost.

**The sheet survives 320px by breaking a word, which is the opposite trade from
the provider table's.** Its type specimen sets one line of prose at every rung,
and at `--text-4xl` a single word of that line is wider than a 320px viewport.
A grid item's automatic minimum size is its min-content width, so that one word
set the minimum width of the list, the section and the page, and the whole sheet
went sideways under a reader who never asked it to. `.specimen__sample` now
carries `overflow-wrap: anywhere` — `anywhere` and not `break-word`, because
only the first of the two counts the break opportunities it creates towards
min-content, which is the measurement that was doing the damage. A specimen that
breaks a word still sets its glyphs at the size its token says, which is the
only thing the list is there to show. The provider table further down takes the
other route, a real minimum width inside a container the reader scrolls, and
that is right there for the reason it is wrong here: four columns of machine
output cannot be narrowed, and one line of prose can.

This was found by widening a check rather than by looking: `e2e/site-nav.spec.ts`
now measures every route the site serves at 320px, where it used to measure the
two page shapes the header is drawn on. The sheet is neither of those, so the
widest page on the site was the one page nothing had ever narrowed.

**`stance` and `documentation` are two axes and only correlated.**
`documentation` answers whether a page belongs in the search index; `stance`
answers how it is dressed. `/design` is `documentation={false}` and
`stance="document"`, and that pair is the proof they are not one prop:
collapsing them would make either fact unstatable without the other. `/` happens
to sit at one end of both, which is what makes the two look like the same
question until a third page appears.

`e2e/site-stance.spec.ts` pins the parts of this a reviewer would otherwise have
to take on trust: that `/` carries the argument stance, that a document route
carries the other, and that nothing on either is mid-travel, with no script and
under reduced motion alike. It has moved subject twice now. It first pinned
`.u-enter` and `data-enter`, and could not keep doing so once nothing on the
site wrote either — a spec that had to mark an element itself in order to have
something to assert about would be pinning its own fixture. It then moved to
the reason line's arrival, and lost that subject the same way when the line
was deleted rather than shrunk further. What is left to pin is narrower than
either — that the attribute itself is correct, and that nothing on the page is
caught mid-animation, which is true today by there being no animation to be
caught in and worth continuing to check regardless.

## Depth, motion, and the four audit constraints

A deterministic detector was run against the comps and found real defects. These
are acceptance criteria for anything added to this site, not style advice.

- **No tracked-caps eyebrow chip above an `h1`.** A named tell, and it was on
  every comp. The bench's two switch legends, `SOURCE` and `SKIN`, are tracked
  caps in mono and are not eyebrows: they sit below the `h1`, they name a group
  of controls rather than dressing a heading, and they set at `--text-fn` rather
  than under it. What the constraint is against is small caps used as a label
  for a title that does not need one.
- **No 1px border under a wide shadow blur** (24px, 60px). That pairing was the
  comps' entire depth system, and it is a named tell too. It is still banned,
  and the rule below is written so that it cannot be assembled by accident.
- **Functional text at 11px or above.** See `--text-fn`.
- **Animate `transform`, its longhands and `opacity` only.** Never `max-height`
  or `width`: those lay the page out again on every frame, and every effect that
  seems to need them has a composited equivalent — a translate or a scale under
  `overflow: hidden`.

**These four passed on `/` for a long time and they did not pass everywhere, and
this document said otherwise.** The second was being broken on every page of the
site by three shadcn defaults, each pairing a border with a shadow:
`DropdownMenuContent`, the `Button` `outline` variant, and `SheetContent`. All
three are fixed, and the fixes are recorded under _shadcn_ below. The honest
thing to say is not that they were corrected but that the claim was false for
however long those components had been in the tree, because nothing on this site
checks it: the four constraints are read by people, and a component adopted from
outside arrives with somebody else's depth system already assembled in a class
string. The lesson is written into the adoption rule below rather than left as
an incident.

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
`.bench__frame` in `Bench.astro`, the box the player sits in on `/`, and to
nothing else. It is the element that page is built around, and a second
instrument on one page means neither is the instrument. Nothing in the readout
under it takes an elevation: the switches and the quiet line under the frame are
controls and text on the page itself, and the composition panel is a
`--color-sunken` well, which is a step _down_ the ladder because printed code
is a recess in this system wherever it appears. A report of what the instrument
answered is not a second instrument, and two earlier versions of this sentence
each named an element that was not one: a capability grid, and after it the
bench's reason line — both designed, both cut, neither ever a candidate for an
elevation of its own. Naming either here was this document holding an
allowlist open for an element the maintainer had already refused, or that had
since been refused in turn.

`--elevation-panel` belongs to two things, and both of them are surfaces laid
over the page rather than panels sitting in it: the search dialog in
`SearchCommand.tsx`, and `DropdownMenuContent`, which is what draws the theme
switch's menu. Neither carries a border, because rule 4 forbids an elevated
surface one. The menu is the newer of the two and arrived by correction rather
than by design: shadcn ships that component with `border` and `shadow-md`
together, which is the banned pairing exactly, and the fix was to drop the
border and spend the named token rather than Tailwind's untokenised shadow, so
the menu now takes its depth the same way the dialog beside it does.

**This list held three entries and now holds two, and both departures are worth
naming.** The receipt's body left when `/` stopped printing a request log. The
bezel around the hero's player left when `HeroPlayer.astro` was deleted: the
bench draws one frame where the hero drew a bezel around a stage, and one frame
spending `--elevation-instrument` is the whole of the depth on that page.
Everything else on this site is a step on the surface ladder and a hairline, as
before. A new elevated element is an edit to this list, not a local decision.

The ladder has a top, and it is measured rather than felt: see _Palette_ above
for the `#1F1F26` ceiling and the rejected `#24242C`. Above the overlay the
answer is an elevation. There is no third rung waiting to be added, and a page
that seems to want one is a page with too many surfaces on it.

**This paragraph used to read "No component spends either new role yet."** It
was written when the two rungs had been declared in `tokens.css` and rendered as
swatches on `/design` and nowhere else, and the point it was making was that the
ladder had been stated and measured before anything leaned on it, so the first
panel that wanted a step above `--color-surface` would reach for a rung already
checked against ink rather than inventing one.

**It then said `--color-raised` had found its first consumer, and that has since
become untrue in the direction nobody watches for.** The consumer named was
`/`'s `.readout`, the box a budget table sat in, and `/` was rebuilt as a bench
without one. No element on this site paints `--color-raised` today. The rung is
still declared, still measured against ink on both its grounds, and still
rendered as a swatch on `/design`, so the original point is simply back: the
ladder has been stated and checked before anything leans on it, and the first
panel that wants a step above `--color-surface` reaches for a rung already
verified instead of inventing one. `tokens.css`'s own comment beside the role has
been corrected to match.

What the retired paragraph was right about is worth keeping, because it is what
the next consumer will need. The rung names a panel raised off whatever it sits
on, and the ground it is measured against is the ground it is drawn on. On the
field in light that is a 1.045 step, which is the figure _Palette_ above gives;
the case that collapses is the other one, a raised surface directly on
`--color-surface`, and that case is what the elevations and the hairline are for.
A row picked out of a panel is the rung's other use and is equally available.
Whatever takes it will take colour and nothing else: no elevation, because rule
4's allowlist names by hand what may spend one, and therefore no border either,
which is the half of that rule that keeps the banned pairing unassemblable.

**`--color-overlay` has gone the other way in the same sweep, and now has a real
rendered consumer.** `shadcn-theme.css` maps `--popover` onto it and
`DropdownMenuContent` reads `bg-popover`, so the theme switch's menu is drawn in
this role on every page of the site. That is exactly what the role was declared
for, a surface over the page rather than in it, and it arrived without anybody
choosing it: aliasing shadcn's vocabulary onto these roles is what put a
consumer on the far end of a name. Two facts about the same pair of rungs moved
in opposite directions at once, which is the argument for checking a document
against the tree rather than against the last thing that changed.

**This app writes zero animations.** The count has been three, then one, then
zero, and this document has been late to it more than once, so the arithmetic
is worth setting out rather than restating and worth stating plainly rather
than counted down from again.

Three was the `.truth-card` entry motion, the capability ledger's resolution
and the sweep band travelling in from the left. All three belonged to elements
`/` no longer has, and an animation does not carry forward to what replaces it.
One was what took their place across two further rebuilds: the bench's reason
line, fading and rising `--space-1` at `--duration-base` when the mounted
provider answered `unavailable` to something the page asked about — the
`bench-refusal` keyframe, selected by
`[data-stance='argument'] [data-bench-reason][data-live]`. That line is deleted
in turn. It named one refused capability out of however many a provider
actually refused, picked by the iteration order of a lookup table a reader had
no way to see, and the maintainer's own assessment of the result was that it
"feels random" — which is a design defect in what the line claimed to be
reporting, not a reason it needed a lighter touch of the same idea. Given the
choice between naming every refusal and continuing to name one chosen by
object-key order, the capability argument left `/` outright. `ReasonLine.tsx`
and `bench-capabilities.ts` are deleted, and `bench-refusal` and its
`prefers-reduced-motion` override are deleted from `base.css` with them.

The count is a count of what this app authors, and it is worth saying so rather
than letting a reader find a moving element and conclude the rule had quietly
lapsed. Three other things move on this site and none of them is in the count.
The two archetypes animate `background-color` from their own stylesheets, on
`/archetypes` only, outside rules 1 and 5 for the ownership reason above.
shadcn's dialog, sheet and dropdown open and close through `tw-animate-css`,
which is a dependency's keyframes applied by a utility class, and they move
`opacity` and `transform`. And `@playdeck/react/theme.css` brings its own
transitions to the bench the moment a reader presses the `theme` skin, which is
that stylesheet doing on this page exactly what it does in a consumer's.

The count is the rule; the argument it was making is why the count went to zero
rather than staying at one. Scattered reveals down a page are the
generated-landing-page tell in motion form, and this section has always argued
that one authored moment is worth more than several. What the last cut shows is
that the same argument applies to a single moment that turns out not to be
honest about what it is reporting: a line whose arrival looked like a real
state change but whose content was an artefact of iteration order was decoration
wearing the shape of an argument, and cutting it is the same move as cutting the
five scattered reveals was, made once more against a smaller target.

Nothing this app writes moves on entry, now in fact rather than only in
standing prohibition. `[data-stance='argument']` still exists on `/`'s `<body>`
— see Stances for what, if anything, that attribute is still worth without a
rule to key off it.

Rule 5's list of animatable properties — `transform`, its longhands, and
`opacity` — is unchanged by any of this and remains the list every future
animation this app writes is bound by, should one be written. Every colour
change on this site still snaps.

`prefers-reduced-motion: reduce` collapses durations, which lands each
transition on its settled state immediately. That only works because every
transition moves between two settled states; an effect that leaves an element
mid-travel or invisible when its motion is removed is a bug in the effect. With
no animation authored, there is nothing left for that rule to apply to on this
site's own rules — it still governs `tw-animate-css`'s dependency keyframes and
the theme's own transitions, which is where its coverage now actually lands.

Focus is one treatment for the whole site: a 2px `--color-accent` outline on
`:focus-visible`, offset by 2px. An outline rather than a shadow, so it follows
the element's own shape and survives forced-colors mode.

That it is still the treatment a reader gets is checked rather than assumed, on
every route, by `e2e/site-nav.spec.ts`. The check tabs into each page and
compares the outline an engine painted against the accent that page resolved,
because since #542 five of the site's controls are shadcn's, whose own classes
set `outline-style: none` at the same specificity as the rule above — which of
the two wins is a question about a cascade, and only a browser answers it.

Every control carries a rest, a hover, a focus and a pressed state, and none of
them is a lift. The theme switch darkens to `--color-sunken` on hover, and the
bench's switches take an accent border while pressed, which is the same move
made in the two vocabularies the site now speaks: the switch is a Tailwind
`hover:bg-accent` resolving through `shadcn-theme.css` onto the sunken well, the
bench's pills an `active:border-[var(--color-accent)]`. One treatment, two
spellings, and the seam is where the alias is written rather than where the
class is. Every link on the site presses to
`--color-ink-subtle`, which is one rule in `base.css` — a step down the ink
scale reads the same way from any of the rest colours a link here takes, whether
that is the accent, the muted ink of a crumb or the full ink of the wordmark. A
component that styles its own `a:hover` outranks that selector and restates the
press: the rail's links and the header's crumbs both do.

Colour changes are not transitioned, because colour is not one of the properties
this system animates. The two transitions this app writes are the disclosure
chevrons in `RailDisclosure.tsx` and `SourceDisclosure.tsx`, which rotate a
quarter turn when the element opens, at `--duration-fast`, and stop transitioning
outright under `motion-reduce`.

### Rule 5 was widened, and `transform`'s longhands are why

Rule 5 read **"Only `transform` and `opacity` are animated."** It now reads
`transform` **and its individual longhands**, and `opacity`. The amendment is
real rather than a tidy-up, and it was made because the rule as written would
have failed the tree on a distinction with nothing behind it.

Tailwind's `transition-transform` in this version expands to
`transition-property: transform, translate, scale, rotate`. Those last three are
transform's own longhands from CSS Transforms Level 2. They are the same
property decomposed, the compositor treats them identically, and the browser
lays nothing out again for any of them. A reader measuring the built page would
find four names where the rule named one, and rewriting the two chevrons to
spell `transition-[transform]` by hand would buy nothing but a rule that had
been satisfied by fighting a tool. The maintainer ruled the two compliant and
the rule follows the ruling.

What the rule is against is unchanged and is the reason it is worth stating
precisely: a property whose animation costs layout or paint on every frame,
`max-height`, `width`, `top`, `background-color`. Adding three names that
composite exactly as the one already permitted costs the rule nothing. The
nearest precedent on this site is the `enter` and `exit` keyframes
`tw-animate-css` gives the tooltip and every other shadcn overlay: each declares
`filter: blur(var(--tw-enter-blur, 0))`, the variable is never set to anything
else here, so the declaration interpolates `blur(0)` to `blur(0)` and paints
nothing. A property outside the rule's list, animated in name only, and left
alone for the same reason. Both are cases where the honest reading of "what is
animated" is what the frame actually does rather than how the declaration is
spelled.

### Entry motion, and the vocabulary that was built and never used

`base.css` used to hold a site-wide entry-motion vocabulary: a `.u-enter` class,
a `data-enter` from-state, a fade and a `--space-3` rise at `--duration-slow`,
and an `IntersectionObserver` on `/` that removed the from-state as each marked
element came into view. **All of it is deleted, and it is deleted because
nothing ever applied the class.** The one page it could reach was rebuilt twice
and neither rebuild marked an element, so the observer was constructed on every
visit to `/` to watch an empty list, and the rules were unscoped CSS every page
of the site carried in order to match nothing.

That is worth recording rather than removing quietly, because the vocabulary was
argued for at length and the argument was not wrong. A reveal written into one
page's `<style>` is a reveal the next page writes again with its own duration and
its own distance; a site-wide class keyed off `[data-stance='argument']` is one
fade, one rise, one easing, inert everywhere but the page that argues. What the
episode actually shows is a different failure: a vocabulary can be correct and
still be dead weight if nothing needs it yet, and the cost of keeping it was
paid by every page on the site.

**The entry motion the site had after that was the bench's reason line, and it
did not survive either.** It ran off `data-live`, an attribute written inside a
React commit at the moment the element and its words first existed, rather than
off an observer watching for an element to be scrolled to — a fact about a
provider answering rather than a fact about a reader's scroll position, which
was the point of building it that way. But the line itself was cut, in a later
round of the same page's capability argument: it named one refused capability
out of however many a provider actually refused, picked by a lookup table's
iteration order, and the maintainer's assessment was that this reads as
arbitrary. The animation left with the element it dressed.

**This app authors no animation at all, as of that cut.** Not the vocabulary
above, not the reason line that replaced it as this section's subject, nothing
else written since. `[data-stance='argument']` still exists on `/`'s `<body>`
and still distinguishes it from every document route — see Stances — but there
is no rule left anywhere in this codebase keyed off it. The three constraints
below are kept as a record of what any animation this app writes has always had
to satisfy, should one be written again, rather than as a description of
something currently running:

- **The resting state is what the CSS gives the element.** There is no
  `opacity: 0` default anywhere on this site. The animation is `both`-filled
  from a from-state it declares itself, so a reader whose script never runs, or
  who has asked for no motion, gets the settled element. Written the other way
  round, with an element hidden until something arrives to reveal it, the page
  would blank itself on the one failure it has to survive — the same reasoning
  that makes the bench's island `client:only`.
- **`prefers-reduced-motion: reduce` removes the animation rather than
  shortening it.** The site-wide duration collapse is deliberately not what
  handles this case: it rescues a transition by landing it on its settled state,
  and the honest answer to a reader who asked for no motion is that nothing was
  started.
- **Scroll-linked and parallax effects are rejected outright.** They have no
  expression here and are not to be given one. A page whose paint is a function
  of scroll offset is this section's tell drawn continuously instead of once. The
  bench on `/` is driven by pointer and keyboard and never by scroll offset, and
  an interactive page does not reopen this question. This was the one of the
  three that had nothing to do with the observer, and it is why the deletion of
  everything above it changed nothing about what is banned.

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

**The keyboard model did not change when the chrome did.** `/` opens and
focuses, arrows move, Enter opens the highlighted result, Escape dismisses. The
results are an ARIA listbox named by `aria-activedescendant`, so focus stays in
the field while a screen reader follows the highlighted row, and the count is
announced through a `role="status"` line.

**What changed is who provides it.** The dialog was a `<dialog>` opened with
`showModal()` and a combobox written by hand; it is a shadcn `Dialog` around a
`Command` now (`SearchCommand.tsx`), which is the same swap the header and the
theme switch made. Three of those behaviours turned out not to survive the move
on their own, and each is worth recording because each failed silently and the
suite is what caught them:

- **`/` was dropped when pressed before the island hydrated.** A press as soon
  as navigation resolved opened nothing; the same press two seconds later
  worked. The shortcut is back in an inline script in `DocsSearch.astro`, for
  the same reason `Base.astro`'s theme script is inline: it has to be listening
  while the document parses. It holds a press made before the island is ready
  and dispatches it again once the island says it is.
- **`aria-activedescendant` named nothing for the first result of a query.**
  `Command` recomputes the selected item's id only on the store write its arrow
  keys go through, so the first press of an arrow key fixed it, which is one
  press too late: the result Enter would open is the one a reader following the
  input was never told about. `SearchCommand.tsx` mirrors the attribute from
  the DOM instead. This is not a consequence of driving the selection from
  outside; it was measured the same with the selection left to `Command`.
- **Escape left focus on `<body>`** rather than on the control that opened the
  dialog. Both ends of the focus journey are set explicitly now.

None of this is an argument against the component. It is an argument for
checking that a swap kept what the thing it replaced was doing, since all three
of these look perfect in a screenshot.

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
  only to the inner scrollers — a code block, the rail, and the bench's
  composition panel — where a
  platform-width bar reads as a second border; the page's own scrollbar keeps
  its full hit target. Standard properties only, never `::-webkit-scrollbar`,
  which would be a second and engine-specific description of the same thing.
- **The caret** is `--color-accent`. The search field is the one place on this
  site a reader types, and caret browsing puts a caret on every other page.

The utility classes live beside them in `base.css`. They are the classes in this
system not owned by one component, and a new one has to earn that:

- `.u-tabular` sets `font-variant-numeric: tabular-nums`, for figures that sit
  above one another — a version number in a list. Plex Sans's default figures
  are proportional and do not line up. Applied by class rather than to `code`,
  because an identifier gains nothing from it.
- `.u-visually-hidden` is present for assistive technology and absent for
  everyone else. It exists for the case where the visible text is deliberately a
  fragment of the real name: the rail shows `core`, and this is what keeps the
  link named `@playdeck/core`. Its second use is the same shape seen from the
  other side — the install line's `role="status"` on `/` says in words what the
  copy button's own text change says visually, because a button's name changing
  under a reader who has already pressed it is announced by nothing.

There were three, and `.u-enter` is gone with the vocabulary it marked. It is
named here rather than dropped because it is the counter-example the rule above
needs: a class earns its place in `base.css` by having more than one owner, and
that one was admitted on the strength of an argument about the second owner it
would eventually have. It never got one. Both survivors were admitted for a use
that already existed, and both still have two.

## Where things live

| File                                   | What it is                                                |
| -------------------------------------- | --------------------------------------------------------- |
| `src/styles/tokens.css`                | Every value. The only stylesheet with hex literals        |
| `src/styles/base.css`                  | Element defaults, spoken in tokens                        |
| `src/styles/doc.css`                   | The shell and the prose of a rendered document            |
| `src/styles/tailwind.css`              | Tailwind without preflight, layered so it cannot win      |
| `src/layouts/Base.astro`               | The document, its stance, and the pre-paint theme script  |
| `src/components/SiteHeader.astro`      | The shell above every page, and the site's navigation     |
| `src/components/ThemeToggle.astro`     | Mounts the theme control                                  |
| `src/components/DocsSearch.astro`      | Mounts search, and owns the `/` shortcut                  |
| `src/components/Sweep.astro`           | The one gradient, and its two forms                       |
| `src/components/sweep-id.ts`           | One `<linearGradient>` id per render, build-wide          |
| `src/components/DocRail.astro`         | The rail beside a document, both sets of them             |
| `src/components/Bench.astro`           | The bench's frame, the band on it, and the player theme   |
| `src/components/BenchIsland.tsx`       | The bench's composition, and the site's only hydration    |
| `src/components/BenchSwitches.tsx`     | Source and skin, as native radios in a `<fieldset>`       |
| `src/components/CompositionPanel.tsx`  | The code the switches built, unhighlighted on purpose     |
| `src/bench-sources.ts`                 | What each source position plays, bundled per provider     |
| `src/bench-composition.ts`             | The switches' positions rendered as source to copy        |
| `src/bench-quiet.ts`                   | What the page has fetched, and the sentence for it        |
| `src/components/ProviderTruth.astro`   | The provider comparison, and its table                    |
| `src/components/SearchCommand.tsx`     | Search's dialog and combobox, on `Command`                |
| `src/components/SiteNavSheet.tsx`      | The header's collapse below 40rem, on `Sheet`             |
| `src/components/ThemeToggleIsland.tsx` | The theme choice, on `DropdownMenu`                       |
| `src/components/RailDisclosure.tsx`    | The rail's "Contents", on `Collapsible`                   |
| `src/components/SourceDisclosure.tsx`  | An archetype's source well, on `Collapsible`              |
| `src/components/ui/*.tsx`              | shadcn components, owned here rather than depended on     |
| `src/lib/utils.ts`                     | `cn`, the class merge every shadcn component calls        |
| `src/styles/shadcn-theme.css`          | shadcn's variable names, aliased onto this site's roles   |
| `src/pages/index.astro`                | The landing page at `/`, and its links                    |
| `src/pages/start.astro`                | The quickstart at `/start`, printed from `examples/`      |
| `src/pages/design.astro`               | The specimen sheet, served at `/design`                   |
| `src/pages/archetypes.astro`           | Two composed players, and the files they are              |
| `src/pages/guides/index.astro`         | The guide index, served at `/guides`                      |
| `src/pages/guides/[guide].astro`       | One guide per migrated workbench document                 |
| `src/pages/reference/index.astro`      | The package index, served at `/reference`                 |
| `src/pages/reference/[pkg].astro`      | One reference page per publishable package                |
| `src/pages/providers/index.astro`      | The provider index, served at `/providers`                |
| `src/pages/providers/[provider].astro` | A setup page per provider group                           |
| `src/content.config.ts`                | The document collections, and their loaders               |
| `src/reference-packages.mjs`           | Which packages get a page, and from where                 |
| `src/provider-pages.mjs`               | Which providers get a page, and which sections            |
| `src/guide-pages.mjs`                  | Which workbench documents get a page, and how they render |
| `src/provider-asymmetry.mjs`           | What that same document says each provider can answer     |
| `src/shiki.ts`                         | The two theme names and the five colours they repaint     |
| `src/asset-url.d.ts`                   | The type for a `?url` import, which is how the skin loads |

Two of the rows this table used to carry, `HeroPlayer.astro` and
`HeroPlayerIsland.tsx`, are deleted. Nine files replace them, and the split
between them is the one the library itself draws: `Bench.astro` decides what the
instrument looks like, `BenchIsland.tsx` composes primitives and reads what they
report, and neither can quietly grow the other's job because neither can express
the other's. The four `bench-*.ts` modules under `src/` rather than under
`src/components/` are the parts with no markup in them at all: a table of
sources, a string builder, two dictionaries and a small state machine. Each is
pure, and each is unit-tested without a browser, which is the whole reason they
are not inside the components that call them.

**The header** carries the wordmark returning home, the path from the root to
where the reader currently is, the site's own navigation, search, and the theme
switch. This is a documentation shell and not a marketing bar, so there is still
no call to action. It is not sticky: a reference page is a whole README, and the
one element a reader navigates a long document with is the rail, which is sticky
already. One per page.

**It used to read "three jobs and no fourth", search named among the things it
would not carry.** That rule was aimed at everything a reader did not come for,
and search is the one thing in that strip a reader of a long document does come
for — see _Search_ below.

**It then read "no call to action and no product navigation", and the second
half of that is gone.** The header now carries the site's sections — Guides,
Reference, Providers, Archetypes — on every page, named here rather than
counted, because the list has already grown once since this paragraph was
written. That is a maintainer's decision rather
than drift, and it was asked for in those words: links at the foot of `/` and
nowhere else, when the reader who most needs the next document is the one who
has just finished reading one. The rule the amendment was written against is the
same rule search was let past: what the strip may carry is what a reader came
for, and a reader of a document did come for the next document. The site's own
sections are that; a product navigation selling the library is not, and would
still be refused.

What the rule still forbids is unchanged and is worth restating, because the
list named above is the kind a reader is always tempted to extend by one. **A
header here gains nothing that sells, and nothing that duplicates a page's own
navigation.**
The workbench is not among the destinations and will not be: #534 records the
decision that it is not to be a public surface, and the same ruling was made
about a Storybook link on `/`. What the site carries out is the absence of
links, which is the half of that decision that is a design question at all. No
link to it survives anywhere on the site: `/design`
carried the last one and no longer does, and `design.astro`'s own header records
the absence rather than leaving it to be rediscovered. The other half followed:
the deployed artifact is this site alone, so there is nothing at
`playdeck.video` for a link to reach.
`e2e/site-nav.spec.ts` asserts the absence on both page shapes, because it is
the link most likely to be added back by someone reading this strip as a list of
everything the repository builds.

**This paragraph read "the row is a second line, not a disclosure, and it needs
no script", and every clause of it is false.** It described a row taking
`flex-basis: 100%` under the trail, visible at every width, with no state to
announce, and it argued that three short words did not need the disclosure the
rail gets. That was true of the row as first built and stopped being true when
this header was rebuilt on shadcn: there is no second line, no `flex-basis`
anywhere in the file, and below `40rem` the names live inside a `Sheet` that
does not exist until a script mounts it. Nothing in the repository failed
while the layout moved out from under the sentence, which is why it is corrected
here as a false claim rather than quietly edited into agreement.

**What the header does is render one list twice, and exactly one copy is
interactive at a time.** At `40rem` and above the names sit inline beside the
trail, in normal flow and in source order. Below it they are drawn only
inside `SiteNavSheet`'s sheet, reached through a trigger button beside the
trail. `hidden min-[40rem]:flex` on the inline list and `min-[40rem]:hidden` on
the trigger are complementary, keyed to the same breakpoint from both
directions, and the sheet's content is portalled to `document.body` and not
mounted until it is opened — so at rest there is exactly one set of links inside
the `Site` landmark at every width, which is what lets `e2e/site-nav.spec.ts`
count them without knowing the viewport.

**What that costs is a navigation below `40rem` that needs a script, and it is
the same trade the rail records below**: a native element that worked closed
with no JavaScript, replaced by a component that does not. The cost is smaller
here than there. A reader with no script below that width still has the wordmark at
the head of the trail on every document page, and `/`'s close still links
Reference, Providers and Archetypes, so for those what is lost is this route to
a section rather than the section. Guides is the exception, and it is worth
knowing rather than smoothing over: `/` does not link it anywhere, so below
`40rem` with no script that section has no route from the landing page at all.

**Which destination is marked is derived from the path, not passed in.** The
first segment of `Astro.url.pathname` with the deployment prefix taken off, so a
page added under one of those sections is marked without being told to mark
itself and no page can claim a section it is not served from. The prefix is
stripped rather than compared against a literal for the reason every address on
this site is built from `import.meta.env.BASE_URL`: at the apex the two are the
same string, and `astro build --base` is what makes the difference observable
(#435). `/` and `/design` sit in none of those sections, so nothing in the
strip claims to be the page the reader is on there.

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

**A reference page now carries two of the attribute, and that is sanctioned
rather than a defect.** The site navigation marks `Reference` and the rail marks
the package being read. Both are links among sibling links, which is the case
the paragraph above says the attribute does work in, and they sit in two
differently named landmarks — `Site` and the rail's own — answering two
different questions. A reader is in Reference, and in that package; neither
statement makes the other harder to act on. What the breadcrumb rule refuses is
a different shape entirely: two markers describing one trail, one of them not
even a link, where a reader has to decide which is meant. Two landmarks each
naming their own current item is the ordinary case, and the rail's use of it was
never conditional on being alone in the document. The provider pages are the
same arrangement a second time. What would break the ruling is a third marker
inside one of those landmarks, or a marker on something a reader cannot follow —
so the nav emits the attribute on at most one link, and `e2e/site-nav.spec.ts`
pins that it is the section the reader is actually in and only that one.

On `/` the header renders the navigation and the switch, and nothing else. The
trail is not rendered at all: there is nowhere for a wordmark to return to, and a
strip naming the page directly above the page's own `h1` of the same name would
be that word twice in eighty pixels. That `h1` cannot move, because
`scripts/check-deploy-artifact.mjs` identifies the site's root document in a
browser by a heading named exactly `Playdeck` — which is also why nothing in
this header may be promoted to a heading with that name. The destinations are
the reason a reader on `/` is not stranded there without the foot of the page,
and they are internal links on `/`, which that check requires at least one of.

**This used to give a second reason — that the `h1` was "the wordmark at the
title rung" — and that half is no longer true.** `/`'s `h1` still reads
`Playdeck` and still must, but it sets at `--text-lg` in `--color-ink-muted`
now: it names the document, and the display rung goes to the thesis under it.
_Type_ above carries that amendment and its reasoning. So the case for leaving
the trail off `/` rests on the repetition alone, and it survives the change
whole. What does not survive is the reading a later session could take from the
retired clause — that the header may grow a wordmark on `/` now the `h1` has
stopped being one. The `h1` stopped being large, not stopped being that word, so
the repetition argument is untouched; and anything added there would have to
stay a link rather than become a heading, because two elements answering to that
role and name is precisely the ambiguity the deploy check cannot survive.

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

Moving the rail below the document
was the other option and it is worse — source order is what a screen reader and
the keyboard follow, and it would have put the navigation where neither meets it
until after several hundred lines of prose.

**It was a `<details>` and it is a shadcn `Collapsible` now**, in
`RailDisclosure.tsx`, and the swap is the one place on this site where the
shadcn trade cost something a reader can lose. A `<details>` is a working closed
disclosure at every width with no JavaScript; this is not. What does not change
is what a reader without a script can reach: the two lists are rendered by
Astro and passed in as children, so they are in the served HTML either way, and
`forceMount` keeps them in the DOM rather than letting a closed disclosure
delete them.

**At `60rem` and up the element is open and the control is absent.** Both facts
come from one value. The old implementation was a script that had to keep two
things in step, whether the element was open and the `data-rail` attribute the
column rules key off, and the component derives both from a single media query
read, so they cannot disagree. It reads that query with `useSyncExternalStore`
rather than into state in an effect, because a media query is an external store:
it has a value and a subscription, and copying it into state is a second copy of
something the platform already holds. Its server snapshot is `false`, so the
markup Astro renders is the closed disclosure, which is also what a reader whose
script never arrives is looking at.

The reason the state has to be `open` rather than merely revealed is unchanged
and is why a script was load-bearing here in the first place: CSS can show the
content while the element stays closed, which tells assistive technology
"collapsed" about a list its reader is looking at, and at that width the control
that could have corrected it is gone from the tree as well.

**The rail is sticky, and for a while it only said so.** `position: sticky`
travels inside its own containing block, and the grid aligned its items to
`start`, so the rail was exactly as tall as the box inside it, had nowhere to
travel, and had never stuck at any scroll offset. It now stretches to the grid
row and the disclosure is given that height too, because every box between the
scrollport and the sticky one has to be tall enough for it to move inside. The
chain used to have a fourth link, `::details-content`, the anonymous box a user
agent puts inside a `<details>`, and the `@supports` guard that went with it.
Both left with the element: a `Collapsible` is ordinary elements all the way
down, so the height passes through boxes this site can name.

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

It is not part of the site's own navigation, and **nothing on the site links to
it at all.** `/` carried the one link, in the ways-onward row at the foot of the
page, and the rebuilt close carries Start, Reference, Providers and Archetypes
and nothing else. That was not ruled on at the time: the link went out with the page
it was on, and this passage recorded the absence as something waiting for a
decision.

**The decision has since been taken and it matches the accident.** `/design` is
public and unlisted — served at its own address, carrying the shared header, and
absent from the header's destinations. _Stances_ above holds the reasoning.
What changes here is that the absence is deliberate now: a later session finding
this sheet unreachable from the navigation is looking at a ruling rather than at
an oversight, and another name in the strip is a decision to reopen rather than
a tidy-up. `e2e/site-nav.spec.ts` pins both halves — that the sheet is served
and gives a reader the same way back as every other page, and that the
navigation does not name it.

`data-theme` has two writers and they are not interchangeable: the pre-paint
script in `Base.astro` applies a stored choice before the browser paints, and
`ThemeToggleIsland.tsx`, mounted through `ThemeToggle.astro`, writes the
attribute and the stored value on a choice. The storage key is a literal in
both, because an `is:inline` script cannot import the module that would
otherwise hold it.

## shadcn, and what it is allowed to bring

shadcn is the site's component system by the maintainer's call, taken after
being told what it costs in payload. It arrived in #542 and it covers five
interactive parts of the site: the header's collapse below 40rem, the theme
switch, search, the rail's "Contents", and the source wells on `/archetypes`.

**This paragraph used to say "every interactive part", and there is now a
carve-out.** The bench's switches on `/` are a native `<fieldset>` of
`<input type="radio">` elements and no component at all. The argument is this
document's own, turned round: what shadcn bought here is behaviour that would
otherwise have been hand-rolled, and a group of mutually exclusive positions has
no behaviour to hand-roll. The grouping, the roving focus, the arrow keys and
the group's accessible name from the `<legend>` all ship in the browser.
Radix's `ToggleGroup` would re-implement them, correctly, for a measured 8.2 kB
gzipped of client JavaScript, on the page whose closing figure is that every
primitive this library publishes comes to 17 kB. A page cannot spend half its
own product on a radio group in the controls it is arguing with.

So the rule is not "use shadcn". It is: reach for a component when it brings
behaviour the platform does not, and reach for the platform when it does. That
line is where a payload argument and an accessibility argument agree, which is
rare enough to be worth writing down as the test rather than as an exception to
one. `BenchSwitches.tsx` carries the same reasoning at the point of use,
including the two alternatives that were weighed and the measurement.

**It brings components, not values.** This is the rule that keeps rule 1 intact.
The `bg-*`, `text-*` and `border-*` classes those components carry read shadcn's
variable names, and `src/styles/shadcn-theme.css` aliases every one of them onto
a `--color-*` role this system already had. They resolve to this site's palette
or they resolve to nothing; there is no second set of colours in the tree. Where
a component needs spacing, a type size or a duration, it reaches for the token
directly through Tailwind's arbitrary-value syntax (`[var(--space-3)]`) rather
than for Tailwind's own scale, which is numerically close to this site's in
places and would be a second literal sitting beside the first.

**What it bought is behaviour, and that is the honest reason to have it.** A
focus trap, an Escape handler, announced open and closed state, a combobox that
implements the arrow keys. Every one of those existed here before, written by
hand, and each hand-rolled copy was a place for a defect to live alone. The
header, search and both disclosures used to be four separate answers to
"disclose some content"; they are one now.

**What it cost is written down rather than glossed.** Two of those four were
native elements that worked with no JavaScript, and the shadcn versions do not.
The maintainer was told and took the trade. The mitigation is that no _content_
depends on the script: the rail's links and the archetypes' printed source are
rendered by Astro and handed to the island as children, so they are in the
served HTML either way, and both islands use `forceMount` so a closed disclosure
hides its content rather than deleting it.

**A shadcn component is source in this repository, not a dependency**, which is
the model shadcn is built on. `src/components/ui/*.tsx` are ours to edit and
they have been edited. Two things follow. A component that is wrong here is
fixed here rather than worked around, and a component's default look is never
what ships: the defaults are Tailwind's palette and radii, which is exactly the
templated appearance the rest of this document exists to prevent.

**Three of those defaults were breaking rule 4 on every page, and this document
was claiming otherwise the whole time.** Each paired a border with a shadow,
which is the named tell the audit banned:

- `DropdownMenuContent` shipped `border` with `shadow-md`. It is the theme
  switch's menu, on every page. The border is dropped and the shadow is now
  `--elevation-panel`, the named token, because a menu is a surface over the
  page and that is the token for one. It is on rule 4's allowlist above as a
  result.
- The `Button` `outline` variant shipped `border` with `shadow-xs`. That variant
  is what the theme switch's trigger is. The border stays and the shadow goes,
  because the trigger is a control in the header and not a panel over anything,
  so spending an elevation on it would be the wrong half to keep.
- `SheetContent` shipped `shadow-lg` beside a per-side border. It is the mobile
  navigation below 40rem. Same fix as the button: the border is the depth cue a
  panel flush to the edge of the screen needs, and the shadow is what has to go.

`SheetContent` carried a second defect found in the same pass, and it is a
different class of thing. It used the bare Tailwind `transition` utility, which
sets a duration and no `transition-property`, and CSS's own default for that
property is `all`. So a reader who flipped the theme while the sheet was open
transitioned `background-color` and `border-color` over 200ms, which is a
violation of rule 5 nobody wrote. It now carries `transition-none`, which is
exactly the fix `DialogContent` had already been given for exactly this, and the
repetition is the finding: `transition` with no property beside it is a trap this
tree has now fallen into twice.

**The honest statement is not that these are fixed but that the claim was
false.** _Depth, motion, and the four audit constraints_ above said all four
passed. Three of them did. The fourth failed from the moment these components
were adopted until they were read against the rules by hand, and nothing failed
in between, because the four constraints are checked by people and a component
adopted from outside arrives with somebody else's depth system already written
into a class string. Adopting one is therefore an audit rather than a copy, and
that is now the rule rather than the lesson.

## The landing page

`/` is the site's front door, and it is one instrument in three parts: a thesis,
the bench, and the close. There are no sections per feature, no `data-section`
attributes and no headings below the `h1`. `e2e/site-landing.spec.ts` pins what
the page says and does rather than the order of blocks it no longer has, and
`e2e/site-bench.spec.ts` and `e2e/site-quiet.spec.ts` pin the two things about
it that a screenshot cannot check.

**This passage has now described six pages, and the count is the point.** The
first argued in sentences and asked to be believed. The second argued by
running the thing and printing what running it cost, across eight sections and
8,679px, and was rejected as a documentation page wearing a landing page's
spine. The third kept that instinct and lost the reader anyway: "this is a huge
page that doesn't make sense", "nobody knows wtf a capability ledger is". The
fourth said the right things in the wrong shape and was rejected for the shape.
The fifth was six sections down one column, each a claim in a heading followed
by the code backing it, and nothing was wrong with it that a reader could point
at. It was correct, honest and dead: every section had the same shape, nothing
on the page was larger than anything else, and the only element that was
actually alive appeared once in the hero and never came back.

**The sixth is not a page of sections at all, and that is the whole of what
changed.** The diagnosis of the fifth was that a library whose argument is about
behaviour was arguing in paragraphs. So the page becomes one thing a reader
operates: a video player as the largest element by a wide margin, two groups of
switches under it that belong to the reader, one line of what the mounted
provider refused, and a panel printing the composition those switches just
built. The features are delivered by working the bench rather than by reading
about them.

**Two of the four features the brief named are no longer sold here, and a later
reader will want to add them back.** Capability querying survives as the reason
line and nothing else: a single line, only when a provider has actually refused
something, in that provider's own words. Autoplay recovery is gone outright. It
had a switch, and the switch could not work: `/` mounts its player with
`loading="interaction"`, so playback can only begin from a user gesture, and
after a gesture the browser permits the audible attempt. The refusal and muted
retry the switch existed to demonstrate can never happen on this page. What was
left was a control whose only effect was to add a prop to the printed
composition, which is a knob arguing by printing itself. Recording this here
because the shape of the mistake is attractive: the feature is real, the
primitive that reports it is real, and the page simply cannot cause the
condition.

**Four other things left this page across its last two rebuilds, and each is
recorded as gone rather than deleted silently.** A `remote` section, which was a
heading, a row of provider names, a sentence and two numbers spread over a
screen's height to say one thing slowly; the five names are in the thesis
paragraph now, where the scope is claimed in one line. A receipt printing a
request log, which the page no longer needs because the line under the frame
reports the same fact about the page the reader is on. The provider comparison,
which moved to `/providers`, because a comparison table is what somebody chooses
a provider with and that is a thing they do after being convinced rather than
while. And the archetypes' licence paragraph, which is a correction rather than
a cut: CC BY asks for attribution wherever the media is played, `/` plays a
colour-bar fixture it serves itself, and a Blender credit on a page playing none
of their work is a false claim about what is on screen rather than an
attribution. `site-landing.spec.ts` used to assert that name appeared nowhere on
`/` and no longer does, which is a gap rather than a decision: the page cannot
carry a Blender clip while `bench-sources.ts` holds the three hosted providers
at `ready: false`, and the day one of them is turned on the attribution question
comes back with it.

**That day came sooner than expected, and by a different door.** `native` and
`hls` are same-origin and were never behind `ready: false` — they carried
`public/tracer.mp4`, the colour-bar fixture, not a hosted provider's clip. But
that fixture was itself the wrong thing for a hero: one second, 320x180,
upscaled to the width of the largest element on the page. It is replaced with a
real excerpt of _Big Buck Bunny_, cut from the same source for both `native` and
`hls` so the switch's argument — same footage, different URL — stays true. The
reasoning above inverts on the same terms it was written: the page now plays
Blender's work, so a Blender credit is an attribution again rather than a claim
about something not on screen, and it is back near the frame — see below.

**And then the door itself was removed.** The maintainer cannot serve video
from this site, so `native` and `hls` — and `public/bunny.mp4`,
`public/hls/`, and the `<noscript>` fallback's `<video>` that played the
former — are gone. `youtube` and `vimeo` took their place at `ready: true`,
pointed at Blender's own uploads rather than a third copy this project would
have had to make, so the credit's terms hold a third time on the same grounds:
the page plays Blender's work, wherever the switch is set. `public/bunny-poster.webp`
did not survive this particular door either — it was the still for _Big Buck
Bunny_, the film both positions played for one round of this section's own
history, and both positions now play _Sprite Fright_ instead (see "The bench's
player, and the site's islands" for why and for the poster that replaced it).
Same-origin still matters for the still that loads before a press, which is
the one thing on this page a hosted provider cannot be asked to do without
lying about what has and has not been contacted — that constraint outlived the
film.

**The bench is two switches and not three, and neither is a demonstration built
for the page.** `source` is the members of `HostedProvider` that have a clip
this project may embed, which is `youtube` and `vimeo` today; `wistia` sits in
`bench-sources.ts` at `ready: false` and becomes a button with a
three-character change once an upload exists. `skin` is `none` and `theme`, and
the switch loads and unloads `@playdeck/react/theme.css` as a real `<link>`
rather than importing it, so the unstyled position really is unstyled. That is
what actually ships, and showing it argues better than a paragraph saying no
stylesheet is in the bundle.

**`theme` is the resting position, and it was `none` first.** `none` is the
honest one and it is still what the argument is about, so leading with it looked
right on paper. Rendered, it is a player with no chrome, a full-width native
range input and two `<time>` elements the browser sets flush against each other,
and it is what a reader meets before they have pressed anything. The maintainer
looked at the two and said the unstyled position reads as a broken embed rather
than as an argument. That is the right read: a first impression of a player that
appears not to work sells the library worse than no demonstration at all would.

So the page opens on the one stylesheet the library publishes and `none` is what
a reader presses to see underneath. The demonstration survives the reversal
whole, because both positions are still one press apart. What changed is which
of them has to be asked for.

**One thing did have to change in the composition rather than in the default.**
`Player.Time` renders a bare `<time>`, so two of them adjacent print as
`1:2410:34` with no CSS to separate them. That is not an unstyled control, it is
a broken one, and the `none` position cannot afford to show a broken control
when its whole job is to show what ships. `BenchIsland.tsx` prints a separator
between them as its own text. A consumer writing that composition by hand would
do the same, which is the test of whether something belongs in the composition
or in a stylesheet.

**There is no capability table, grid, ledger or line, and all four of those
were designed in full before being cut.** The page that stood here carried a
five-row panel headed "Asked of this browser, right now"; a draft of the
replacement proposed a ten-by-five grid of every capability against every
provider. The maintainer rejected both, in these words: "doesn't fit at all".
They are right, and the reason is worth keeping: a matrix is a documentation
object, it asks a reader to hold ten rows and five columns in their head while
they are still deciding whether to keep reading, and it spends the largest
block of space under the video on machinery. The word "ledger" is rejected
outright and appears nowhere on the page.

**What replaced the grid was one line, and it did not survive either.** `ReasonLine.tsx`
printed the mounted provider's name and the first capability `capabilityWords`
in `bench-capabilities.ts` found refused, in that object's own key order —
which is not an order a reader has any way to see, so which refusal appeared on
screen depended on where its capability happened to sit in a lookup table
rather than on anything about the refusal itself. The maintainer's assessment,
in their own words: "this feels random". They are right, and the design error
was in writing a rule that picked one arbitrarily and calling the result a
report. Offered the choice between naming every refusal a provider makes and
continuing to name one chosen by iteration order, the ruling was to cut the
line rather than either grow it back into a list or keep the arbitrary version.
`ReasonLine.tsx` and `bench-capabilities.ts` are deleted, along with
`e2e/site-bench.spec.ts`'s assertions on `data-bench-reason` and `data-live`
and the `@real` test that drove a refusal to check them.

**`/`'s capability argument is now nothing, and that is stated as the end of a
progression rather than as a gap.** Grid, panel, ledger, one line, no line —
four designs and four cuts, each one attractive enough on its own to be
reinvented by a later reader who has not seen the three before it, which is
why every ruling above is recorded rather than left to be inferred from a diff.
What is left of the four features `index.astro`'s own module comment used to
list is two: composability, which the composition panel still demonstrates,
and customisability, which the skin switch still does. Capability querying and
autoplay recovery are not sold on `/` at all.

**The page carries one block of code and it is generated, which retires the one
exception `/` used to hold.** The fifth version wrote four snippets by hand in
its own frontmatter, and this document defended them: they were three or four
lines of a real API with the working component left out, so compiling them would
have meant inventing one, and what held them honest was that every identifier in
them existed. That exception is gone. `buildComposition` in
`bench-composition.ts` is a pure function from the switches' positions to the
source a reader would write, so the block cannot describe a composition the page
is not running, and it rewrites itself on every press. The knobs are
compositions and not options, and the panel is how that is shown rather than
claimed.

**One live player, and it is the bench's.** Two full archetypes ran on this page
for two of its lives and were by a wide margin the largest thing on it: two
running products, four hundred lines of composition, their own stylesheets,
their own clip, a poster, a scroll-mount disclosure and a licence paragraph, all
in the middle of an argument about an API. The maintainer's objection was that
too much was going on, and they were most of it. They live on `/archetypes` now,
the page whose subject those two files are, which prints each one's whole source
beside the player it builds. `tracer-45s.mp4` and its poster left with them,
because nothing else served either, and putting them back behind a skin switch
was proposed and refused on the ground that it is still putting them back.

**The line under the frame is live, and it is replaced rather than removed.** At
rest it reads "No video has loaded yet. No provider has been contacted", which
is the product's central claim stated as a fact about the page the reader is on.
A static line stops being true the moment somebody presses play, so `QuietLine`
prints one of four sentences and `bench-quiet.ts` decides which. The state
behind it is a latch and not a reading of the player: a source change returns
the root to `dormant`, so a line derived from the live state would deny a
request the page had already made. History does not revert, and the sentence is
about history.

**One sentence on this page has now been tightened three times, and the third
time is the one worth reading.** The thesis of an earlier version read "zero
requests until you press play", which was exact while the stages were black and
stopped being exact the moment they were given a poster, since a poster is a
same-origin image request before any press. It became "no video request until
you press play". The bench's resting line was then written as "Nothing above has
loaded. No request has left this page", and the paragraph that recorded it
defended the second clause as exact and flagged the first as the one to read
carefully next time somebody changed what the frame shows at rest.

**That happened, and both clauses turned out to be false rather than one.**
`tracer-poster.webp` was added to the frame in the same work, so at rest an
image above the line had loaded, which falsifies the first clause, and the
request that fetched it had left the page, which falsifies the second. The
defence of the second clause was a slip of scope: it argued about requests
leaving this _origin_, and the sentence said this _page_. Those are different
claims and the poster sits between them.

So the resting line is now "No video has loaded yet. No provider has been
contacted", which is what the library actually guarantees. `loading="interaction"`
contacts no provider before a click, and a poster is neither a video nor a
provider. The lesson is not that the wording was careless. It is that this
sentence is the page's whole argument and it has been quietly falsified by three
different changes to what the frame shows, none of which touched the sentence.
`apps/site/test/bench-quiet.test.ts` now carries a test asserting the dormant
string claims neither that nothing has loaded nor that no request has left, so
the next change to the frame fails a gate instead of a reader.

**The close is four figures, the command, the fine print and the ways onward.**
The first figure is measured at build time from `scripts/bundle-budgets.mjs`,
the module `pnpm test:budgets` gates with, so the page and the gate cannot state
different numbers. The other three are facts about how the packages are
published rather than measurements, so they are written. The close had an
end-credits treatment for one page's life: its own dark panel, a three-line roll
set in mono, and a heading over a second copy of the install command. On screen
that was a large mostly empty box at the foot of the page, and the roll was a
joke told in 12px type. A reader who leaves before the close has already had the
whole argument, which is the test every part of this page has to pass, so the
close takes no treatment of its own.

**The install line is the call to action, and it is click-to-copy.** It used to
be printed twice, in the hero and in the credits, from one string in the page's
frontmatter so that the two could not drift; the credits are gone and it is
printed once, so the string is a `const` for tidiness rather than for safety.
The command is selectable text; the
copy button is `hidden` in the markup and revealed by a script. Writing to the
clipboard is the whole of what the control does, so with no script there is
nothing to press rather than a control that swallows a click, and nothing is
lost, because the command was never behind the button. The feedback is a text
swap on the button with the same words said once through a `role="status"` line.

**The page makes no claim about any other library.** No comparison, no named
competitor, no implied one. A draft opened with "every video player ships a
design", which is false: react-player ships no stylesheet and says so in its
README. The maintainer ruled the whole category out, and it is recorded here so
that a later session does not reintroduce it as a copy tweak.

**The page does not ask to be pressed.** No prompt, no instruction, no "try it"
line. The switches are visible controls under a video and a React engineer knows
what a switch is. A page that explains its own interface is a page that does not
trust it.

**Prose is held to `--measure` on the page**, and the page's own
maximum is `72rem`. The width buys the readout its two columns, not longer
lines.

One constraint on that page is `scripts/check-deploy-artifact.mjs`'s rather
than this system's, and it is load-bearing: its `h1` is exactly `Playdeck`,
which is how that check identifies the site's root document in a browser.

There used to be a second: the workbench link had to be the last internal link
in the document, because the check followed every internal link in one page
context and navigating away from the workbench abandoned requests it was still
making. That check now visits each link in a page of its own (#528), so a link
may be added anywhere in the list. The constraint is written down here as gone
rather than deleted silently, because it governed the order of that list for
long enough to look deliberate. The workbench itself is linked from nowhere on
this site (#534), which is a separate decision and still in force.

### The provider asymmetry readout

`ProviderTruth.astro` is the provider comparison, and its claim is asymmetry:
five providers behind one API is the kind of sentence that invites
a reader to assume they are interchangeable, and they are not. It sits on
`/providers` rather than on `/`. It was an aside on the landing page for three
of that page's six lives, and it was one of the things that made the third too
long to read: a comparison table is what somebody chooses a provider with, which
is a thing they do after being convinced rather than while. So the table asks
three questions of the four provider groups and prints `unknown` as an answer
with the document's own reason beside it, never as a blank or a dash — a table
that flattened the difference would be the lie the section exists to refuse.

**Nothing in it is written down.** `src/provider-asymmetry.mjs` derives every
host, source form, option key and reason from `docs/provider-setup.md` at build
time, through the slicing `src/provider-pages.mjs` already does for the provider
pages. One source, two renderings, and the same discipline recorded above for
those pages holds here twice over: a `## ` section that module can place in
neither category fails the build, and this module inherits that throw exactly,
plus one of its own — a provider whose material answers one of the three
questions in none of the shapes the module reads stops the build with a message
naming which file to edit. The alternative is a cell that quietly reads empty,
which would be the page claiming a provider says nothing about its hosts. What
the module does write down is the three _questions_, for the reason
`provider-pages.mjs` writes down its shared sections: a question the page asks is
a decision somebody made. No answer is written down anywhere.

**Its three colours are correctly spent.** `--color-available`, `--color-unknown`
and `--color-unavailable` carry domain meaning on this site and are never spent
on decoration; this section is literally about those three states. Every one of
them is drawn as its own word in the mono face, never as a bare dot, so removing
the colour leaves the table readable.

**It survives 320px by scrolling inside its own container.** Four columns of
machine output cannot be made narrow enough for that viewport, and a URL form
broken over four lines is not more readable than one a reader scrolls to. So the
table keeps a real minimum width and the container scrolls, which is a scroll the
reader chose rather than the page going sideways underneath them; the container
is a named `role="region"` with `tabindex="0"`, so the scroll is reachable from
the keyboard as well as from a trackpad, and the question column is sticky
against `--color-field`, so the thing being compared stays on screen while the
comparison moves past it. Sticky needs an opaque ground, and the field is the
ground because this section sits on the field rather than on a panel.

## The bench's player, and the site's islands

`/` mounts a real player. Two routes ship a renderer, and `/` mounts exactly one
island: `BenchIsland`, `client:only`. `/archetypes` mounts the two archetype
compositions beside the source of each, also `client:only`, and their two source
wells `client:visible`. Every
other page is HTML, CSS, the inline theme and rail scripts, and the search
module. A prose section that shipped a framework would be the defect; a landing
page for a video-player library that showed no player would be a different one.

**One live player on `/`, and no more.** Everything else on that page is a
control, a line of text or printed code. A landing page for a player library
that ran six players would be arguing that it can run six players. This
paragraph said three for one version of the page, while two archetypes ran below
the hero, and the count coming back down to one is what the rebuild was for
rather than a side effect of it.

The routes are the same decision applied twice, not a drift: a page whose
argument is what a player does has to run one, and no page here mounts a
framework for anything else. Both use `client:only`, and the reason is the same
on both: no button exists in the document before the script that works it
arrives, which is the resting-state rule applied to an island, and nothing is
rendered on the server that a browser holding a media element then has to be
made to agree with. A hydration mismatch on the site's root document is a
console error, and console errors on that document are one of the things
`scripts/check-deploy-artifact.mjs` fails the deployed artifact on.

**`/` used to portal a panel downward, and it now portals the player upward.**
The old hero mounted its island at the top of the page and portaled its
capability readout into a section further down, so that one player and one
report could be rendered once and read where each belonged. The bench inverts
it. `BenchIsland` is placed under the frame, and `StagePortal` renders the
player into `#bench-stage` inside the frame `Bench.astro` draws above it. The
reason is that the frame carries `--elevation-instrument` and the sweep along
its bottom edge, and an Astro component cannot be a child of a React one, so the
player has to travel to reach it. `createPortal` keeps the stage inside this
component's React tree, and therefore inside `Player.Root`'s context, while
rendering its DOM somewhere else. That is what lets the player leave without the
quiet line under it losing the controller it reports on: there is one root above
everything, so the line is reading the same controller the picture is driven by
rather than a second one of its own, which is what makes it a report rather than
a caption.

**The `client:only` directive has one cost and it is stated rather than
discovered.** The line under the frame and the whole readout are absent until
the island mounts, and nothing reserves their height. With no JavaScript the
frame holds a `<noscript>` fallback instead: the same still as a real `<img>`,
wrapped in a link to wherever the switch's default position plays. It is a
link rather than a running player because there is no same-origin file left to
hand a plain `<video>`, and a hosted provider's own player is an iframe embed
that is itself a script — nothing here for a browser with scripting off to
attach to on its own. No quiet line is printed there either, for the same
reason it never was: the fallback is not the same player and the sentence
would be describing one that is not running.

**The clip is no longer this app's own copy.** It was, for one page of this
document's life: `public/bunny.mp4`, a twenty-second excerpt of _Big Buck
Bunny_ cut from `big_buck_bunny_720p_h264.mov`, and `public/hls/` carried the
same seconds as a two-variant ladder. Both are gone, along with the file they
were cut from, because the maintainer cannot serve video from this site. What
plays now is Blender Studio's own upload of _Sprite Fright_ (2021) — the whole
film, not a twenty-second cut — on whichever host the switch is set to:
`https://www.youtube.com/watch?v=_cMxraX_5RE` or `https://vimeo.com/640499893`,
both verified by channel through each provider's `oembed` endpoint rather than
re-uploaded, and both recorded with that verification in `bench-sources.ts`.
`Player.Root` takes `startTime={0}` on every position, so a reader presses into
the film's own beginning, the way every hosted embed on the web does. An
earlier version pinned this to `60`, the same second `bunny-poster.webp` was
cut from, so the still and the first played frame were the same instant — worth
doing when this repository cut its own poster from its own clip, and not worth
asking of a film whose poster comes from elsewhere: promising a reader the exact
second a still was cut from is a smaller claim than it looks, and a film that
appeared to begin a minute in for no reason a reader could see was a stranger
one to make than simply starting at the beginning, the way a reader already
expects a hosted embed to.

**Both providers play the same film today, and that is a fact about what turned
up rather than a rule.** Every hosted position needs Blender's own upload of
something this project is entitled to embed on a marketing page, and the search
for one happened twice, once for each provider, independently — it did not stop
at the first film that satisfied both. It so happens that _Sprite Fright_ is the
one film verified as an official upload on both YouTube's Blender Studio channel
and Vimeo's `vimeo.com/blenderstudio` account, so both positions point at it.
That is not guaranteed to stay true: nothing here assumes a future film would
land the same way, or that the two positions must keep agreeing. `bench-sources.ts`
bundles the URL, poster, intrinsic dimensions, start time and credit into one
object per provider for exactly that reason — so that the day a second film is
added to only one position, every fact about it moves together, and a lookup
keyed by provider that quietly forgot the poster or the credit is a compile
error rather than a defect on the page. See that file's own module comment for
the failure this bundling replaced: an earlier version of `Bench.astro` set the
source alone and left the poster pointed at the previous film, the same class of
defect the `media` prop on `/archetypes` (below) was built against, one file
over.

**The poster is two files, not one, and neither is `public/bunny-poster.webp`.**
That file is deleted along with every other trace of _Big Buck Bunny_ on this
page. In its place, `public/sprite-fright-poster-1024w.webp` (42,564 bytes) and
`public/sprite-fright-poster-2048w.webp` (95,386 bytes), both a frame sixty
seconds into _Sprite Fright_ — a character mid-scene in the forest, not a title
card, a fade or one of the film's darker night shots — cut from Wikimedia
Commons' mirror of the same official Blender Studio release
(`commons.wikimedia.org/wiki/File:Sprite_Fright_-_Open_Movie_by_Blender_Studio.webm`,
explicitly CC BY 4.0 on its own file page, which is the provenance a credit
needs to be checkable). Fetched by an `ffmpeg` range request — `-ss` before
`-i`, so only the bytes around the one frame needed were pulled rather than any
part of the 163 MB source — from the master encode at the film's own native
2048x858, not from a lower-resolution transcode: two frames extracted from a
downscaled derivative were measured to disagree on the exact crop by a fraction
of a percent, which is a rounding error at most sizes and a visible sliver of
misalignment at this one's. Both files are exact integer divisions of that
2048x858 — the full size and its exact half, 1024x429 — so neither is a
scaler's rounding of the ratio the way a poster forced to an unrelated 16:9 was.
`bench-sources.ts` records the same provenance beside the code that resolves
both addresses, and the two ship together as an `<img>`'s `src`/`srcSet` pair —
1024w for a narrow viewport, 2048w, the film's native width, for the frame this
poster actually fills on a wide or a high-density display — in both
`BenchIsland.tsx`'s `Player.PosterImage` and `Bench.astro`'s `<noscript>`
fallback `<img>`, `sizes="100vw"` on both, on the reasoning that the frame is
never wider than the viewport so that value never under-selects. Both stay
same-origin on purpose: this is the one image a reader sees before any press,
and a page whose central claim is that no provider has been contacted until then
cannot fetch a thumbnail from one to make that claim. The bench is the largest
element on the page and sits above the fold, and a blank rectangle is a worse
first impression than a still of the thing the control beside it is labelled to
play, so the trade was taken deliberately.

**The frame around the picture takes its shape from the same bundle, rather
than from a 16:9 literal.** `.bench__stage` in `Bench.astro` used to read
`aspect-ratio: 16 / 9` unconditionally — the library's own generic fallback,
and also _Big Buck Bunny_'s own ratio, which is what let it go unnoticed for as
long as it did. _Sprite Fright_ is 2.39:1, and a 2.39:1 film forced into a 16:9
box is letterboxed: the frame around a video of one shape drawn for another,
the same defect class as a poster from one film over a video of another, just
measured in bars down the sides rather than in a wrong title. `bench-sources.ts`
carries the film's real pixel dimensions as two integers, `width` and `height`,
rather than a rounded decimal — `2048 / 858` is what CSS computes from them
exactly, where `2.39` is off by about a thousandth, which at this frame's
rendered width is a visible sliver of the same letterboxing being fixed.
`Bench.astro` writes `--bench-aspect-ratio` from those two integers as an
inline style on `#bench-stage` for the position the page rests on, so the box is
right before any script runs; `StagePortal` in `BenchIsland.tsx` updates the
same custom property whenever a reader presses a different position. The
viewport a level down reads `var(--playdeck-media-aspect-ratio, var(--bench-aspect-ratio, 2048 / 858))`
rather than falling back to `16 / 9` directly — the library's own property
still wins where a provider actually measures its media (Vimeo does; YouTube
never publishes real dimensions at all, so for that provider the fallback is
the only source of truth there is), and the fallback under it is this film's
own shape rather than a generic one, so no frame of any state, scripted or not,
disagrees with the picture inside it.

**The whole picture is the target, in both directions, under every skin.**
`Player.ActivationButton` ships full-bleed with no stylesheet at all — the
`none` skin's own behaviour — but the bundled `theme` stylesheet sizes it into
a roughly 4rem badge, so under `theme` only the badge was pressable and a click
elsewhere on the picture did nothing (issue #552, filed against the library
rather than fixed there). `Bench.astro` redraws the badge as a `::before`
background rather than as the button's own box — the same technique
`HeroPlayer.astro` used for the equivalent part before this page was rebuilt as
a bench — so the element itself goes full-bleed and transparent under `theme`
too, scoped to `[data-bench-skin='theme']` so `none` is untouched. The reverse
direction — pressing the picture to pause a clip that is already playing — has
no equivalent library default to fall back on, so `BenchIsland.tsx` adds
`SurfaceToggle`, a `Player.PlayButton` sized full-bleed with `tabIndex={-1}` and
no visible content of its own, rendered only once activation has produced a
player and therefore never coexisting with the affordance it replaces.
Adapted from the pre-rebuild `HeroPlayerIsland.tsx`'s own `SurfaceToggle`
(`git show 61599a4855:apps/site/src/components/HeroPlayerIsland.tsx`), which
carries the same reasoning: `tabIndex={-1}` keeps the tab order one control
long, because the real, reachable control this toggle stands in for is the
control bar's own play button, which focus lands on directly after a keyboard
activation.

**The attribution is reachable in every state, and lives in two files rather
than one.** CC BY asks for a credit wherever the media plays, including the
no-JavaScript path, and with the same film on both positions the credit no
longer needs to change when the source switch does — but the bundling in
`bench-sources.ts` is what makes that safe rather than what happens to be true
today, and both files still read the credit from that bundle rather than
writing a film's name by hand. `Bench.astro` prints a static `<p class="bench__credit">`,
naming the switch's default position's film, inside a `<noscript>` — not
unwrapped static markup, because with a script running `BenchIsland.tsx`'s own
`Credit` component mounts in the same visual position and the static paragraph
is `display: none`, so the two never appear together and a no-JavaScript reader
still gets one. Both share the class, so `Bench.astro`'s `<style>` reaches it
with `:global()` regardless of which tree rendered it, at `--text-fn` in
`--color-ink-subtle` — the same size and ink `.bench__quiet` gets, because it
qualifies the instrument rather than captioning it, but not the same family: it
is a sentence rather than a value, an identifier, a state or machine output, and
the type rule above gives sentences to Sans regardless of size. It is not a
footer: a footer would put the credit somewhere a reader has to leave the
argument to find, and CC BY does not ask for that, only for the credit to be
findable near the work.

`public/archetype-captions.vtt` is the same rule a second time, and is stated
here so the copy does not read as an accident. The archetypes mount in two
surfaces — this site and the workbench — and each build serves only its own
`public/`, so the fixture exists byte-identically in both. What makes that safe
rather than drift is that neither copy is authored: it is a fixture whose text
marks time in a clip, and a change to one that did not reach the other would
show up as a caption that did not match what the other surface played.

**There was a second fixture, `public/tracer-45s.mp4`, and it is gone.** It was
the same colour-bar pattern looped to forty-five seconds, and it existed because
the two archetypes ran on `/` and needed a timeline: they mount with
`resumeAt={18}` and `{14}`, their chapter fixture marks 18s and 38s, the lesson's
outline runs to 28s and the caption cues to 22s, none of which a one-second clip
can carry. The length was chosen against the last mark rather than around it,
because the streaming rail drops any chapter at or past the duration and a clip
ending before 38s would silently draw one tick where the fixture asks for two.
All of that reasoning is about a page that no longer mounts them. The fixture
left with the archetypes, and `/archetypes` plays the Blender trailers the
examples ship. The reasoning is kept because the constraint is not: a chapter
mark at or past the duration is dropped silently by the streaming rail, so any
future surface that overrides the media on either archetype inherits that
arithmetic, and this paragraph is where it is written down.

**And the honesty rule all of this served.** The examples' default source is a
Blender open-movie trailer on that foundation's own host, and it stays pointed
there, because the default in a file somebody pastes into their own project
should be a clip that plays rather than a path into this repository's `public/`.
`/` overrode it while it mounted them, because it is the page carrying #542's
no-third-party-request criterion, and that criterion covers every request the
page can cause, including the ones a press causes. It mounts them no longer, so
nothing on this site overrides the media any more: `/archetypes` passes only a
captions URL and a resume position, keeps the trailers, and carries the CC BY
attribution beside them, which is where that line belongs now that it describes
what is actually on screen.

**Nothing about the player contacts a third party before a press, and that is
the point.** `loading="interaction"` holds the root dormant until the play
affordance is pressed: no fetch, no provider attached, whichever position the
source switch is on — and every position is a hosted provider now, so this
claim is entirely about the order of events rather than about the absence of a
third party altogether. The switch points the player at somebody else's host
only because a reader asked. `e2e/site-quiet.spec.ts` gates both halves: it
records every request `/` makes at rest and fails if one leaves this origin,
then presses a hosted provider and fails if none does, so an empty list is
evidence rather than a listener attached to the wrong page. That second test
used to skip itself while every hosted provider was `ready: false`; the skip
was computed rather than written down, and it lifted itself the day `youtube`
and `vimeo` were turned on, exactly as designed.

**The player's theme is no longer imported, and that is the skin switch.**
`@playdeck/react/theme.css` was a plain import while `/` had a hero, which meant
every reader paid for it and no reader could be shown the library without it.
The bench has to be able to apply it and take it away, so `BenchIsland.tsx`
imports it as `?url` and appends or removes a `<link>`. Vite emits the
stylesheet as its own hashed asset and the import is the address of it, so no
byte of it is in the page's own CSS or JavaScript, and `none` really is no CSS
rather than a position that claims to be. A dynamic `import()` was the obvious
alternative and is the wrong one: Vite turns a dynamically imported stylesheet
into a chunk that injects a `<style>` element on evaluation and hands back no
handle to remove it, so pressing `theme` once would make `none` unreachable for
the rest of the page's life.

**The two systems still cannot bleed into each other, and that is a property of
that file rather than of this page's care.** Every selector in it sits inside
`@layer playdeck` and is wrapped in `:where()`, so it matches only elements
carrying a `data-playdeck-part` attribute and loses to any unlayered rule here
whatever the specificities are. In the other direction it declares no token of
its own: every value is read as `var(--playdeck-…, fallback)`, so the mapping
block in `Bench.astro` is the whole of what this site says to it. That block is
stated once and left alone rather than toggled with the switch, because nothing
reads a custom property no stylesheet is asking for.

Two of the mapped choices are not free:

- **The control bar is `--stage-surface`, not the theme's scrim.** That default
  is a gradient, and this system has exactly one gradient. A flat surface is the
  depth treatment the rest of the frame is built from.
- **Layer geometry is the page's, in both skin positions.** The library's
  stylesheet states appearance and leaves position out, so that a player works
  with no stylesheet at all and so that a consumer can put the controls
  somewhere other than over the picture. Where the layers sit is the consumer's
  decision in every composition the library ships to, and on this page the
  consumer is `Bench.astro`. That is not the page bending the rule that `none`
  applies no CSS: it is the line the library itself draws.

**`Bench.astro` writes one rule that changes how a part looks, and it is a
browser defect rather than a skin.** Everything else it says to the player is
layout, a `[hidden]` reset, or the mono tracking this site applies wherever Plex
Mono appears. Under `none` the activation affordance keeps the
full-bleed box the library ships it with, which is what makes a press anywhere
on the picture start the clip, and it also keeps the user agent's own button
paint: measured on this frame, an opaque `rgb(239, 239, 239)` fill and a
`2px outset` black border at `z-index: 30`, over a poster at 10. The still was
loaded, decoded and marked visible by the library's poster state machine, and
painted over regardless. An element whose whole job is to overlay a picture and
which occludes it instead is not styled, it is broken, so the rule sets
`background-color: transparent` and `border: 0` and nothing else. No size, no
radius, no badge, no hover: those are chrome and they stay the theme's, which is
what keeps the two positions a contrast about chrome rather than about whether
there is a picture at all.

**That rule is scoped to `[data-bench-skin='none']`, and it was written unscoped
first.** Unscoped, it falsified the paragraph above. It is unlayered CSS while
`theme.css` lives entirely inside `@layer playdeck`, and an unlayered
declaration beats a layered one for the same property whatever the specificities
are, so the reset reached the themed player too: the part computed
`rgba(0, 0, 0, 0)` under both skins and the theme's own fill never landed.
Pressing `theme` gave a bare glyph with no badge. `data-bench-skin` rides on the
viewport, which is React's element, so the attribute arrives in the same commit
as the state it reports; writing it onto the Astro element would mean a
`setAttribute` in an effect and a frame in which the document and the switch
disagree.

**The keyboard is put into the bar when the player appears, and only the
keyboard.** The activation button unmounts while it holds focus, and a browser
drops focus to `<body>` when the focused element leaves the document — so a
reader who pressed Enter would be left with nothing focused and no media
shortcut, `shortcuts` being scoped to `Player.Controls` rather than global. The
library restores focus for controls that unmount from inside that region, and
this button is outside it. `BenchIsland.tsx` moves focus to the bar's play
button, which is the command that was just given. It does so only when the
activation button matched `:focus-visible` at the moment it was pressed — the
browser's own record of whether a ring was on screen — because a ring appearing
after a mouse click or a touch tap is its own defect.

**The bar is hidden rather than unmounted before a player exists**, with the
`hidden` attribute, which takes it out of layout, out of the accessibility tree
and out of the tab order at once without discarding a subtree that is about to
come back. `Bench.astro` carries a `[hidden]` reset for it, which is needed
rather than assumed: the attribute is honoured by a rule in the user agent
stylesheet, and the theme gives that part a `display` of its own, which any
author rule beats.

**A control the provider cannot honour is absent rather than disabled**, and
that is the library's doing rather than this page's. `Player.FullscreenButton`
renders only while the fullscreen capability reads `available`. `/`'s
capability argument used to be demonstrated a second way, by the reason line
under the switches printing the same kind of fact in words; that line is
deleted (see the animation section above), so this absent-rather-than-disabled
behaviour is what is left of the argument on this page, running rather than
described.

**A second play button laid over the picture, so a click anywhere on a running
clip toggles playback the way a desktop player's does.** This paragraph used to
record that the bench did not have one — a reduction from the pre-rebuild hero,
kept for a session that wanted it back to read as a record rather than a
ruling. That session came: full-bleed pressing was only half solved by
`Player.ActivationButton`'s own default (the `none` skin) plus `Bench.astro`'s
badge redraw (the `theme` skin, working around library issue #552, where the
bundled stylesheet sizes the button into a roughly 4rem badge and leaves the
rest of the picture unpressable), because neither touches the reverse
direction — pausing a clip that is already playing by pressing anywhere on it.
`SurfaceToggle` in `BenchIsland.tsx` is that second control, adapted from the
pre-rebuild `HeroPlayerIsland.tsx`'s own component of the same name
(`git show 61599a4855:apps/site/src/components/HeroPlayerIsland.tsx`): a
`Player.PlayButton`, sized full-bleed by the rules in `Bench.astro`'s
`<style>`, `tabIndex={-1}` so it is a pointer target rather than a second tab
stop, empty children so it paints nothing of its own. It mounts only once
activation has produced a player — the same gate `ControlBar` puts on the
control bar, and for the same reason — so it and `Player.ActivationButton`
never coexist: there is never a frame with both mounted and never a frame with
neither. The tab order stays one control long because the real, reachable
control this toggle stands in for is the bar's own play button, which is where
a keyboard activation already moves focus.

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
tables above. These are the pairs the player adds, and they are the pairs the
`theme` skin paints: under `none` the seek control is the user agent's own range
input and none of this is drawn.

**One column and not two, because the stage is theme-independent.** Every value
below is mapped from a `--stage-*` role, and those never move with `data-theme`,
so the player casts the same figures in a light page as in a dark one. This
table carried a Light and a Dark column for as long as the stage roles have
existed, and the Light column was arithmetic on tokens the player has never
read. Text on the bar is `--stage-ink` on `--stage-surface`, which is the dark
`--color-ink` on `--color-surface` row the table above already carries at 16.27.

| Pair                           | Both themes | Needs |
| ------------------------------ | ----------- | ----- |
| Loaded range on the track      | 3.62        | 3     |
| Thumb ring on the track        | 16.92       | 3     |
| Thumb ring on the loaded range | 4.68        | 3     |
| Progress fill on the track     | 8.66        | 3     |
| Focus ring on the bar          | 8.33        | 3     |

**The thumb carries a ring because its fill cannot carry the boundary.** The
accent measures 2.39 against the loaded range on this ground, and no accent
value clears 3:1 against both that and the track — which is the library's own
finding, and why its theme draws a ring at all. The ring is what the table above
holds to 3:1, and the fill is decoration on top of it.

**The track is `--stage-sunken`.** That is the recessed-well role on the stage's
own ladder, which names a switch track outright, and it is also what the first
row of the table needs: on the line role the loaded range measures 2.82, below
what non-text UI owes.

This system is separate from `@playdeck/react/theme.css`, which is the player's
theme and ships to consumers. That file is layered and zero-specificity because a
stranger's stylesheet has to be able to win against it; nothing here ships
anywhere, so nothing here needs that. The two share no tokens and are not meant
to match — `Bench.astro` maps one onto the other at a single seam, and that
mapping is the whole of the contact between them.
