# The bench with two themes, and a close that says four things

## What this amends

`2026-08-31-landing-page-bench-542-design.md` built `/` as one instrument: a
thesis, the bench, a readout, a close. Its skin switch offered `none` and
`theme`, because the library published one stylesheet and the honest
demonstration was to add and remove it. That stopped being the honest
demonstration the day a second stylesheet existed to switch to instead of
nothing.

This document depends on `2026-09-02-player-themes-design.md`, which designs
that second stylesheet, `@playdeck/react/docked.css`, and revises
`theme.css` alongside it. Nothing here is buildable until that spec ships:
the skin switch below needs a real `docked.css` import to swap to, and the
badge and browser-default workarounds this document deletes from
`Bench.astro` go because the companion spec fixes their causes upstream,
not because this document fixes them itself.

One ruling of the 2026-08-31 spec is amended, at the maintainer's explicit
request on 2026-09-02: that spec's table ruled "What carries the
capability argument: nothing", and the maintainer since asked for the page
to say, in prose, what the library does about capabilities, autoplay
recovery, composability and weight. The close's four cells are that
answer. A one-sentence claim in a cell differs in kind from the table,
grid and reason line the 2026-08-31 spec cut, because it asserts a
behaviour rather than enumerating providers, so it is not the capability
table that ruling excluded. Every other 2026-08-31 ruling stays as written.
The archetypes stay off `/`. There is still no capability table, grid,
list or one-line report. The word "ledger" still appears nowhere. The
stage still keeps the film's own aspect ratio, and nothing here touches
that rule. Nothing ships until the maintainer has seen the page running.

## 1. The skin switch

Positions are `theme` and `docked`, in that order. `theme` is first in the
fieldset because it is the resting position on a wide viewport, the same
order the current `none`/`theme` pair uses today. `SkinName` becomes
`'theme' | 'docked'` in `bench-composition.ts`; `'none'` is gone.

**`theme` rests above 48rem, `docked` rests below it.** The companion
spec's floating theme already moves the bar off the overlay position and
under the picture below 48rem, so a reader on a narrow viewport who
presses `docked` on purpose sees close to the same layout `theme` was
already falling back to. Below that width the two positions differ by one
control, `VolumeSlider`: the floating theme hides it there outright,
reusing the same `display: none` rule a coarse pointer already gets, while
the docked theme only hides it on a coarse pointer, the same rule either
theme has always used above 48rem. On a fine pointer, a narrow window with
a mouse rather than a phone, the two positions are not identical below
48rem; `docked` still shows `VolumeSlider` there, `theme` does not. On a
coarse pointer, what a narrow viewport almost always is, both hide it and
the two positions are identical, so **the skin fieldset is hidden below
48rem** rather than offered with no visible effect: a switch whose only
visible effect below that width is one slider on a narrow fine-pointer
window is still a choice with no argument behind it. The source switch is
untouched. `Group` (`BenchSwitches.tsx`) takes no `className` prop
today, so this is not a prop the caller passes in; `Group`'s own
`<fieldset>` gains a conditional class instead, `group === 'skin' ? 'hidden
md:block' : undefined`, read off the `group` prop `Group` already
destructures. A `className` prop was the other option and was rejected:
`Group` has one caller that would ever need this, `BenchSwitches.tsx`'s own
`skin` fieldset, so a prop threaded through for a single call site buys
configurability nothing here uses. Tailwind's default `md` is 48rem in this
project, the same breakpoint `BenchIsland.tsx` already spends on the
readout's own `md:grid-cols-2` split.

> **2026-09-04: reversed.** The maintainer put the control bar's idle fade
> in place after this ruling — it fades while playing and returns on a tap
> or a keystroke — which made the floating `theme` bar a sound phone layout
> without leaving the picture, and removed the "close to the same layout"
> argument this paragraph makes for defaulting to `docked` below 48rem.
> `theme` rests at every width now, and the skin fieldset is visible at
> every width instead of `hidden md:block` — the switch's only visible
> effect below 48rem is no longer confined to one slider on a fine pointer,
> because the two skins now differ in the fade behaviour itself, not only
> in `VolumeSlider`. See `apps/site/DESIGN.md`'s matching note and
> `theme.css`'s own "below 48rem" comment.

**Loading stays a real `<link>` swap, one sheet at a time.** The existing
effect in `BenchIsland.tsx`, appending a `<link>` at `themeHref` on mount
and removing it on cleanup, extends to two hrefs rather than one
conditional: `themeHref` from `@playdeck/react/theme.css?url` as today,
plus `dockedHref` from `@playdeck/react/docked.css?url`, keyed off
`position.skin`, always one `<link>` in the head. With `none` gone there is
no third branch that appends nothing. Every position now has a stylesheet,
and "you pay for one" is the same argument on a different pair: a reader
who has pressed `docked` has never downloaded a byte of `theme.css`, and
the reverse.

**How the default position is chosen without a flash.** Two mechanisms were
available: a CSS media query deciding which `<link>` is present before
hydration, or the island reading `matchMedia` once on mount. The first
assumes a server-rendered document a reader's browser paints before a script
runs, and `Bench.astro`'s own comment on `client:only` says that document
does not exist. The whole readout is absent until the island mounts, so
there is no pre-hydration paint to protect. The real question is whether the
island's first render already carries the right skin or corrects itself a
frame later. `BenchIsland.tsx` already answers that for the source switch:
`readySources[0]` is read synchronously inside the `useState` initializer,
not in an effect, so the skin default takes the same shape:
`window.matchMedia('(min-width: 48rem)').matches` read inside that same
initializer, deciding `theme` or `docked` before the component's first JSX.
`matchMedia` needs no feature check: `client:only` mounts nothing without a
browser that already has it.

**`.bench__stage`'s token-mapping block gains one more line.** That block
(`Bench.astro`) maps every `--playdeck-color-*` the player reads to a
`--stage-*` value, so a value on the stage reaches every part and the
theme reads it through its own `var(--name, default)` regardless of which
skin is loaded. The companion spec's docked theme adds a token the
floating theme never needed, `--playdeck-color-hairline`, the 1px top
border that separates the bar from the picture since docked draws no scrim
to do that job. The stage gains a matching line,
`--playdeck-color-hairline: var(--stage-hairline)`, and `tokens.css` gains
`--stage-hairline`, a dark hairline that never moves with `data-theme`,
the same way every other `--stage-*` token stays dark regardless of the
page's own theme. It is set from the existing `--dark-line` value,
`--stage-hairline: var(--dark-line)`, rather than a new hex the way four of
the six existing `--stage-*` tokens do (`--stage-field` and `--stage-ink`
are literal hexes, `tokens.css:154-155`; the rest reuse a dark-mode
primitive). Inert under `theme`, the same way every stage token already
is until the stylesheet that reads it loads.

## 2. The composition panel prints what is mounted

Today `bench-composition.ts` prints one line, `<Player.Controls />`,
self-closing, while `BenchIsland.tsx`'s `ControlBar` mounts six children
inside it: `PlayButton`, `MuteButton`, `SeekSlider`, the two `Time`s and
`FullscreenButton`. The two have never been required to agree, and after
this change they still could not be if the panel goes on printing a single
collapsed tag. `SeekSlider` sits third in that mounted order today; it
moves to first, ahead of `PlayButton` and `MuteButton`, so that it is first
in document order under the new ten-control tree below.

**The printed tree becomes the real one.** `Root`, `Viewport`, `Media`,
`Poster` (with its `PosterImage`, since the bench always mounts one), then
`Controls` opening onto ten children in a fixed order: `SeekSlider`,
`PlayButton`, `MuteButton`, `VolumeSlider`, `Time` current, `Time`
duration, `CaptionsButton`, the settings menu, `PipButton`,
`FullscreenButton`. That order is the companion spec's own control-bar
contract: row one is `SeekSlider` alone, row two is everything else in
this sequence. `SeekSlider` has to be first in document order for that
split to work at all, since the theme's CSS grid places it by source order
rather than by an element the theme would otherwise have to invent (the
companion spec's own account of why no `controls-row` wrapper exists). The
panel is not inventing an order, it is printing the one the theme's CSS
grid already assumes from source order.

**`BenchIsland.tsx` gains four controls it does not mount today**:
`VolumeSlider`, `CaptionsButton`, a settings menu (`SettingsMenu` plus
`SettingsMenuTrigger` plus `SettingsMenuContent`, the shape
`examples/react-menus.tsx`'s `RateMenu` already uses, the panel only has to
print that a settings control exists, not what is inside it) and
`PipButton`. All four are real exports of `@playdeck/react`
(`packages/react/src/index.tsx`), capability-gated the same way
`FullscreenButton` already is, absent rather than disabled where a provider
cannot honour them, so mounting them costs the page nothing it does not
already accept. `AirPlayButton`, absent from the companion spec's row two
and rendering only where there is somewhere to cast, stays unmounted.

**The settings menu mounts real content, not an empty shell.**
`BenchIsland.tsx` mounts `examples/react-menus.tsx`'s `RateMenu` as
written: `Player.SettingsMenu` wrapping `Player.SettingsMenuTrigger`,
`Player.SettingsMenuContent`, a `Player.MenuRadioGroup` of four
`Player.MenuRadioItem`s (`0.5`, `1`, `1.5`, `2`, driven by
`usePlayerActions().setPlaybackRate` and `usePlayerState`'s
`playbackRate`), and a `Player.MenuItem` that seeks to zero. It is already
exported surface, already a real capability, and costs nothing the page has
not already accepted for its other menu-shaped controls.

**The mechanism that keeps the printed tree and the mounted tree from
disagreeing** is a shared array, following the discipline
`bench-sources.ts` already uses for provider entries: an exhaustive record
beats a runtime test, because it fails at the type checker rather than at
whichever CI run happens to exercise the drifted path. A new module,
`bench-controls.ts`, exports the ten names as a `const` tuple,
`BENCH_CONTROLS`, and the type it derives, `BenchControlName`. `ControlBar`
in `BenchIsland.tsx` and `buildComposition` in `bench-composition.ts` each
keep a `Record<BenchControlName, …>`, one mapping a name to the JSX it
renders, the other to the line of source it prints, and both map over
`BENCH_CONTROLS` rather than writing their own list. That record is total
under TypeScript's missing-key checking the same way `bySource` in
`bench-sources.ts` already is: a name added to `BENCH_CONTROLS` and
forgotten in either record is a compile error, not a page that quietly
mounts nine controls and prints ten. A test that diffed the two after the
fact was the other option, rejected for the same reason
`bench-sources.ts`'s own comment gives for bundling a provider's fields into
one object instead of three lookups: a test catches drift once it has
already shipped, an exhaustive type prevents it from compiling.

**The printed lines are self-closing**, `<Player.VolumeSlider />` and so
on, without the icon-swap children `ControlBar` renders at runtime. The
panel already does this today for `Player.Controls`, and a composition a
reader would paste is the primitive names and their props, not the
conditional icon logic a real consumer writes once.

## 3. The panel is syntax highlighted

**`apps/site` gains its own `shiki` dependency.** `codeToHtml` is not
`apps/site`'s to import today: `shiki` is Astro's own dependency, not this
package's, the same fact `src/shiki.ts`'s own comment on `PaintedToken`
already gives for why that type is hand-written rather than imported
(`ThemedToken` is unreachable for the same reason). `import { codeToHtml }
from 'shiki'` in `Bench.astro`'s frontmatter does not resolve under pnpm's
isolated `node_modules` until `apps/site` names the package itself. The fix
is one step: add `shiki` to `apps/site/package.json`'s `devDependencies`,
pinned inside the range Astro itself depends on, `^4.0.2`
(`astro/package.json`'s own `dependencies.shiki`), so pnpm installs one
shared copy rather than two disagreeing ones. Once that lands,
`ShikiTransformer` becomes an importable type from `shiki` itself, and
`src/shiki.ts`'s hand-written `PaintedToken` may be replaced by it, though
nothing in this document requires that: `repaintForContrast` only reads
`htmlStyle` off a token, so the narrower hand-written type keeps working
either way.

Shiki runs at build, in `Bench.astro`'s frontmatter, using the same
`shikiConfig` from `src/shiki.ts` that `astro.config.ts` hands to
`markdown.shikiConfig` and `start.astro` hands to Astro's `<Code>`. `<Code>`
itself is not usable here: it renders one string once, and this panel needs
four strings computed ahead of time and swapped by a mounted island. So
`Bench.astro` calls Shiki's own `codeToHtml` directly, the function
`<Code>` calls internally, with `lang: 'tsx'` and `...shikiConfig` as that
component would.

**Four outputs, because there are two switches with two positions each.**
`youtube`+`theme`, `youtube`+`docked`, `vimeo`+`theme`, `vimeo`+`docked`.
Each is `buildComposition`'s output for that combination, highlighted once
at build time, so the reader never runs a highlighter. The four strings are
computed in Node, in `Bench.astro`'s frontmatter, and handed to
`BenchIsland` as four string props.

**`codeToHtml` returns a whole `<pre><code>…</code></pre>`, not a
fragment, and `base.css`'s token-colour selectors and well key on the
class `.astro-code`, which `codeToHtml` does not add on its own (its
output carries `class="shiki github-light github-dark"` instead).** One
mechanism resolves both facts: the frontmatter's transformer list gains a
second transformer alongside `repaintForContrast`, implementing Shiki's
`pre` hook (`(this: ShikiTransformerContext, hast: Element) => Element |
void`) to add the class `astro-code` to the `<pre>` Shiki is about to
serialise, and to set `data-bench-composition=""` and `tabindex="0"` on
that same element, the two attributes `CompositionPanel.tsx` sets on its
own `<pre>` today. `CompositionPanel.tsx` stops rendering a `<pre>` of its
own: its whole current `className`
(`m-0 overflow-x-auto rounded-[var(--radius-md)] bg-[var(--color-sunken)]
p-[var(--space-4)] leading-[var(--leading-snug)] text-[var(--color-ink)]
[scrollbar-width:thin]`) and its `<code>{composition}</code>` child are
deleted, and the component becomes one `<div dangerouslySetInnerHTML={{
__html: highlighted }} />`, picking the one prop that matches the current
`(source, skin)` pair and rendering the whole Shiki-authored `<pre>` as
that div's only child. Nesting a `<pre>` this document builds inside
another the panel already rendered, the naive reading of "the panel prints
highlighted HTML", is what this avoids: there is exactly one `<pre>` in
the DOM, and Shiki owns it. Most of the deleted className is redundant
with `.astro-code` once that class lands on the block (the well colour,
the radius, the padding, the leading, the ink and the thin scrollbar), but
two declarations are not: `m-0` and `overflow-x-auto`. `.astro-code`
(`base.css`) sets neither today, because `base.css`'s own comment on the
rule explains Astro emits `overflow-x: auto` (and `tabindex="0"`) on the
block itself, a fact true of every block `<Code>` highlights and not true
of a `<pre>` this transformer builds by hand. `base.css`'s `.astro-code`
rule gains `margin: 0` and `overflow-x: auto` to cover the gap; both are
harmless on every Astro-emitted block, which already carries them from
Astro's own output, and `overflow-x: auto` is what lets the bench's own
`<pre>` scroll a line too wide for its column, the behaviour `m-0` and
`overflow-x-auto` gave it on the deleted `<pre>` before. The
`--shiki-light`/`--shiki-dark` custom properties Shiki writes onto each
token resolve through `.astro-code`'s existing three-state colour selector
the same way, unaffected by this addition.
`defaultColor: false` is what makes that possible, and it is already the
value `shikiConfig` sets.

**Zero client-side highlighting bytes, not zero client-side highlighted
bytes.** `shiki`'s highlighter, its `tsx` grammar and its two themes never
leave `Bench.astro`'s frontmatter, which runs once per build in Node, and
that is the whole of what this claim covers. `BenchIsland` receives four
already-rendered HTML strings as ordinary string props and picks which one
is visible, the same cost class as picking which `<link>` href to append,
not the 72.5 kB `createHighlighterCore` bundle `CompositionPanel.tsx`'s own
comment measured and rejected. That comment is now answered rather than
wrong: highlighting still costs that much in a browser, which is why it
runs in the frontmatter instead, and the comment is deleted along with the
plain-`<pre>` approach it was defending. The four strings themselves still
travel to the browser, though, as `astro:react`'s serialised props on the
`<astro-island>` this component hydrates from, so this section's claim is
true of the highlighter and false of the highlighted markup: four strings
of `<pre>` HTML, syntax spans included, are part of the page's payload
whether or not the reader ever presses a switch. The implementer measures
that serialised props payload (the size of the four strings as they appear
in the island's `props` attribute, gzipped) and records the figure in the
PR; this document does not set a budget for it, since no budget for it
exists today.

**With no JavaScript**, the readout is absent, unchanged from today.
`BenchIsland` is `client:only`, so nothing in it renders without a script.
What changes is that the highlighted HTML for all four positions already
exists in the page's static build output the moment the four strings are
computed, baked in at build time, not painted until the island mounts to
read its own props. A reader with no script never sees it rendered, the
same trade the frame's own `<noscript>` fallback already makes for the
picture.

## 4. The instruction line

One line, sans, above the switch groups: "Same markup. Two stylesheets.
Press one." It sits in `BenchIsland.tsx`, inside the switches column
(`<div className="grid gap-[var(--space-4)]">`), immediately before
`<BenchSwitches>`, the first thing in that column, so it reads before the
controls it is describing rather than after them. `e2e/site-bench.spec.ts`
pins the exact text, the same way it already pins `THEME_IMPORT`.

Styled to match the status line under the frame, in the treatment that line
carries after point 5 below: `--text-md`, `--font-sans`,
`--color-ink-muted`. Both are now plain sentences set in body prose beside a
technical control, which is what "same style" means once the status line
itself is no longer set at the 11px functional floor.

## 5. The status line is promoted

`.bench__quiet` moves from `--text-fn` (11px, mono, `--color-ink-subtle`) to
`--text-md` (`DESIGN.md`'s Type table: "1rem (16px), Applied to: body, and so
every paragraph"), the body rung, in `--font-sans` and `--color-ink-muted`,
the ink the palette table names for secondary prose. It stops being set as
functional machine output and starts reading as the sentence it always was;
`--color-ink-subtle` stays reserved for labels, captions and text actually
at the 11px floor, which this line no longer is.

**The licence credit drops to the fine-print rung**, `--text-sm`. That rung
already has a name on this exact page: `.close__fineprint` in
`index.astro`, at `--text-sm`, carrying "React 19 peer, ESM only, named
exports". The credit moves to the same size for the same reason that class
was named what it was: it is a footnote-weight fact beside the argument,
not a value or a state the reader is meant to read first. It keeps
`--color-ink-subtle` and Sans, both unchanged from today; only its size
moves, off the rung it was sharing with the status line and onto the one the
close already uses for the same register of text.

## 6. Changed lines are marked

**Deleting `none` makes every position's preamble the same length.** Today
only `theme` carries an import line; `none` carries zero, which is what
made the six-line JSX block a fixed count while the preamble above it was
not. With `none` gone, both `theme` and `docked` always print an import
line, a blank line, the `const source` line and a blank line, four preamble
lines, every combination, no position with fewer. So **the diff between any
two of the four printed compositions is an index-wise comparison,
`lines[i] !== next[i]`, with nothing to reconcile**: no combination ever
inserts or removes a line relative to another, only substitutes the text on
some of them (the import's package subpath, the source URL). That is what
makes "a line-level diff of two known strings is trivial" true here rather
than aspirational: there is no alignment problem to solve first.

**Which lines actually change**, per press: a skin press changes the import
line only (`theme.css` to `docked.css`); a source press changes the `const
source` line only. The static tree below the preamble, `Root` through the
ten controls, never changes, so no control line is ever marked.

**Marking a line** needs each rendered line addressable on its own. The
`ShikiTransformer` type, importable once section 3's own `shiki`
dependency step lands, confirms the hook: `line?: (this:
ShikiTransformerContext, hast: Element, line: number) => Element | void`,
the same kind of per-token hook `src/shiki.ts`'s existing
`repaintForContrast` already uses on `tokens`, except keyed to the line.
`Bench.astro`'s transformer implements `line` to write `data-line="N"`
(1-indexed) onto each line's element, alongside the existing transformer for
the four variants. `BenchIsland`, on a press, compares the previous
composition's plain-text lines against the next one's (both already in
hand, `buildComposition` is what generated the printed HTML), collects the
changed indices, and adds a modifier class to the matching `[data-line="N"]`
elements in the newly-visible HTML for `--duration-slow` (600ms).

**The mark is an accent left rule, opacity only**, per rule 5 of
`DESIGN.md`: a `::before` on the marked line, a fixed-width
`background-color: var(--color-accent)` bar sitting at `opacity: 0` at rest
with `transition: opacity var(--duration-slow) var(--ease)`. A press sets
the changed lines' opacity to 1 with the transition suppressed for one
frame, the standard flash-then-fade shape, a class toggled off, a layout
read forced, then removed, and the declared transition carries it back to 0
on its own. Never `border-color`, which this system does not animate; a bar
present throughout that only changes opacity is what keeps this inside rule 5.

**Under reduced motion, no fade, and no branch is needed.** `base.css`'s
site-wide rule already collapses every `transition-duration` to `0.01ms`
under `prefers-reduced-motion: reduce`, and its own comment explains why
that is safe here: every transition on this site moves `opacity` between
two settled states, so collapsing the duration lands on the settled state
immediately. The marked line's settled state is `opacity: 0` either way, so
a reduced-motion reader sees the panel update with no flash, through a rule
already written for a different feature and never touched by this one.

## 7. The close

Four cells, each headline one or two words, the number inside the sentence
where there is one. The second cell is a full rewrite of both halves the
2026-08-31 spec set: that spec's headline was `One adapter, not five`,
over a different sentence; this document changes the headline to `One
adapter` and replaces the sentence with the one below.

- `17 kB`, "Every primitive, gzipped. CI fails the build at 18." The number
  is `primitives.size.toFixed(0)`, read from `measureBundles` as
  `index.astro` reads it today; measured against the repository as it
  stands this comes out as `17 kB` against a budget of `18`
  (`scripts/bundle-budgets.mjs`'s `@playdeck/react (primitives, excl.
React)` target), so the headline is what the script returns today, not a
  value typed independent of it.
- `One adapter`, "Adding YouTube costs 6 kB. The other four never reach
  your bundle." `6 kB` is `youtube.size.toFixed(0)` from the same
  `measureBundles` call, `@playdeck/provider-youtube`'s own target,
  measured today at `6 kB`. Both figures stay reads, never literals, for
  the reason `index.astro`'s own comment already gives: a second copy
  would let the page and the gate disagree while both stayed green.
- `Plays anyway`, "When a browser refuses an audible autoplay, the player
  retries muted, sets autoplayRecovered, and leaves offering the sound to
  you." `autoplayRecovered` is the real field
  (`packages/core/src/types.ts:333`): "True only where `autoplay` is
  `'started'` because an audible attempt was refused by policy and the
  muted retry of `'audible-then-muted'` is what played, so a consumer can
  offer an unmute affordance" (lines 327 to 332). `'audible-then-muted'` is
  the exact `AutoplayMode` member (line 114): "attempts audible playback
  and, only when that attempt is refused by policy (`reason: 'blocked'`),
  mutes and attempts once more" (lines 110 to 113).
- `Nothing lies`, "Every provider reports what it can honour. A control it
  cannot renders nothing rather than a button that fails when pressed."
  This is the same fact `FullscreenButton`'s `status !== 'available'` early
  return already demonstrates on the bench, and the companion spec's
  control-bar contract names it as every gated control's shared shape.
  Nothing new is built to make this true.

**Why the other two go.** `0` ("Requests to a provider before someone
presses play") repeats the status line under the frame, which now says the
same thing at body size, more likely to be read there than in a cell at the
foot of the page. `Unstyled by default` repeated the skin switch, and the
switch no longer has an unstyled position to point at: the whole cell was
an assertion about `none`, which this document deletes. A cell asserting a
fact the page no longer runs is the "correct, honest, and dead" shape the
2026-08-31 spec diagnosed the old page with. `Plays anyway` and `Nothing
lies` are written the same way the surviving two already are, the
maintainer's own precedent in `index.astro`'s comment: "two are
measurements and two are claims, and the mix is deliberate."

## 8. The lede

"You write the markup, you write the CSS, and one source prop chooses the
provider." replaces "…and the same six lines drive all five." The six-line
count was a fact about the old panel's collapsed `<Player.Controls />`
self-close; once the panel prints the real tree, the block is roughly twenty
lines long and the sentence would be false the moment it shipped. The new
sentence keeps the same shape and claims something still true: one switch
changes the CSS import, the other changes one string literal, and nothing
else about the block moves, which point 6 above depends on being true,
since it is what keeps the diff between any two variants an index-wise
substitution.

The first sentence of the lede is unchanged: "React primitives and hooks
over native video, HLS, YouTube, Vimeo and Wistia."

## What is deleted

- The `'none'` member of `SkinName` (`bench-composition.ts`), the `{ value:
'none', … }` entry in `BenchSwitches.tsx`'s `skinPositions`, and every
  `'none'` string those two files and `e2e/site-bench.spec.ts` carry
  (`position(page, 'skin', 'none').click()` and the paragraph of comment
  explaining why `theme` had to become the resting position against it).
- `Bench.astro`'s `[data-bench-skin='none']` rule, the one resetting the
  activation button's browser-default paint to transparent. It existed only
  because `none` shipped no stylesheet at all to give that button an
  appearance of its own; every remaining position now ships one.
- The comment in `CompositionPanel.tsx` explaining why the panel is plain
  `<code>` rather than highlighted, and the measurement it cites (72.5 kB
  for a client-side highlighter). The reasoning is answered rather than
  wrong: highlighting still costs that much in a browser, which is why it
  now runs in `Bench.astro`'s frontmatter instead.

**The badge redraw stays, and applies under both skins.** The companion
spec's #552 fix no longer touches the selector at all: `[data-playdeck-part='activation']`
stays the one, unscoped rule it has always been, with no `:has()` anywhere.
Only its declarations change: the fixed `inline-size: 4rem; block-size:
4rem; border-radius: 50%` becomes `box-sizing: border-box`,
`min-inline-size`/`min-block-size: var(--playdeck-activation-size, 4rem)`,
`padding-inline: var(--playdeck-space-3, 0.75rem)` and `border-radius:
2rem`. A `min-*` size floors the box rather than fixing it, so a button
with no content pushing outward, like the bench's own
`Player.ActivationButton` mounting only `<Player.PlayIcon />`, still
measures exactly 4rem square and renders as the same circle it always has.
The library's badge rule therefore still matches the bench's activation
button by default under either remaining skin, and the bench's
full-bleed-plus-redrawn-badge treatment (the button goes transparent and
full-bleed, a `::before` paints the badge in its place, the icon shares the
badge's grid area) is still needed for the same reason it always was: the
4rem floor is still only the badge's own size, not the whole picture's
press target. What changes from today is only the selector this block is
scoped under: `[data-bench-skin='theme']` becomes whichever skin is
currently loaded, since both remaining skins (`theme.css` and `docked.css`)
are authored sheets that floor the badge the same unconditional way. The
bench's own rule stays outside `:where()`, so it wins over either sheet's
zero-specificity badge rule the same way it wins over `theme.css`'s today.

**The two `<Player.Time>` separator stays.** `DESIGN.md`'s account of it
reads as `none`-specific, "the `none` position cannot afford to show a
broken control", but the companion spec's row-two contract lists "a
separator" as a required element between the two `Time`s under both
remaining themes, not a CSS gap either stylesheet supplies alone. It was
never a workaround for having no CSS; it is a primitive gap (`Player.Time`
renders a bare `<time>` regardless of skin) every consumer has always had
to fill with a real child. `BenchIsland.tsx`'s
`<span aria-hidden="true"> / </span>` is unchanged.

## Verification

- `e2e/site-bench.spec.ts`: the skin group has two positions,
  `data-value="theme"` and `data-value="docked"`, in that order. Below
  48rem the skin fieldset (`[data-bench-switch="skin"]`) is not visible and
  the `docked.css` `<link>` is present in `document.head`. The panel
  contains at least one `span[style*="--shiki"]`, proving it is
  highlighted. The printed tree contains `VolumeSlider`, `CaptionsButton`,
  `PipButton` and a settings control, ten controls rather than one
  self-closing tag.
- The `jsxBlock` helper and its `toHaveLength(6)` assertions are dropped,
  the block is no longer six lines under any combination, replaced by an
  assertion that the preamble is always four lines (import, blank, `const
source`, blank) across all four positions, which is what point 6 depends
  on.
- `e2e/site-landing.spec.ts`: `thesis` is the display sentence, not the
  lede, and is untouched by this document. A new assertion covers the
  lede's full text instead, "You write the markup, you write the CSS, and
  one source prop chooses the provider.", and the four figure headlines,
  `17 kB`, `One adapter`, `Plays anyway`, `Nothing lies`, are asserted
  verbatim.
- Two doc comments still cite "the same six lines" and both need
  rewriting once the panel prints the real tree: `thesis`'s own comment in
  `e2e/site-landing.spec.ts` (lines 41 to 46), which says "the thesis
  paragraph says 'the same six lines drive all five'", and `jsxBlock`'s
  comment in `e2e/site-bench.spec.ts` (lines 41 to 50), which says "the
  thesis paragraph says 'the same six lines drive all five', so the count
  is a number the page states in prose and the panel has to keep true".
  Neither sentence describes the panel this document builds.
- The word "ledger" still appears nowhere; unchanged and still passes.
- `scripts/check-site-links.mjs` still passes unmodified; nothing here adds
  or changes an external link.
- `pnpm test:budgets` is unaffected by this document directly; it is
  affected by the companion spec's own `docked.css` budget target, which
  this document assumes lands with it.
- `site-quiet.spec.ts` still proves no provider is contacted before a
  press, under both sheets now rather than one. Neither `theme.css` nor
  `docked.css` is a third-party request: both are Vite-emitted hashed
  assets of this build, served from this origin as `theme.css` already is,
  so `foreign()`'s existing filter (`!url.startsWith(`${origin}/`)`)
  already excludes them with no change.
- A contrast check on the changed-line accent bar, `--color-accent` against
  `--color-sunken`, the panel's own well, at the 3:1 non-text UI owes:
  `#1b4fd8` against `#f1f1ed` in light is `5.88:1`, and `#8bacff` against
  `#0e0e12` in dark is `8.66:1` (computed with
  `packages/react/test/contrast.ts`'s `contrast` and `parseColor`). Both
  clear 3:1 with margin.
- No contrast check is owed for `--stage-hairline`. It draws a 1px
  separating rule, not text and not the boundary of an interactive
  element, so the 3:1 non-text UI figure above does not apply to it; the
  companion spec's own docked theme carries no contrast obligation for its
  hairline either, for the same reason.

## Open questions

None. Each question raised while drafting was answered from the code and
is recorded in the section it concerned.

## Amendments to DESIGN.md

### 1. The skin switch's own paragraphs, in "The bench's player, and the site's islands"

"`skin` is `none` and `theme`... `none` applies no CSS at all... `theme` is
the resting position, and it was `none` first" becomes: skin is `theme` and
`docked`, both authored stylesheets, and the switch's argument is no longer
unstyled-versus-styled but two ways of laying the same controls out, an
overlay that hides itself, and a bar that never moves. `theme` rests above
48rem for the same reason it always has (a first impression should not read
as broken); `docked` rests below it because the floating theme was already
going to collapse into close to that shape at that width, on a coarse
pointer, what a narrow viewport almost always is; on a fine pointer the two
positions still differ by one control, `VolumeSlider`, but not enough to be
an argument for offering the choice, so the switch is hidden rather than
shown offering it.

### 2. The badge-redraw and browser-default paragraphs (DESIGN.md, around lines 2313 and 2500)

Two references, not one. "`Bench.astro` writes one rule that changes how a
part looks, and it is a browser defect rather than a skin" becomes false
once the companion spec ships: #555 is fixed in the library, and the
`[data-bench-skin='none']` workaround it names is gone from `Bench.astro`
along with `none` itself. "The other half of the same defect, on the other
skin, issue #552, filed against the library rather than fixed there" is
revised rather than retracted: the library keeps the activation rule's
selector exactly as it was, `[data-playdeck-part='activation']`, unscoped
and with no `:has()` anywhere, and only floors its size instead of fixing
it, `min-inline-size`/`min-block-size: var(--playdeck-activation-size,
4rem)` with `box-sizing: border-box` and `border-radius: 2rem`. The
bench's `Player.ActivationButton` still renders only an icon
(`<Player.PlayIcon />`), with no content to push the floor open, so the
rule still matches it under both remaining skins the same way it always
has. The badge-redraw block in `Bench.astro` therefore still overrides it,
full-bleed and transparent with the badge repainted by a `::before`, so
the whole picture stays a press target rather than only the 4rem badge.
What moves is which selector the block is scoped under, following
whichever skin is loaded, not whether it exists.

### 3. Stances, "This app now authors no animation at all"

Restated for the second time. The count becomes one: the changed-line
accent fade in point 6 above, `opacity` only, keyed off a `data-line`
attribute Shiki writes at build time, the same shape the retired
`bench-refusal` keyframe used `data-live` for. It needs no
`prefers-reduced-motion` branch of its own, for the reason the deleted
animation's own paragraph already argued in general.

### 4. The Code section's account of what the composition panel is

"`/`'s composition panel is not highlighted, and it is the one block on this
site that is not" becomes false. Every code block on this site is now
highlighted by Shiki with the same `shikiConfig`, including the bench's,
which differs from the others only in running four times at build for four
states an island picks between, rather than once.

### 5. The `<Player.Time>` separator paragraph (DESIGN.md, around line 1958)

"The `none` position cannot afford to show a broken control" is revised,
not deleted: the separator was never `none`-specific, it is a primitive
gap (`Player.Time` renders a bare `<time>` regardless of skin) every
consumer has always had to fill with a real child, and the companion
spec's row-two contract lists a separator as required under both remaining
themes. The replacing sentence: both `theme` and `docked` need a separator
supplied as a child between the two `Time`s, the same
`<span aria-hidden="true"> / </span>` `BenchIsland.tsx` already renders,
and `none`'s absence is no longer why this document keeps it.

## What was asked and settled

| Question                                                                   | Ruling                                                                                                                                                                                                                           |
| -------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The two skin positions                                                     | `theme` and `docked`, replacing `none` and `theme`                                                                                                                                                                               |
| The new `--playdeck-color-hairline` mapping                                | `.bench__stage` gains one line, `--playdeck-color-hairline: var(--stage-hairline)`; `tokens.css` gains `--stage-hairline: var(--dark-line)`                                                                                      |
| Default position below 48rem                                               | `docked`, because the floating theme collapses to close to the same layout there anyway                                                                                                                                          |
| Skin fieldset below 48rem                                                  | Hidden; the two positions differ only by `VolumeSlider` on a fine pointer, identical on a coarse one, which is nearly every narrow viewport                                                                                      |
| **2026-09-04 reversal:** default position below 48rem                      | `theme`, at every width, once the control bar's idle fade made the floating bar a sound phone layout without leaving the picture — see the dated note under "1. The skin switch" above                                          |
| **2026-09-04 reversal:** skin fieldset below 48rem                         | Visible, at every width — the two skins now differ in the fade behaviour itself, not only in `VolumeSlider`                                                                                                                      |
| How the default is chosen without a flash                                  | `matchMedia` read once in the island's `useState` initializer, matching the existing `readySources[0]` pattern                                                                                                                   |
| What the panel prints                                                      | The real mounted tree, ten controls, not one collapsed `<Player.Controls />` tag                                                                                                                                                 |
| Where `SeekSlider` sits in that order                                      | First, ahead of `PlayButton`; it moves from third in today's mounted order, so it stays first in document order for the theme's row split                                                                                        |
| What keeps the printed tree and the mounted tree in step                   | A shared exhaustive array (`bench-controls.ts`) both files map over, not a test that diffs them after the fact                                                                                                                   |
| Settings menu content                                                      | Real content, `examples/react-menus.tsx`'s `RateMenu` as written, not an empty shell                                                                                                                                             |
| Where highlighting runs                                                    | Build time, in `Bench.astro`, via Shiki's `codeToHtml` directly, four precomputed strings; the highlighter ships zero client bytes, the four highlighted strings still travel as island props                                    |
| How `apps/site` reaches `codeToHtml`                                       | `shiki` added to `apps/site/package.json`'s `devDependencies`, pinned inside Astro's own `^4.0.2` range                                                                                                                          |
| How the panel avoids nesting `<pre>` in `<pre>`                            | A `pre` transformer hook adds the `astro-code` class plus `data-bench-composition` and `tabindex` to Shiki's own `<pre>`; `CompositionPanel.tsx` renders one `<div dangerouslySetInnerHTML>` around it and no `<pre>` of its own |
| What `.astro-code` gains for the deleted `<pre>`'s `m-0`/`overflow-x-auto` | `margin: 0` and `overflow-x: auto`, harmless on every Astro-emitted block, which already carries both                                                                                                                            |
| The per-line hook Shiki exposes                                            | `line`, confirmed against the `ShikiTransformer` type section 3's `shiki` dependency step makes importable: `(this: ShikiTransformerContext, hast: Element, line: number) => Element \| void`                                    |
| The instruction line                                                       | "Same markup. Two stylesheets. Press one.", above the switches, styled like the promoted status line                                                                                                                             |
| The status line's rung                                                     | `--text-fn` mono to `--text-md` sans; the credit takes the fine-print rung, `--text-sm`, already named on this page                                                                                                              |
| How "changed lines" is computed                                            | An index-wise diff of two known plain-text line arrays, always the same length now that `none` is gone                                                                                                                           |
| Whether the badge-redraw workaround survives #552 as shipped               | Yes: the selector is unchanged and unscoped, only its size floors instead of fixes, so the bench's icon-only button still measures the 4rem default and the block stays, rescoped to whichever skin is loaded                    |
| The changed-line accent bar's contrast against `--color-sunken`            | `5.88:1` in light, `8.66:1` in dark; both clear the 3:1 non-text UI owes                                                                                                                                                         |
| The close's four cells                                                     | `17 kB`, `One adapter`, `Plays anyway`, `Nothing lies`, two measured, two written, matching the page's existing mix                                                                                                              |
| Why `0` and `Unstyled by default` are dropped                              | Both repeat a claim made better elsewhere on the page now; neither has a live demonstration left to point at                                                                                                                     |
| The lede's last clause                                                     | "…and one source prop chooses the provider.", replacing a line count that stopped being true                                                                                                                                     |
| The `<Player.Time>` separator                                              | Stays; it was never `none`-specific, both remaining themes still need it supplied as a child                                                                                                                                     |
| Whether the 2026-08-31 "no capability table" ruling is reopened            | No; the close's four cells answer the maintainer's separate 2026-09-02 request in prose, which the 2026-08-31 spec's own table did not rule out                                                                                  |

</content>
