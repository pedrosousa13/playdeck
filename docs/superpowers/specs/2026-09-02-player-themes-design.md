# Two player themes over one control bar

## What this replaces, and why

`@playdeck/react` publishes one stylesheet, `theme.css`. It floats a control
bar over the picture with no rule for narrow viewports, no way to find the
volume control unless a reader already knows to hover the mute button, and no
mechanism to hide itself, ever. The homepage bench (see
`2026-08-31-landing-page-bench-542-design.md`) sells "the markup is yours" by
switching between this theme and no stylesheet at all, and the unstyled
position reads as a broken embed rather than as an argument. The maintainer
ruled on 2026-08-31 that a second authored theme replaces the unstyled
position, and that it has to differ from the floating one in layout, not only
in colour, so that mounting the same markup under two sheets is itself the
demonstration.

This document designs that second theme, `docked.css`, and along the way
revises `theme.css` to fix three defects the maintainer already filed against
it: #541 (the seek thumb never sits on its track), #552 (the activation part
is sized unconditionally), and #555 (a player with no CSS draws an opaque
button over its own poster).

## The control bar contract

Both themes style the same markup. A consumer composes:

Row one: `SeekSlider`, full width, its buffered range drawn behind the thumb
and the thumb sitting on the track (the #541 fix, below).

Row two, left to right: `PlayButton`, `MuteButton`, `VolumeSlider`,
`Time type="current"`, a separator, `Time type="duration"`, flexible space,
`CaptionsButton`, `SettingsMenu`'s trigger, `PipButton`, `FullscreenButton`.
Every button keeps the 44px hit target `theme.css` already locks
(`--playdeck-control-size`) with a 1.25rem (20px) icon
(`--playdeck-control-icon-size`, its default, unchanged by this spec). Whatever a provider cannot honour renders
nothing, which is already every control's behaviour (`controls.tsx`'s
`status !== 'available'` early return, present on `MuteButton`,
`VolumeSlider`, and the same shape on every other gated control). The theme
only has to lay out correctly with any subset present, not conditionally
style a missing one.

**No new wrapper element.** `Controls` (`controls.tsx`) renders one
`data-playdeck-part='controls'` div and takes `children` opaquely; it has no
concept of rows, and gaining one only so two stylesheets can draw a two-row
look is not worth it. `theme.css` already lays the part out with
`display: flex`; this spec adds `flex-wrap: wrap` to it, and `docked.css`
carries the same two declarations rather than inventing a second mechanism.
`seek-slider` gets `flex: 1 1 100%`, so it fills its own row on its own,
while every other child keeps `theme.css`'s existing `flex: 0 0 auto` on the
button-shaped parts, so the 44px hit-target protection is untouched. The
duration `Time` gets `margin-inline-end: auto` on the real attribute `Time`
writes in both its timed and untimed branches, `data-time-type='duration'`
(`transport-controls.tsx`), which is what pushes `CaptionsButton`,
`SettingsMenu`'s trigger, `PipButton` and `FullscreenButton` to the right
edge and keeps them there when any gated control ahead of them is absent.
The separator between the two `Time` instances is consumer text, not a
part: the bench composition renders `<span aria-hidden="true"> / </span>`
between them, and neither theme styles it. This works because `SeekSlider`
is always first in the composed children (the contract above fixes that
order), so its `flex: 1 1 100%` basis is the first thing `flex-wrap: wrap`
has to place, forcing it onto its own line ahead of everything else in
document order rather than by an element the theme would otherwise have to
invent. If a consumer ever reorders the children the row split silently
breaks, which is a cost worth taking against adding a
`data-playdeck-part='controls-row'` wrapper no primitive currently emits and
that only two stylesheets would ever read.

## Floating theme, `theme.css` (existing, revised)

Controls overlay the bottom of the picture on a gradient scrim, transparent
at the top and about 72% black at the bottom (`theme.css` already defaults
`--playdeck-overlay-scrim` to exactly that gradient), around 140px tall to
hold both rows plus the padding the part already applies.

**Auto-hide.** While `state.playing` is true and the viewport has been idle
2500ms, the controls and scrim fade to `opacity: 0` and stop accepting
pointer events. The rule sets `opacity: 0` and `pointer-events: none`
together on `:where([data-idle='true'] [data-playdeck-part='controls'])`,
with `transition: opacity`. So the non-interactivity lands when the fade
starts, not when it ends. That is acceptable because a reader who moves the
pointer gets the bar back immediately, and nothing under this
zero-specificity rule stops a consumer from choosing a gentler timing of
their own. That descendant selector assumes `Controls` sits inside
`Viewport` in the DOM, which is where `data-idle` is written; a composition
that renders `Controls` outside `Viewport` makes the auto-hide rule a
no-op, since there is nothing above it in the tree carrying the attribute.
The bar never hides while paused: `data-idle` is only ever set to
`"true"` while `state.playing` is true and is cleared on pause (see "Idle
detection" below). It also stays visible while any control has focus
(`:where([data-playdeck-part='controls']:focus-within)`), and that alone
already covers an open menu: `SettingsMenuContent` (`settings-menu.tsx`)
renders in-tree inside the controls part, not through a portal, and
autofocuses its first item on open, so an open menu always holds focus
somewhere inside `controls` and no separate open-menu selector is needed.
`SettingsMenuContent` also writes `data-playdeck-menu="open"` on itself,
which would be an available `:where([data-playdeck-part='controls']
[data-playdeck-menu='open'])`-style anchor if a menu with no focusable
items ever needed keeping visible without relying on focus; nothing in
this document uses it today, since `:focus-within` already covers every
menu state this spec has to handle. Dropping `:has()` also keeps the file
inside its declared support floor: `:has()`
needs Chrome 105 / Firefox 121 / Safari 15.4, above the package's
`browserslist` floor of Chrome 99 / Firefox 97 / Safari 15.4, and
`packages/react/test/theme.test.ts`'s feature inventory pins pseudo-functions
to exactly `['where']`, which a `:has()` selector would fail outright.
Nothing in this document uses `:has()` anywhere. `prefers-reduced-motion:
reduce` sets `transition-duration: 0.01ms` on the same selector, in the
block `theme.css`'s existing reduced-motion rule already lists the controls
part in.

**Zero specificity, kept.** `packages/react/test/theme.test.ts` asserts
every selector in `theme.css` carries zero specificity, by stripping every
`:where(...)` group and failing if anything survives outside one, and
separately pins the file's feature inventory: at-rules to `['layer',
'media']`, pseudo-functions to exactly `['where']`, and four named vendor
pseudo-elements. Both new selectors are wrapped whole in `:where()` for the
same zero-specificity reason as every existing rule:
`:where([data-idle='true'] [data-playdeck-part='controls'])` and
`:where([data-playdeck-part='controls']:focus-within)`. Neither nests a
second `:where()` inside the first, so the existing single-pass stripper
already covers them with no change to the test. #552, below, adds no new
selector at all, only new declarations on the existing
`[data-playdeck-part='activation']` rule, so it needs neither a `:where()`
change nor a test change either.

**Volume.** Where `(pointer: fine)`, `VolumeSlider` is always laid out at
its full `5rem` inline size next to `MuteButton`, so nothing shifts around
it; it rests at `opacity: 0` and fades to `1` on hover or focus-within of
either `MuteButton` or the slider itself. At rest it also carries
`pointer-events: none`, cleared back to the default alongside the opacity
fade, so a range input a reader cannot see is never a target their pointer
can accidentally land on and drag. Where `(pointer: coarse)` it is
`display: none` outright, because iOS Safari ignores a programmatic
`volume` write and a visible slider that cannot move anything is worse than
none. `MuteButton` and `VolumeSlider` are adjacent siblings with no wrapper
today (`transport-controls.tsx` renders them as independent parts); the
theme reaches the slider, not the button, with:

```css
:where(
  [data-playdeck-part='mute-button']:hover + [data-playdeck-part='volume-slider'],
  [data-playdeck-part='mute-button']:focus-within + [data-playdeck-part='volume-slider'],
  [data-playdeck-part='volume-slider']:hover,
  [data-playdeck-part='volume-slider']:focus-within
)
```

Every branch of that selector list ends on `[data-playdeck-part='volume-slider']`
as its subject, whether qualified by the mute button's state through the
adjacent-sibling combinator or by the slider's own `:hover`/`:focus-within`,
so the rule always targets the slider's `opacity` and `pointer-events`,
never the button's. Only `opacity` is animated; `pointer-events` is a hard
switch with no transition, since dragging a half-visible thumb mid-fade is
not a state worth animating into. Nothing about layout moves.

**Test amendment.** `packages/react/test/theme.test.ts`'s `every
button-shaped part is carried by every button rule` check picks up any
selector list naming one of the seven button parts and then requires it to
name all seven. The hover-adjacency selector above names `mute-button`, one
of those seven, alongside `volume-slider`, which is not -- so unamended, the
check would fail on a selector whose subject is the slider, not the button.
The check's `buttonRules` filter is amended to require every
`data-playdeck-part` a selector list names to be one of the seven button
parts, not merely one of them: a rule reaching past a button to a slider is
out of scope for a check that guards the shared button-shape contract, not a
failure of it.

**Below 48rem** the scrim flattens to a solid surface colour and `VolumeSlider`
is hidden by the same `display: none` rule a coarse pointer already gets;
`theme.css` makes no attempt to move the bar out of an overlay position at
this or any width. Every rule in `theme.css` is a `:where()` selector inside
`@layer playdeck`, and unlayered consumer CSS always wins over layered CSS
whatever its specificity (the file's own header rule 1) -- so a
`position: static` written here could only ever beat another layered
`:where()` rule, never the ordinary unlayered CSS a real composition uses to
float the bar in the first place. `apps/storybook/stories/reference/reference-player.tsx`'s
own `.playdeck-example-controls { position: absolute; ... }` is exactly that
shape, which is why that file reaches for a `@container` query rather than a
theme rule when it wants different layout at a narrow width. An earlier
draft of this document proposed exactly such a `position: static` rule; it
is dropped rather than shipped as dead CSS that reads as doing something it
cannot do. Docking the bar for real -- never positioning it over the picture
to begin with, so there is nothing to cancel -- is `docked.css`'s job, below.

Two rows still hold below 48rem: `SeekSlider` still takes its own row
exactly as it does above 48rem. Row two keeps every control from the
row-two contract except `VolumeSlider`. Every button in that row keeps
`theme.css`'s existing `flex: 0 0 auto` and its locked 44px minimum, so none
of them may shrink to fit; when the available width cannot hold the row as
one line, the same `flex-wrap: wrap` that splits `SeekSlider` onto its own
row lets the remaining buttons wrap onto a further line rather than
shrinking below the target or being dropped. At 320px, the narrowest width
`e2e/a11y.spec.ts`'s reflow cases already check, this produces a third
line, which is accepted rather than treated as a defect: losing a control or
a hit target would be worse than a taller bar.
>
> **2026-09-04: reversed for the desktop-locked 44px claim.** Measured on a
> real phone at 375px, "accepted rather than treated as a defect" turned out
> to be the wrong call: five buttons plus the times overflowed onto a third
> row on ordinary phone widths, not only at 320px (#598). `theme.css`'s
> "below 48rem" query now sizes controls at 2.5rem (still clearing WCAG
> 2.5.8's 24px floor) and hides `pip-button` under a coarse pointer instead
> of accepting the wrap; "theme.css makes no attempt to move the bar out of
> an overlay position" above is unaffected and still holds.
The picture keeps its own
aspect ratio, `aspect-ratio: var(--playdeck-media-aspect-ratio, 16 / 9)`,
because `Viewport` (`viewport-media.tsx`) owns that output and nothing in
the theme touches it.

Only `transform` and `opacity` (and `transform`'s longhands, `translate` and
`scale`) are animated anywhere in this file. `theme.css`'s header comment
already states this as a rule for the existing transitions; the new ones
follow it.

**#541, the seek thumb.** The container `seek-slider` grows past 44px
because its child, `seek-slider-input`, is a `<input type="range">`, which is
inline-level and gets laid into a line box with descender space below the
baseline; `seek-buffered` and `seek-buffered-range` then centre on the
container's `50%`, which is not the input's own centre once that gap exists.
The offset is a function of the consumer's inherited font, which is why the
issue measures a different number in the workbench and on the site, and
nothing about it is a rounding error. The fix stated in #541 is applying
`display: block` to `[data-playdeck-part='seek-slider-input']`, which removes
the line box entirely so the container becomes exactly the input's 44px and
the theme's `inset-block-start: 50%` lands on the input's own centre. It
changes no box model on the 44px target itself and it should apply to
`volume-slider` too, per the issue's own note that the two share the
selector and the same defect.

**#552, the activation part sized unconditionally.** `theme.css:95-107`
today declares `inline-size: 4rem; block-size: 4rem; border-radius: 50%`
unconditionally on `[data-playdeck-part='activation']`. That is the library's
one badge look, and it wins over a consumer's own `min-height` or padding
because an explicit size always outranks a fallback, clipping or silently
overriding a consumer's own label. Read against #552's own three options,
this spec takes the second, keep the size for the affordance it is drawn
for, but reaches it with no new selector at all: the existing
`[data-playdeck-part='activation']` rule stays the one rule it has always
been, and only its declarations change. `inline-size`/`block-size` become
`min-inline-size: var(--playdeck-activation-size, 4rem); min-block-size:
var(--playdeck-activation-size, 4rem)`, `border-radius` becomes `2rem`, and
the rule gains `padding-inline: var(--playdeck-space-3, 0.75rem)`, using
`--playdeck-space-3`, which already exists in `theme.css`'s token table,
rather than inventing a seventh spacing value. It also gains
`box-sizing: border-box`. `theme.css` today sets that only on the two
range-input thumb pseudo-elements (`::-moz-range-thumb` at `theme.css:353` and
`::-webkit-slider-thumb` at `theme.css:380`), never on a real
element; without it here, `padding-inline` on the activation part would add
to its `min-inline-size` rather than being absorbed inside it, and the
icon-only badge would grow into a pill on Blink and WebKit exactly the way
the labelled case is supposed to, and only that case.
`--playdeck-activation-size` joins the token table as a new token,
`4rem`, the value the badge has always used and continues to use by
default.

**The rule also gains `inline-size: fit-content` and `block-size:
fit-content`, and it cannot be left out.** This paragraph originally listed
the `min-*` pair alone, which is incomplete: `ActivationButton` positions
this part `position: absolute; inset: 0; margin: auto` inline
(`loading-error.tsx`), and against four zero offsets an `auto` size is not
shrink-to-fit — it is solved to fill the containing block, and a `min-*`
floor does nothing to stop that. Implemented without `fit-content` the badge
painted full-bleed over the whole picture, measured at 480x270 in a 480x270
viewport on Blink and Gecko alike, and `margin: auto` had no leftover space
to centre. `fit-content` sizes the box to its content, the floor raises that
to 4rem, and the offsets become over-constrained, which is the state
`margin: auto` needs. Any stylesheet that draws this part against the same
primitive positioning buys the same constraint, `docked.css` included.

Two measurement notes for anyone re-checking this. A fixture that renders
the part **statically** will confirm a broken implementation: `min-*` behaves
as intended in flow, and the defect exists only under the absolute
positioning the primitive writes. And an off-centre assertion cannot catch
it either — a full-bleed box is exactly concentric with its container, so
the offset reads zero while the box is wrong. Only the measured
`inline-size`/`block-size` discriminate.

A `min-*` size floors the box instead of fixing it. The library's own
icon-only default has no content pushing outward, so it still measures
exactly 4rem square and `border-radius: 2rem` on a 4rem square is a circle,
the same shape `50%` produced. `ActivationButton` (`loading-error.tsx`)
renders the literal text `"Play"` or `"Retry"` when a consumer passes no
`children` (`{children ?? (canRetry ? 'Retry' : 'Play')}`), and the
library's own bench composition
(`apps/site/src/components/BenchIsland.tsx:380-388`) mounts
`Player.ActivationButton` with a `<Player.PlayIcon />` child; both are
narrower than the 4rem floor, so both still render as the 4rem circle,
unchanged in appearance. A consumer who adds a label, or any content wide
enough to need more room, grows the box past that floor the way padding and
content always grow a box under `min-*` sizing, and `border-radius: 2rem`
on a box that has grown taller or wider than 4rem is a pill rather than the
squashed ellipse `border-radius: 50%` would draw on a non-square box.

Read literally, though, #552's first acceptance criterion is a labelled
activation control that measures at least 44px with no override required,
and this rule does not give a consumer that for free: the box still floors
at 4rem by default, so a labelled button with short text sits inside a
badge sized for an icon rather than shrinking to fit its content, and a
consumer who wants a smaller labelled affordance has to lower
`--playdeck-activation-size` themselves, one token, not zero work. That
trade is the right one rather than a shortfall: `theme.css` draws one badge
look, the 4rem centred circle, and that is still the correct unstyled
default for a bare `<Player.ActivationButton>` with no children, which is
the common case this rule exists for. A token is the override surface this
file already promises for every other appearance decision it makes, so a
consumer who wants a different size for a labelled control reaches for the
same mechanism they would reach for to change any other token, rather than
this rule inventing a second one. What #552 actually asked for, that a
consumer's own sizing and label are no longer clipped or silently
overridden by an unconditional fixed value, is met without any override at
all: the `min-*` floor never clips content, and a consumer's own
`min-height` or `padding` still composes with it instead of losing to it,
which was the original defect. This is the one already-necessary
structural change to `theme.css` this document did not invent for the
docked theme, and it lands in the same pass because #552 names the exact
rule this document reaches for anyway.

**#555, a bare player draws an opaque button over its own poster.**
`ActivationButton` (`loading-error.tsx:21-26`) writes no `background` or
`border` inline today, so with no stylesheet loaded the button paints the
user agent's own `buttonface` and `outset` border over `Poster`, which sits
at a lower `z-index`. The fix in #555 is in the primitive, not the theme:
`ActivationButton`'s inline style gains
`backgroundColor: 'var(--playdeck-activation-fill, transparent)'` and
`border: 'var(--playdeck-activation-border, 0)'`, so the UA default is
replaced by an explicit transparent one that a stylesheet can still reach
through the token, the same shape every other appearance property in this
file already uses. `theme.css` then sets those two tokens
(`--playdeck-activation-fill: var(--playdeck-color-surface, rgb(0 0 0 /
0.72))`, `--playdeck-activation-border: 0`) instead of declaring
`background-color`/`border` on the part directly, so the themed badge is
unchanged in appearance and the change is only which layer states the
colour. That is, on its face, the exact thing header rule 3 forbids:
`theme.css` declaring a custom property rather than only reading one. It is
a deliberate exception rather than an oversight, and the reason is what
makes `--playdeck-activation-fill` and `--playdeck-activation-border`
different from every other token in the file. Custom properties inherit:
without `theme.css`'s own declaration, a consumer who sets
`--playdeck-activation-fill` on an ancestor would still reach the button,
because the inline style's `var()` read resolves through the normal
inheritance chain to whatever the nearest declared ancestor supplied, the
same way every other token in this file already works. It is
`theme.css`'s own declaration on the part itself that changes that: a
custom property resolves to the nearest declaration in the inheritance
chain, and a declaration on the element itself is nearer than one on any
ancestor, so once `theme.css` declares the token on
`[data-playdeck-part='activation']`, that declaration is what a consumer's
ancestor-set value loses to, not the inline style. The theme therefore
declares the two tokens on the part with the same zero-specificity
`:where()` every other rule in the file uses, and the override surface
narrows to match: a consumer overrides either one with any selector that
matches the part itself, an attribute, a class, the part selector directly,
rather than from an ancestor the way every other token in the file can
still be reached. `theme.css`'s header comment gains this pair as a named
exception to rule 3, stating why, rather than leaving the file's own stated
rule silently contradicted by two lines deep in the sheet. This is a change
to `loading-error.tsx`, not to `theme.css` alone; every other item in this
document stays inside the two stylesheets.

## Docked theme, `docked.css` (new)

The bar sits under the picture at every width; nothing above 48rem moves
into an overlay position and nothing below it drops the volume slider,
because nothing in this theme ever covers the frame. The picture area is
untouched: same `Viewport`/`Media` structural geometry, same
`aspect-ratio` output, no rule from this file targets `[data-playdeck-part='media']`
or `[data-playdeck-part='viewport']` beyond the typography and colour every
consumer of a theme gets from the `viewport` part today.

**Colour.** No token is ever declared by `docked.css`, matching
`theme.css`'s header rule 3: every colour declaration reads
`var(--playdeck-color-x, <light default>)`, exactly the shape every
existing token in `theme.css` already uses, and a
`@media (prefers-color-scheme: dark)` block at the end of the file repeats
the same declarations, on the same selectors, reading
`var(--playdeck-color-x, <dark default>)` instead. Seven tokens, light
default then dark default:

- `--playdeck-color-surface`: `#f4f4f2` light, `#141416` dark
- `--playdeck-color-on-surface`: `#1c1c1e` light, `#ededed` dark
- `--playdeck-color-accent`: `#2b52d6` light, `#3ea6ff` dark
- `--playdeck-color-focus`: `#2b52d6` light, `#3ea6ff` dark (reuses accent's
  own value by default; theme.css keeps the two tokens independent and so
  does this file, a consumer can still set them apart)
- `--playdeck-color-track` (paints `seek-buffered`, the unfilled boundary):
  `#84847d` light, `#6d6d70` dark -- theme.css's own translucent-white
  default composites to near-invisible against a light surface, so this file
  needs its own
- `--playdeck-color-buffered` (paints `seek-buffered-range`, the loaded
  boundary): `#1c1c1e` light, `#ededed` dark -- the same values
  `--playdeck-color-on-surface` carries, kept as an independent token a
  consumer can still move separately
- `--playdeck-color-hairline` (new; nothing in `theme.css`'s token table
  names a border colour today, because the floating theme draws no borders
  outside forced-colors mode): `#d9d9d6` light, `#2a2a2d` dark

`--playdeck-color-hairline` is the only new token. The other six are not new:
`theme.css`'s header comment already names all of `--playdeck-color-surface`,
`-on-surface`, `-accent`, `-focus`, `-track` and `-buffered` in its token
table, each with a single default; `docked.css` reads every one of them with
a different fallback, never a declaration. `-track` and `-buffered` in
particular are not swapped for `-hairline`: an earlier draft of this
document read `seek-buffered`/`seek-buffered-range` from
`--playdeck-color-hairline`/`-on-surface` instead, silently dropping both
tokens from `docked.css` -- an omission that contradicted this same
document's own claim that every token besides the light/dark palette listed
here keeps `theme.css`'s default untouched. Checked at the 3:1 non-text floor
(WCAG 1.4.11), the same rule `theme.css`'s own `slider non-text contrast`
suite checks: `--playdeck-color-track` against `--playdeck-color-surface` is
3.42:1 light, 3.57:1 dark; `--playdeck-color-buffered` against
`--playdeck-color-track` (composited the same way `theme.css` composites its
own buffered-over-track boundary, never over the surface directly) is 4.52:1
light, 4.41:1 dark; `--playdeck-color-focus` against
`--playdeck-color-surface` is 5.81:1 light, 7.10:1 dark. An earlier draft's
track default, `#d9d9d6` -- read from `--playdeck-color-hairline`, meant for
a 1px border rather than a slider boundary -- measured roughly 1.15:1
against `#f4f4f2`, far under the floor; the `--playdeck-color-track` default
above replaces it for that reason, not only for the token-naming one.
`light-dark()` is not used. It is above `theme.css`'s declared support
floor (Chrome 99 / Firefox 97 / Safari 15.4; `light-dark()` needs roughly
Chrome 123 / Firefox 120 / Safari 17.5) and it is not one of the five
functions `packages/react/test/theme.test.ts`'s feature inventory pins
(`calc`, `env`, `linear-gradient`, `rgb`, `var`), so a rule using it would
fail that test outright.

The cost of this shape is a handful of duplicated declarations, the same
background/colour/border-colour properties written twice, once under the
default cascade and once inside the dark media block, each reading the
same token name with a different literal fallback. The gain is that a
page's own ancestor declaration, the site's `data-theme` attribute on
`<html>` among them, wins in both colour schemes with no extra work on the
page's part: a set custom property always outranks a `var(..., fallback)`
read, in or out of a media block, so the page's light/dark switch composes
the same way any consumer override already composes with a token default
in `theme.css`, and never has to know or care that a
`prefers-color-scheme` block exists underneath it.
`--playdeck-color-hairline` draws the one line this theme adds that the
floating theme has no use for, a 1px top border on the bar, separating it
from the picture, since there is no scrim to do that job here.

The `@media (prefers-color-scheme: dark)` at-rule itself is well inside the
support floor: it has shipped since Chrome 76 / Firefox 67 / Safari 12.1,
all below the package's Chrome 99 / Firefox 97 / Safari 15.4 line. It also
needs no addition to the feature-inventory test's pinned list:
`theme.test.ts`'s `atRules` check captures only the `@`-prefixed keyword
(already `['layer', 'media']`, since `theme.css` already has `@media`
rules), not the feature written inside the parens, so `prefers-color-scheme`
is not a name that test pins at all and `docked.css`'s second `@media` block
passes it with no change to the test.

The dark defaults for the four hand-drawn slider pseudo-elements
(`::-moz-range-track`, `::-moz-range-progress`, `::-moz-range-thumb`,
`seek-progress`'s and the seek input's own `::-webkit-slider-thumb`) nest
inside the SAME `@media (forced-colors: none)` block their light defaults
live in, as a `@media (prefers-color-scheme: dark)` sub-block, rather than
the other way around. This file has exactly one `(forced-colors: none)`
occurrence for the same reason `theme.css` does: `theme.test.ts`'s `leaves
every hand-drawn slider rule out of forced-colors mode` needle walk finds
the first `(forced-colors: none)` text match and walks its braces to find
where that block closes, so a second occurrence -- or the slider rules
arriving nested the other way, inside `(prefers-color-scheme: dark)`, where
the walk starting from the top-level match never reaches them -- would sit
outside what the walk checks, silently. AND semantics make the nesting
order otherwise unobservable in the rendered result: both conditions still
have to hold either way.

**Volume.** Same hover-expand behaviour as the floating theme, same
`(pointer: coarse)` hide. The mechanism is identical CSS, so it is written
once and not described twice in this document; see "Volume" above.

**No auto-hide.** Nothing in this theme is ever drawn over the picture, so
there is nothing for the auto-hide behaviour to protect. `docked.css` never
reads `data-idle` at all, a smaller footprint than "reads it and no-ops",
and it means a consumer who mounts only this theme pays nothing for the idle
timer's CSS surface, only for the constant-cost JS timer itself (below).

**Packaging.** A second entry point, `@playdeck/react/docked.css`, added to
`package.json`'s `exports` map alongside `"./theme.css"` and to `files`
alongside the existing `"theme.css"` entry. Both currently list `theme.css`
by its bare filename since the file ships from the package root rather than
`dist`, and `docked.css` follows the same shape. It is standalone, not
`theme.css` plus overrides: every rule `docked.css` needs is written in it,
so a consumer who imports only `docked.css` never downloads a byte of the
floating theme's scrim or hover-expand-only-over-a-picture rules that do not
apply to a docked bar, and vice versa. The two files share no `@import`.

**Size ceiling and the budget.** `scripts/bundle-budgets.mjs` does gate CSS
today: `theme.css`'s target carries `budget: 2.5` KB gzipped, and because the
file ships as authored, comments included, that ceiling is
applied to a `budgetedSubset` that strips comments first, not to the raw
file. `docked.css` should get the same treatment: a second `targets` entry,
`name: '@playdeck/react/docked.css'`, `path: 'packages/react/docked.css'`,
with its own `budgetedSubset: { label: 'CSS rules', extract:
stripCssComments }` (the same exported helper, reused rather than
reimplemented). Its `budget` is not `theme.css`'s `2.5` KB by symmetry:
`docked.css` is standalone (above), so it re-carries the `::-moz-range-*`
pseudo-element rules and the forced-colors block `theme.css` also ships,
the same weight paid twice rather than shared, against a smaller layout
section since it never overlays or auto-hides. Which side of `2.5` that
nets out to is not something to guess at; the number is measured after
`docked.css` is written, gzipped through the same `budgetedSubset`, and
rounded up to the next 0.5 KB. The settled table below records this as "to
be measured" rather than proposing a figure now.

## Idle detection

The one piece of JavaScript this document adds. The viewport part gains
`data-idle="true"` or `data-idle="false"`. `viewport-media.tsx` writes no
`data-*` attribute of its own today; its one output is the
`--playdeck-media-aspect-ratio` custom property, set with
`node.style.setProperty`. The precedent for a boolean string attribute is
`data-buffering` in `transport-controls.tsx`
(`data-buffering="true"` on `seek-buffered-range` during a stall).
`data-idle` follows that shape: short, unprefixed (every `data-*` output in
this package is unprefixed; only the CSS custom properties carry the
`--playdeck-` prefix), and boolean where the two values are literal strings
rather than presence or absence, matching `data-buffering`'s own shape
rather than `data-state`'s open string union.

**Where it's written.** `Viewport` (`viewport-media.tsx`) is the part that
already owns one `useEffect` writing a DOM output straight to its own node
(the aspect-ratio subscription) rather than through `PlayerState`, for the
stated reason that only CSS reads it and a state field would wake every
state consumer on every tick. `data-idle` is the same shape of output for
the same reason, so it is written by `Viewport`, not threaded through
`PlayerState` or `Controls`. `Viewport` already subscribes to `controller`
for dimensions; it adds one more subscription, to `state.playing`, and one
`setTimeout`/`clearTimeout` pair, reset on `pointermove`, `pointerdown`,
`touchstart`, `keydown`, and `focusin`, all attached to the viewport node
itself (not `document`) so a page with more than one player never has one
player's pointer traffic idle a different one. The timer is armed only
while `state.playing` is true, set to `data-idle="true"` after 2500ms with
no qualifying event, and cleared to `data-idle="false"` immediately on
pause (`state.playing` going false) or on any of the five events.

**Menus and focus stay CSS-side.** The timer never inspects whether a menu
is open or whether focus sits inside the controls: `theme.css`'s
`:focus-within` selector overrides the faded-out look independently of what
`data-idle` says, and it already covers an open menu, since
`SettingsMenuContent` renders in-tree and autofocuses on open (see
"Auto-hide" above), which is what keeps the JS a timer and nothing more,
per the brief. This does mean `data-idle` can read `"true"` while the
controls are visibly showing, whenever a menu is open or a control has
focus. That is intended: the attribute states
"nothing has moved the pointer or keyboard in 2500ms while playing," and the
CSS states "and nothing in the bar needs to stay visible for another
reason," and the two are deliberately separate concerns living in different
layers.

**No prop.** `RootProps` has a real precedent for exposing a numeric
threshold as a prop: `loadThreshold` and `playThreshold` are both public,
documented `Root` props read by `useActivation`. That precedent argues for
an `idleDelay` prop somewhere. It is not added here, because the precedent
is narrower than it looks: both existing props gate a one-time activation
decision `useActivation` already owns and threads through `Root`, while the
idle timer belongs to `Viewport`, which today takes no configuration props
at all beyond the DOM passthrough on `ViewportProps`. Adding the first
configurable number to a component that has none, for a behaviour that is
CSS-driven and easy to disable at the CSS layer already (a consumer who
wants no auto-hide can override the `[data-idle='true']` rule to
no-op), is more surface than the brief's own instruction to keep the JS "a
timer and nothing more" supports. 2500ms is a constant,
`IDLE_DELAY_MS`, local to `viewport-media.tsx`.

## What this spec does not do

No change to the homepage bench; that is `2026-09-02-bench-two-themes-design.md`'s
territory, not this document's. That companion spec wires the bench's skin
switch to `theme.css` and `docked.css`; this document does not. No new
primitives beyond the `data-idle` attribute, and no new component or part
name. No keyboard shortcut work beyond what `Controls`' existing `shortcuts`
prop already offers. No chapter markers, thumbnails-on-hover, or
playback-speed UI beyond what `SettingsMenu` already exposes today. No claim
about any other library anywhere in this document.

## Verification

**The idle attribute's transitions**, as DOM tests against `Viewport` in
isolation: playing plus 2500ms with no qualifying event sets
`data-idle="true"`; any of the five events resets the timer and, if fired
while idle, clears it back to `"false"`; pausing clears it immediately and
disarms the timer until playback resumes. Focus-within keeping the controls
visible is a CSS rule, not a JS branch, so that one is an e2e check instead:
focus a control, wait past 2500ms, assert the bar is still `opacity: 1`
despite `data-idle` reading `"true"` underneath.

**An e2e spec for the floating theme**: play, wait past 2500ms with no
input, assert the controls compute `opacity: 0`; send a `pointermove`,
assert they return; assert the controls never reach `opacity: 0` at any
point while the player stays paused, across a wait several times the idle
delay.

**A contrast check** for `docked.css`: every text and icon colour against
its surface, in both the light default and the `prefers-color-scheme: dark`
values, at 4.5:1, using `packages/react/test/contrast.ts`'s existing
`parseColor`/`over` helpers the same way `theme.test.ts` already composites
`theme.css`'s token defaults. This is the same check, run a second time
against a second file's default palette, rather than a new mechanism.
Alongside the text check, the same non-text 3:1 floor `theme.css`'s own
`slider non-text contrast` describe checks: `--playdeck-color-track`
against `--playdeck-color-surface`, and `--playdeck-color-buffered`
against `--playdeck-color-track` (composited, never against the surface
directly, for the same reason `theme.css`'s own describe composites that
way), plus `--playdeck-color-focus` against `--playdeck-color-surface`,
each in both colour schemes.
`docked.css` also joins `theme.test.ts`'s other suites over the same file,
not only the contrast one: the cascade-layer check, the zero-specificity
check, the feature-inventory check, and the token-table invariants, all run
a second time against the new file's rules rather than gaining a parallel
mechanism of their own. That requires parameterising the suite rather than
duplicating it: `theme.test.ts` reads `theme.css` once, at module scope,
into `themeSource`, and every `describe`/`test` below closes over that one
constant; the change is to read both files at module scope and run the same
`describe` body once per file (a `describe.each` over `[['theme.css',
themeSource], ['docked.css', dockedSource]]`, or an equivalent loop), so
adding `docked.css` to this suite is a parameterisation of the existing
tests, not a second copy of them. Most of those tests read the same
expectation for both files, but not all of them: the suites run per file
with per-file expected values for at least the function inventory
(`docked.css` has no scrim, so its `linear-gradient` call likely drops out
of the `functions` list `theme.css` pins), the packaging export name each
fixture asserts against (`'./theme.css'` versus `'./docked.css'`), and the
forced-colors needle list (the parts each file actually declares a
forced-colors rule for). Everything else, the cascade-layer, zero-specificity
and token-table shape, is one shared expectation both files are checked
against.

**The zero-specificity and feature-inventory tests cover both new
selectors with no change to themselves.** `packages/react/test/theme.test.ts`'s
existing single-pass `:where(...)` stripper already handles the one level of
nesting both new selectors use,
`:where([data-idle='true'] [data-playdeck-part='controls'])` and
`:where([data-playdeck-part='controls']:focus-within)`; #552 adds no new
selector at all, only new declarations on the existing
`[data-playdeck-part='activation']` rule. The feature-inventory test's
pinned lists need no new entries either: nothing this document adds uses
`:has()`, `light-dark()`, or any at-rule beyond the `@layer`/`@media` pair
it already pins. `docked.css`'s own run of that test, per the
parameterisation above, is a separate assertion against `docked.css`'s own
inventory, not a rerun of `theme.css`'s expected values.

**A changeset for `@playdeck/react`.** #541, #552 and #555 are each a fix,
which on their own would each read `patch`; the new `docked.css` entry point
is a feature addition, which reads `minor`. One changeset covering all four,
at `minor`, is enough, since a single release note already has to mention
`docked.css`'s arrival and semver only needs the highest level present in
the batch.

**`e2e/thumb-contrast.spec.ts`** gains #541's own assertion, alongside the
ring-contrast checks it already runs: that the range input, its painted
fill, and the buffered range share one vertical centre line, checked under
two different inherited font sizes. That needs two renders with genuinely
different inherited fonts, not one page read twice, so the check adds a
second Storybook story that sets a deliberately different `font-family`/
`font-size` on the composition's wrapper (rather than injecting a style
into the existing story from the e2e spec, which would leave Storybook's
own render out of the loop) and points a second `centreRow` assertion, the
spec's existing per-row sampling helper, at it. This is a second
parametrisation of an existing helper against a second fixture, not a new
mechanism.

**The 320px-at-200%-text reflow case wraps the bar onto more than a third
line.** `e2e/a11y.spec.ts`'s `320px at 200% text` case, one of the
`reflowCases` the test named `the composition reflows without loss of
content: 320px at 200% text` runs, already narrows the viewport to 320px
and scales the root font to 200% before asserting no clipping. Under the
floating position at that width and scale, "Below 48rem" above already
produces a wrapped third line at 320px alone; 200% text on top of it can
wrap further still, since every button keeps its 44px floor and refuses to
shrink. That test's existing no-clipping assertion
(`clip.clippedTopBy`/`clip.clippedBottomBy` both `toBeLessThanOrEqual(0)`)
must still hold regardless of how many lines the bar wraps onto, since the
picture's own box is what it is measured against, not a fixed row count,
and this document changes nothing about that assertion, only about how
many lines can legitimately produce a passing result under it.

**An axe pass already exists for the floating theme.** `e2e/a11y.spec.ts`
runs `@axe-core/playwright`'s `AxeBuilder` against the Storybook reference
composition, scoped to `[data-playdeck-part="viewport"]`, over nine states
(idle, playing, paused, captions-on, menu-open, captions-menu-open,
blocked-autoplay, global-shortcuts, error), asserting zero violations and a
pinned `incomplete` set. That composition is styled with `theme.css`, so the
floating theme is already covered. `docked.css` needs the same treatment: a
second fixture (or a parameterised run of the existing states) mounted with
`docked.css` instead of `theme.css`, joining the same spec rather than
starting a new one.

**A `bundle-budgets` entry** for `docked.css`, per the packaging section
above. `scripts/bundle-budgets.mjs`'s `targets` array gains the entry, and
whatever script consumes `overBudget()` picks it up with no further wiring,
since that function already iterates every budgeted target generically.

**A packaging check** that `docked.css` ships. `scripts/verify-packaging.mjs`
already carries the shape to copy: its smoke test navigates a fixture that
imports `@playdeck/react/theme.css` by its published specifier, then reads
back a computed style the fixture set a token for, to prove the file the
bundler resolved through `exports` is the real stylesheet and not an empty
or truncated one (see the comment at `verify-packaging.mjs:692-709`, which
also names the one way this check can go inert: a primitive that starts
reading the same token inline would make the check pass with nothing
loaded, and whoever does that has to move the check). `docked.css` needs
its own fixture page, its own token
(`--playdeck-color-on-surface` again is enough, since it differs between
the two files' defaults), and its own assertion, run alongside rather than
instead of the existing one. It mounts both themes once each rather than
either in place of the other, since the packaging harness's job is proving
each subpath resolves to real content, not proving the two disagree.

## Open questions

1. **Whether `docked.css`'s hairline top border doubles up when a consumer
   also sets their own border on the player's outer element.** Nothing in
   this design checks for that; it is the same class of risk `theme.css`
   already accepts everywhere (a consumer's own CSS can always look
   redundant against the theme's, and `:where()` zero specificity is the
   library's answer everywhere else too), so it needs no different handling
   here, but it was not separately verified against a real composition.

## What was asked and settled

| Question                                                                | Ruling                                                                                                                                                                                                                                                                                                                                                                                    |
| ----------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Does the docked theme replace or sit beside the unstyled bench position | Replaces it; the bench spec's `none`/`theme` switch becomes a second authored option, not this document's concern to wire up                                                                                                                                                                                                                                                              |
| Must the two themes differ in layout or only in colour                  | Layout: floating overlays and hides, docked never does either                                                                                                                                                                                                                                                                                                                             |
| Row split: new wrapper element or flex over existing parts              | `display: flex; flex-wrap: wrap` on the existing `controls` part, `SeekSlider` at `flex: 1 1 100%` forced full-width by source order; no new part                                                                                                                                                                                                                                         |
| `data-idle` owner                                                       | `Viewport`, matching its existing DOM-output-only `useEffect` pattern, not `Controls` or `Root`                                                                                                                                                                                                                                                                                           |
| Idle delay: prop or constant                                            | Constant, `IDLE_DELAY_MS`, no `idleDelay` prop                                                                                                                                                                                                                                                                                                                                            |
| Menus and focus during idle                                             | CSS-side only, `:focus-within` alone; `SettingsMenuContent` renders in-tree and autofocuses on open, so it needs no separate `:has([data-state='open'])` selector, and none is used; the timer never checks either                                                                                                                                                                        |
| #541, #552, #555                                                        | Fixed in this pass, alongside `docked.css`, not deferred to a separate change                                                                                                                                                                                                                                                                                                             |
| `docked.css` packaging shape                                            | Standalone file, own `exports`/`files` entry, own bundle budget, no shared `@import` with `theme.css`                                                                                                                                                                                                                                                                                     |
| `docked.css` bundle budget                                              | To be measured after writing the file, gzipped through the shared `budgetedSubset` helper, rounded up to the next 0.5 KB; not assumed equal to `theme.css`'s `2.5` KB                                                                                                                                                                                                                     |
| #552 scoping mechanism                                                  | `min-inline-size`/`min-block-size` (via a new `--playdeck-activation-size` token, default `4rem`) plus `inline-size`/`block-size: fit-content`, `box-sizing: border-box`, `padding-inline` and `border-radius: 2rem` on the existing `[data-playdeck-part='activation']` rule; no new selector, no `:has()`; the labelled-affordance criterion is met by setting one token, not zero work |
| `docked.css` colour mechanism                                           | `var(--token, #lightvalue)` fallbacks, plus the same declarations repeated in a `@media (prefers-color-scheme: dark)` block reading `var(--token, #darkvalue)`; no token is ever declared, no `light-dark()`                                                                                                                                                                              |
| Any use of `:has()` in this document                                    | None; `:has()` is above the package's declared `browserslist` floor and outside `theme.test.ts`'s pinned pseudo-function inventory                                                                                                                                                                                                                                                        |
