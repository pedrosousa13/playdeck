# `asChild` / element substitution

Reely's primitives render fixed elements. `ActivationButton` always renders a
`<button>`, and the other controls follow the same shape. There is no `asChild`
prop, no `render` prop, and no other way to substitute the element a primitive
renders.

Children are the extension point. You can put anything inside a control — an
icon, an image, a design-system component — and you can reach any rendered
element through its `data-reely-part` attribute or the `style` prop. What you
cannot do is make some other component *be* the control.

## Why this is out of scope

The pattern Radix popularised is genuinely useful, and "headless" does invite
the expectation that the element type is yours to choose. Three things weigh
against it here.

**The accessibility guarantees are the product.** `ActivationButton` sets
`aria-label`, `aria-disabled`, `type="button"` and `data-state` on an element it
knows is a button. Substituting the element means merging those onto something
that may not be a button at all — and the moment a consumer supplies a `<div>`,
the guarantee quietly becomes their problem while still looking like ours. WCAG
2.2 AA is a release gate for this library, not an aspiration, so a feature whose
failure mode is silent a11y regression is expensive in a way the line count
does not show.

**The merging contract is real, permanent surface.** `asChild` means ref
merging, prop merging, and a documented rule for what wins when the consumer
and the primitive both set the same thing. That contract cannot be revised
later without breaking people.

**Capability gating complicates it.** Controls render `null` when their
capability is not `available` — `PipButton` and `AirPlayButton` do this
routinely. A consumer-supplied element has to compose sanely with a primitive
that sometimes renders nothing, which is a case the Radix-style pattern does not
have to answer.

```tsx
// Supported today: children, and the part attribute for CSS.
<Player.PlayButton>
  <MyIcon />
</Player.PlayButton>

// [data-reely-part='play-button'] { … }

// Not supported: substituting the element.
<Player.PlayButton asChild>
  <MyDesignSystemButton />
</Player.PlayButton>
```

## This decision is reversible

`asChild` is an additive prop. Nothing here forecloses adding it later if a
concrete need turns up — a real composition that children cannot express, with
the a11y question answered for it. What is rejected is adding it *speculatively*,
ahead of that need, and paying the merging-contract cost from then on.

If it is reconsidered, delete this file and scope the merging contract in its
own issue rather than folding it into story or theme work.

## Prior requests

- SIDEPRO-155 — "Decide whether the primitives should support asChild"
  (2026-07-29). Arose from reading the workbench and asking why the activation
  affordance is a `<button>`.
