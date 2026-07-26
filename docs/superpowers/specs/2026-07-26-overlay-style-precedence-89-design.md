# Overlay geometry vs. the consumer's `style` prop (#89) — design

Issue: [#89](https://github.com/pedrosousa13/reely/issues/89). Both of its open questions were delegated to the agent on 2026-07-26 rather than answered by the owner; the rulings and the evidence behind them are recorded here.

#89 was found while doing #32's WCAG 2.2 AA pass. `LoadingIndicator`'s half was already fixed on that branch, because #32 could not make its contrast claim otherwise. What remained were two questions the issue deliberately left open: a contract question about `style` precedence, and a question about whether an overlay that is legitimately covering the player should leave residue in an automated audit.

## The measurement that settles Q1

The issue frames Q1 as a choice between two defensible readings — geometry-before-`style` is an overridable default, geometry-after-`style` is an invariant — and notes the current choice "appears incidental rather than argued".

It is incidental. Counted across every `...style` spread site in `packages/react/src/index.tsx` on `main` @ `714abdc`:

| Order                                                    | Sites | Components                                                                                                  |
| -------------------------------------------------------- | ----- | ----------------------------------------------------------------------------------------------------------- |
| `...style` **last** (geometry is an overridable default) | 15    | `Media`, `Captions`, `SeekSlider`, `SettingsMenuRoot`, `Gestures`, and every `controlTargetStyle` control   |
| `...style` **first** (geometry is an invariant)          | 7     | `Viewport`, `Poster`, `ActivationButton`, `LoadingIndicator` (both branches), `ErrorDisplay`, `PosterImage` |

The majority is already "overridable default". More decisive than the count: **the two groups are not separable by any principle the code states.**

- `Captions` (`index.tsx:1377`) is a positioned overlay carrying `z-index: 20` via `captionsOverlayStyle` — overridable.
- `Gestures` (`index.tsx:2673`) is `position: absolute; inset: 0`, full-bleed — overridable.
- `ActivationButton` (`index.tsx:1075`) is `position: absolute; inset: 0; z-index: 30` — **not** overridable.

Full-bleed overlay with a stacking context, on both sides of the line. Whatever rule separates them is not written down anywhere, and no reading of the source recovers one.

Two further facts push the same way:

- **Inline styles beat stylesheet rules.** For the 7 invariant sites, the _only_ override path available to a consumer today is `!important`. `Reference.mdx:34` ("Layout is your job too") advertises layout as consumer-owned; a documented escape hatch that requires `!important` to work is not an escape hatch.
- **Ecosystem convention.** Headless React libraries in this space (Radix, Base UI) treat a forwarded `style` prop as last-wins. A consumer's first guess will be wrong 7 times out of 22 in reely today, with no signal telling them which.

### Ruling for Q1

**Static geometry is a default the consumer can override with `style`. It goes before `...style`.**

With one carve-out, because "`style` always wins" is too blunt to be correct:

**Properties derived from player state are the primitive's output, not layout. They stay after `...style`.**

Two components have such properties, and both would be broken by the unqualified rule:

- `Poster` (`index.tsx:1025`) sets `visibility` from `posterState`. A consumer's static `style={{ visibility: 'visible' }}` would not be overriding layout — it would be pinning a state machine's output, permanently defeating the poster's own hide.
- `LoadingIndicator` (`index.tsx:1223-1229`) selects its whole branch from `active`. The _choice_ of branch is state-derived and stays the primitive's; the _contents_ of each branch are static geometry and become overridable.

The carve-out is narrow and mechanical: if the value is computed from `usePlayerState`, it is invariant; otherwise it is a default. That is a rule a consumer can hold in their head and a reviewer can apply without judgement.

### `PosterImage` and its dedicated props

`PosterImage` (`index.tsx:1484`) is the one site where a third precedence exists. `objectFit` and `objectPosition` are **explicit props** whose defaults are theming variables (`var(--reely-poster-fit, cover)`, `var(--reely-poster-position, center)`). They are neither static geometry nor state-derived.

An explicit prop is more specific than a generic `style` bag, so it wins; `style` in turn beats the CSS-variable default, because a consumer who writes `style={{ objectFit: 'contain' }}` has asked for exactly that. Precedence is stated in one expression rather than by spread ordering:

```ts
objectFit: objectFit ?? style?.objectFit ?? 'var(--reely-poster-fit, cover)';
```

The rest of `PosterImage`'s geometry (`display`, `width`, `height`) moves before `...style` with everything else.

### Why the constants get hoisted at the same time

Each of the 7 sites builds its geometry as an object literal inside the render body, so a fresh object is allocated on every render of every overlay — including `Poster` and `LoadingIndicator`, which re-render on state ticks. `controlTargetStyle` (`index.tsx:1498`) and `captionsOverlayStyle` (`index.tsx:1323`) already establish the module-level-constant idiom for exactly this.

Hoisting is not cosmetic here: it is what makes the ordering rule _checkable_. With the geometry in named module constants, `{ ...activationOverlayStyle, ...style }` is uniform and greppable, and a future site that gets the order wrong stands out. The per-render allocation going away is a real, if small, second benefit.

## Q2: the axe residue is the shadow, not the thing

The issue asks whether a full-bleed overlay that is legitimately covering the player should leave residue in an automated audit, and suggests it may be a composition question rather than a primitive one.

It is a composition question, and the composition has a defect materially worse than the residue.

`e2e/a11y.spec.ts` pins `color-contrast` as a known-incomplete on two states, `idle` and `error`. In both, the finding is `bgOverlap` on the time row inside `Player.Controls`. What the reference example actually renders in those states:

- **`error`** — `ErrorDisplay` is `position: absolute; inset: 0; z-index: 40` and, with the example's `reely-example-error` CSS, opaque. The control row is beneath it.
- **`idle`** — `ActivationButton` is a real `<button>` at `position: absolute; inset: 0; z-index: 30`, covering the viewport. The control row is beneath it.

In both cases the controls beneath are **invisible and unclickable, but still in the tab order and still exposed to assistive technology.** A keyboard user tabs into a play button they cannot see and a click cannot reach; a screen-reader user is offered a full control row that the pointer cannot operate. That is a WCAG 2.2 problem in its own right — 2.4.11 Focus Not Obscured most directly — and axe never says so. It reports only a contrast determination it could not complete, filed under `incomplete`, which is precisely the bucket #89 already identifies as the reason this class was invisible.

Making the primitive dodge the tool would fix the measurement and leave the defect. Fixing the composition removes the defect, and the residue disappears as a consequence — which is the correct direction of causation.

### Ruling for Q2

**Composition, not primitive.** The primitives are behaving correctly: a fatal error surface _should_ cover the player at `z-index: 40`, and a tap-anywhere-to-play surface _should_ cover it at 30. Neither should be weakened.

The reference example stops rendering the interactive control row while a full-bleed, pointer-capturing overlay owns the viewport:

```tsx
{activation === 'ready' && error === null ? <Player.Controls …>…</Player.Controls> : null}
```

`activation === 'ready'` is exactly the negation of `ActivationButton`'s own render gate (`index.tsx:1055`, `loading !== 'interaction' || activation === 'ready'` returns `null`), and `error === null` is exactly the negation of `ErrorDisplay`'s (`index.tsx:1268`). The condition tracks the overlays rather than restating their states, so it cannot drift out of sync with them.

`LoadingIndicator` is deliberately **not** in this set: it carries `pointer-events: none`, so controls beneath it stay operable, and it is not opaque in the example's CSS. The rule is about overlays that capture pointer input, not about every overlay.

### What this buys

Both `knownIncomplete: ['color-contrast']` entries in `e2e/a11y.spec.ts` become `[]`. Since that spec asserts `incomplete` by **equality**, that is not a suppression — it is a strictly stronger assertion than the one it replaces. After this change, six of the seven #32 states are fully clean, and the seventh (`menu-open`) carries only the documented axe-core limitation on `aria-haspopup` + `aria-controls`, which is not reely's.

## Scope

Beyond the two components #89 names, and deliberately.

The issue scopes its "what remains" to `ActivationButton` and `ErrorDisplay`, but its Q1 is a **library-wide contract question**. Ruling "geometry is an overridable default" and then applying it to 2 of the 7 sites would leave the inconsistency that made the issue necessary, with the additional cost that the rule is now written down and violated. All 7 sites move together, and the rule is documented in the parts contract.

Out of scope: `menu-open`'s `aria-valid-attr-value` (an axe-core limitation, per #89), and any change to which overlays exist or what they cover.

## Public behaviour change

This is a behaviour change on six shipped primitives, and it is owed a changeset entry alongside the ones #18 already inherits (#81, #16, #32).

A consumer passing `style` to `Viewport`, `Poster`, `ActivationButton`, `LoadingIndicator`, `ErrorDisplay` or `PosterImage` for a property the primitive sets sees that value **start taking effect** where it was previously discarded. The failure mode is a consumer who passed a colliding property, observed nothing, and left it in place — their layout changes on upgrade. Nothing silently stops working; something that silently did nothing starts working.

## Testing

Per component, in `packages/react/test/`:

1. **Static geometry is overridable.** Render with `style` colliding on the geometry property, assert the consumer's value wins. Red before the flip, by construction.
2. **State-derived properties are not overridable.** Render `Poster` in the hidden state with `style={{ visibility: 'visible' }}`, assert `visibility: hidden`. Red if the carve-out is dropped and the site flips wholesale — this is the test that pins the carve-out as deliberate rather than an oversight.
3. **`PosterImage` precedence is three-way.** Prop beats `style` beats the CSS-variable default: three assertions, one per rung.
4. **The composition does not bury controls.** Extend `e2e/a11y.spec.ts`'s existing per-state assertions: with both `knownIncomplete` entries removed, the equality assertion carries this. Add a direct assertion that no control is focusable in the `error` and `idle` states, so the guarantee is stated as focus reachability rather than inferred from an axe contrast bucket.

Test 4's direct assertion matters: the axe equality alone would pass again if someone re-rendered the controls _and_ the overlay stopped being opaque. The thing being protected is focus reachability, so that is what gets asserted.

## What changed during implementation

Two deviations, both found by measurement rather than review.

### 1. The control row is hidden, not unmounted — because unmounting it hit a library bug

The Q2 ruling above proposes `{activation === 'ready' && error === null ? <Player.Controls …> : null}`. That is what was built first, and it broke `e2e/reference.spec.ts`'s captions test on WebKit — **6 runs out of 6, and 6/6 green with the gate disabled**, so not a flake.

Instrumenting the example to expose the player snapshot showed the divergence exactly:

```
AFTER-CAPTIONS-CLICK
  state.selectedTextTrackId  null          <- correct
  button data-state          "on"          <- stale
  native track mode          "disabled"    <- the command reached the media
  captions-announcer text    ""            <- the component never saw a transition
```

Every other control (mute, play) updated on the same emits. Clicking anything else afterwards made the captions button catch up immediately, so the subscription was alive — **a single notification was dropped.** A control that subscribes to player state _after_ that state has already advanced can miss its next notification and render stale.

That is a `usePlayerState` bug, not an example bug, and conditionally rendering controls is an ordinary consumer pattern. Filed separately rather than worked around silently.

Switching to `hidden` sidesteps it and is better on its own merits: the subtree never unmounts, so there is no remount churn and no subscription to re-establish, and `hidden` still removes the row from layout, from the accessibility tree and from the tab order — everything SC 2.4.11 asks for.

`hidden` needs `.reely-example [hidden] { display: none !important }` to work here. reely's overlay primitives carry inline `display` (`Captions` is `display: flex` from `captionsOverlayStyle`), and a non-important stylesheet rule cannot beat an inline one. This is one of the few honest uses of `!important`.

### 2. Hiding the row collapsed the viewport below 420px

`@media (max-width: 420px)` drops `aspect-ratio` so the in-flow control row is not clipped (#32's 1.4.10 fix). With the row hidden, the box has no in-flow content left and collapses to zero height — measured as the viewport resolving to `hidden` at 320px, so `ActivationButton` could not be clicked at all. `aspect-ratio: 16 / 9` is restored via `:has(.reely-example-controls[hidden])`: the reason for dropping it only exists while there is a visible row to clip.

### 3. Blast radius was smaller than expected on the library side, larger on the example side

The Q1 flip broke exactly one existing test — `index.test.tsx`'s poster-layer test, which pinned the old contract deliberately and was updated to the new one. No other library test moved. The example, by contrast, needed two unrelated fixes above.
