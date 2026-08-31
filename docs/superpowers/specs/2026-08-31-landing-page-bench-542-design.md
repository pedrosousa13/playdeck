# The landing page as a bench (#542)

## What this replaces, and why

`/` has been rebuilt five times and rejected five times. The last version was six
sections down one column, each one a claim in a heading followed by the code that
backs it. Nothing was wrong with it that a reader could point at. It was correct,
honest, and dead.

The reason it read that way is that every section had the same shape. Label,
heading, two lines of prose, grey code well, six times over. Nothing on the page
was larger than anything else, and the only element that was actually alive, the
player, appeared once in the hero and never came back. A library whose whole
argument is about behaviour was arguing in paragraphs.

The maintainer asked for the page to start from nothing, for the video to be the
star, and for enough marketing to convince a React engineer to try it. This
document is what we settled on.

**Nothing from the current page carries over.** Not a section, not a heading, not
a sentence.

## The shape

One page, roughly two screens, in five parts.

| Part        | What it is                                                    |
| ----------- | ------------------------------------------------------------- |
| Thesis      | The h1, one display line, one paragraph                        |
| The star    | The player, the largest thing on the page                      |
| The bench   | Three groups of switches that belong to the reader             |
| The readout | The capability grid, and the composition the switches built    |
| The close   | Four measured figures, the install line, the ways onward       |

There is no section per feature. The four features from the brief (capability
querying, autoplay recovery, composability, customisability) are each delivered
by operating the bench rather than by reading about them. That is the whole idea:
the page is one instrument with knobs, where the old page was six things with
none.

## The thesis

The h1 is `Playdeck`, because `scripts/check-deploy-artifact.mjs` finds this
site's root document by a heading with exactly that text and
`e2e/site-nav.spec.ts` pins it as the only one. It sets small, at `--text-lg`, in
`--color-ink-muted`. It names the document. It is not the argument.

The display line, a `<p>` at `--text-4xl`:

> A video player you compose, not one you configure.

Then one paragraph at `--text-lg`:

> React primitives and hooks over native video, HLS, YouTube, Vimeo and Wistia.
> You write the markup, you write the CSS, and the same six lines drive all five.

The count in that last sentence has to match the snippet the readout prints at
rest. If the snippet changes length, the sentence changes with it, or it comes
out.

Two claims that were considered as the thesis survive lower down, where the page
demonstrates each instead of asserting it. "Ask the player what it can do, and it
answers" becomes the caption under the grid. "Every element of the player is
yours" becomes the label on the `none` skin.

**The page makes no claim about any other library.** No comparison, no named
competitor, no implied one. An earlier draft opened with "every video player
ships a design", which is false: react-player ships no stylesheet and says so in
its README. The maintainer ruled the whole category out, and the ruling is
recorded here so a later session does not reintroduce it as a copy tweak.

## The star

The player, at the page's full width, 16:9, directly under the thesis. It is the
largest element on the page by a wide margin, and it is the first thing a reader
looks at.

It stays `loading="interaction"` and dormant until pressed. The island is
`client:only` for the reason `HeroPlayer.astro` already records. At rest the
reader sees a poster and a play control, and one line of functional text under
the frame:

> Nothing above has loaded. No request has left this page.

That line is the product's central claim stated as a fact about the page the
reader is on, rather than as a sentence about the library. `e2e` already has the
machinery to keep it true, and this spec asks for a test that does.

The sweep renders once on this page, in its `accent` form, as the 3px band along
the bottom edge of the frame. It is not a decorative band above the heading any
more. One render, and it now sits on the one element the page is built around.

## The bench

Three groups of switches under the player. Each group is a labelled set of
buttons, one active at a time, and each label sets at `--text-fn`, which is 11px
and the floor.

### Source

`native`, `hls`, `youtube`, `vimeo`, `wistia`. The five members of
`PlayerProvider`. Pressing one re-mounts the player against that provider.

`native` is the default and plays the fixture this site already serves, so the
page's first state contacts nothing. The other four reach a third party, and they
reach it because a reader asked. That is the claim, not a violation of it.

### Skin

`none`, `cinema`, `course`.

`none` is the default and is the honest one. It applies no CSS at all, so the
player renders as unstyled elements. That is what actually ships, and showing it
is a better argument than a paragraph saying no stylesheet is in the bundle.

`cinema` and `course` mount the two compositions in
`examples/archetype-streaming-service.tsx` and
`examples/archetype-course-platform.tsx`. Those two files already exist, they
already carry their own stylesheets, and `DESIGN.md` already exempts them from
rules 1 and 5 by an ownership argument. Reusing them here costs nothing new and
keeps the exemption exactly where it was.

Both archetypes came off `/` in `b348879` for being too much on the page at once.
This does not put them back. One composition is mounted at a time, as a state of
the single player, not as two additional running products beside it.

### Autoplay

`off` and `audible-then-muted`, the two `AutoplayMode` values worth showing.

With `audible-then-muted` selected, the browser refuses the audible attempt, the
muted retry is what plays, and `state.autoplayRecovered` goes true. A real
`UnmuteNudge` appears over the picture. It is a primitive doing its job, and it
appears only when the viewer actually lost sound.

## The readout

Two panels under the bench, side by side above `48rem` and stacked below it.

### The capability grid

Ten rows, one per key of `PlayerCapabilities`, by five columns, one per provider.
Every cell starts grey and every cell means `unknown`, because nothing has been
asked of any provider yet. Under the grid, one line of functional text:

> every answer, unknown
> `└ nothing has been asked of a provider`

A column gains colour only once that provider has actually been mounted and has
actually answered. So the grid fills in as a reader explores, and a reader who
touches nothing sees a page that admits it knows nothing. The colours are
`--color-available`, `--color-unknown` and `--color-unavailable`, which is what
those three tokens exist for, and each cell carries its word as well as its
colour, because colour alone is not a status.

Selecting a cell prints its reason in the line under the grid, in the terms
`Availability` already publishes: `browser`, `provider`, `provider-plan`,
`provider-build`, `source`, `policy` for unavailable, `not-ready` and
`provider-check` for unknown.

**The grid reports only what a live provider answered.** It never reads
`src/provider-asymmetry.mjs` and never fills a cell from a document. A static
table beside a live one would be a second copy no gate watches, and the page's
argument is that these answers are observed.

The word "ledger" does not appear. The maintainer rejected that phrase outright.

### The composition

The other panel prints the code the three switches just built, highlighted by
Shiki, in a `--color-sunken` well. It is not a fixed snippet. Flip `source` to
`youtube` and the `source` prop changes. Flip `skin` to `cinema` and a
`className` appears with `Player.Controls` under it. Flip autoplay and the
`autoplay` prop arrives.

This is the composability and customisability argument in one object: the knobs
are compositions, not options, and the panel proves it by rewriting itself.

## The close

Four figures, then the install line, then the links out.

| Figure     | Line                                                        | Source                                       |
| ---------- | ----------------------------------------------------------- | -------------------------------------------- |
| `17 kB`    | Every primitive, gzipped. CI fails the build at 18.          | `scripts/bundle-budgets.mjs`, measured at build |
| `1 of 5`   | Providers are separate packages. You ship the one you use.   | `packages/provider-*`                          |
| `0`        | Requests to a provider before someone presses play.          | The e2e test below                             |
| `0 lines`  | CSS in the bundle. The theme is an import you can skip.      | `@playdeck/react/theme.css` is a separate entry |

The first is read at build time from the same script CI fails the build with, as
the current page already does for its two figures. It is never typed by hand.

Then `pnpm add @playdeck/react`, with the copy button and the `role="status"`
line the current page already has, `React 19 peer, ESM only, named exports`, and
links to Reference, Providers and Archetypes.

The page ends there.

## What gets deleted

- All six `data-section` blocks in `src/pages/index.astro` and every string in them.
- `ProviderTruth.astro`, if the grid replaces what it did. Confirm before removing.
- The three-column `.truth-card` comparison and the entry motion that reaches it.
- The four hand-written snippets, replaced by the composition panel's generated one.

`HeroPlayer.astro` and `HeroPlayerIsland.tsx` are rewritten rather than deleted.
They carry the `client:only` reasoning and the player theme, and both survive.

## Amendments to DESIGN.md

Each of these is a deliberate edit with its reasoning, which is what that
document asks for. **They need approval before implementation starts.** If any is
rejected, the fallback is named.

### 1. The display rung moves off the h1

`DESIGN.md` says `--text-4xl` is "the display rung above `h1`, for a page whose
title is a thesis rather than a document's name". On this page the h1 is
`Playdeck`, which a build gate requires, and `Playdeck` is a name. The thesis is
the sentence under it.

So the rung follows the argument rather than the element. The h1 sets at
`--text-lg` and the display line, a paragraph, takes `--text-4xl` above `48rem`
and `--text-3xl` below it.

_Fallback if rejected:_ h1 keeps `--text-4xl` and the thesis sets at
`--text-2xl` under it. This costs the page its largest type on a word that
argues nothing, and I think it is the worse page, but it needs no amendment.

### 2. The site may contact a third party after a reader asks

`DESIGN.md` currently says "The served page makes no third-party request of any
kind." That was written about fonts and it is true today. The `source` switch
makes it false the moment a reader presses `youtube`.

The precise claim, and the one worth defending, is that the page contacts nobody
**before** a reader asks. Amend the sentence to say that, and keep the fonts
paragraph's own guarantee unchanged, since fonts are never asked for.

_Fallback if rejected:_ the `source` switch offers `native` and `hls` only, both
served from this origin. The page loses the strongest half of the grid, because
the four capabilities that differ most across providers are the ones only YouTube,
Vimeo and Wistia can demonstrate.

### 3. `--elevation-instrument` moves to the player

The allowlist in `DESIGN.md` gives the instrument elevation to "the capability
ledger on `/` and to nothing else". That ledger is gone. The one panel this page
is built around is the player, so the token moves to it, and the readout panels
take a step on the surface ladder and a hairline like everything else.

This is an edit to a named allowlist, which is how that document says the list is
meant to change.

### 4. The animation count is restated

`DESIGN.md` says this app writes three animations and names them. Two of the
three (the `.truth-card` entry motion, the ledger resolution) belong to elements
this page deletes. The count becomes two:

1. The sweep band arriving under the player, unchanged in kind, moved in place.
2. A grid column resolving when a provider answers. This reuses the vocabulary
   the ledger resolution already established: `opacity` and a `--space-1` rise,
   in sequence, keyed off a `data-live` attribute the island writes in the same
   React commit that writes the answers. `transform` and `opacity` only, so rule
   5 is untouched and **no amendment to rule 5 is needed.**

Colour changes in the grid snap, as every colour change on this site does.

### 5. Scroll-linked effects stay banned

No amendment. The bench is driven by pointer and keyboard, never by scroll
offset. Recording this so a later reader does not assume an interactive page
reopened the question.

## Verification

- **The at-rest claim.** A Playwright spec that loads `/`, records every request,
  and fails if any leaves this origin before an interaction. This is the same
  shape as `e2e/site-search.spec.ts`, which already does exactly this for search.
  Then it presses `youtube` and asserts a request to that provider does happen,
  so an empty list is evidence rather than a listener attached to the wrong page.
- **The grid starts unknown.** Assert all fifty cells read `unknown` on load.
- **A column resolves.** Press a provider, wait for `data-live`, assert that
  column carries at least one `available` and that no other column changed.
- **The composition panel tracks the knobs.** Flip each switch and assert the
  printed code contains the prop it should.
- **The four `DESIGN.md` audit constraints.** All four pass on `/` today and must
  still pass: no functional text under 11px, no border under a wide blur, no
  tracked-caps eyebrow above the h1, and `transform` and `opacity` only. The knob
  group labels are tracked caps and sit below the h1 on controls, so they are not
  eyebrows, but they set at `--text-fn` and not below.
- **Full suite, chromium and firefox.** `webkit` cannot launch on this machine
  and CI has it.

## Open questions

1. **Which media each provider points at.** `examples/` uses `dQw4w9WgXcQ` for
   YouTube, which is a joke ID and not ours to embed on a marketing page. Vimeo
   `76979871` and Wistia `oifkgmxnkb` are both public demo assets. Each of the
   three needs a clip we are entitled to embed, and whatever CC BY attribution
   the licence asks for has to appear where the media plays.
2. **Ten rows or fewer.** Ten by five is fifty cells and a striking figure, but
   it may be too much under a video. Four rows (`selectQuality`,
   `pictureInPicture`, `selectTextTrack`, `setPlaybackRate`) are the ones that
   differ most across providers. Decide against the built page, not on paper.
3. **Whether `ProviderTruth.astro` survives.** The grid may make it redundant on
   `/`, but it may still earn its place on `/providers`.
4. **Mobile.** Three switch groups, a 16:9 video and a fifty-cell grid at 320px
   needs a layout of its own. The grid probably becomes one column, the mounted
   provider's.
