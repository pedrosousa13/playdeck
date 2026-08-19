# A measurement the library publishes is an output, not a token

[ADR-0001](0001-structural-css-ships-inline.md) drew a three-entry boundary for
structural CSS — inline on the
primitive, a token with an inline `var()` default, or `theme.css` — and all
three entries answer one question: where does a value the primitive _needs_ come
from? They are delivery mechanisms, and they all run inward. #174 introduced the
first value that runs the other way. When a provider can measure the media it is
playing, `Viewport` writes that media's own ratio onto the `viewport` part as
`--playdeck-media-aspect-ratio`, and nothing in the library ever reads it back.
Before that change there was not a single `setProperty` call anywhere in
`packages/`; there are now exactly two, the write and the removal, both in
`Viewport`.

So the rule: Playdeck may publish a measurement as a CSS custom property, written
imperatively onto the part that measurement describes. A property like that is
an _output_ — a thing the library says about itself for a consumer's stylesheet
to react to, in the same family as `data-state`. ADR-0001's boundary does not
place it, and does not need extending to, because that boundary is about
inbound values and this is the outbound direction.

Direction is the entire argument, and `CONTEXT.md` already carries it. A
**Token** there is "a CSS custom property a primitive reads inline with a
fallback, so a consumer can change a value from a stylesheet without importing
one" — the primitive reads, the consumer sets. `--playdeck-media-aspect-ratio`
inverts both halves at once. It fails the definition on direction, not on a
judgement call about whether it feels theme-ish, and any future published
property fails it the same way.

## Where it is documented

`Contract.mdx`, beside the other library outputs — the parts, the `data-state`
values, the ARIA a primitive owns. That page already reads as "what Playdeck tells
your CSS", and a published property is one more sentence in that voice.

Not `theme.css`'s token table, and this is where a previous reading was wrong
rather than merely different: #174's own brief called the property a token and
sent it to that table. The pull was the prefix — it is a `--playdeck-*` name, and
`--playdeck-*` names live in the token table. But the prefix is a namespace, not a
category. `Theme.mdx` presents its table as the values you may **set**, and
setting a published one buys nothing, because the next measurement overwrites
it. Listing it there would have documented the property by advertising the one
thing a consumer must not do with it.

The discoverability cost is real, so `theme.css`'s header pays it directly: it
names `--playdeck-media-aspect-ratio` as a `--playdeck-*` name deliberately absent
from the table, says the direction is the reason, and points at `Contract.mdx`.
A reader who goes looking where the other `--playdeck-*` names are still finds the
trail.

## Consequences

- A consumer must not set one. The library overwrites it at the next
  measurement, so there is no "set it yourself when you know better" story. A
  consumer who does know the shape in advance sets `aspect-ratio` on their own
  terms, or invents their own property name; they do not borrow ours.
- Unknown has to remove the property, never publish a zero or an empty value.
  The consumer's rule is `aspect-ratio: var(--playdeck-media-aspect-ratio, 16 / 9)`
  and a `var()` fallback applies only where the property is _absent_ — so a
  zeroed or stale value does not degrade to the fallback, it silently replaces
  it. That makes absence a first-class value the whole channel has to carry:
  providers that measure nothing usable report `undefined` rather than a number
  pair, the controller clears on provider swap and on detach, and `Viewport`
  calls `removeProperty`. `packages/core/test/dimensions.test.ts` pins it as the
  specific defect the channel exists to prevent.
- The value must not travel through `PlayerState`. Publication is a layout
  concern that only CSS ever reads, and a state field would wake every consumer
  of that state on every source change and every dimension change for it.
  `Viewport` therefore subscribes in a plain `useEffect` rather than through the
  `useSyncExternalStore` that `usePlayerState` and `useActiveCues` use —
  subscribing through that hook is exactly what re-renders.
- The measurement travels as plain data and the React layer does the DOM write.
  `@playdeck/core`'s public types compile under `tsconfig.no-dom.json` with
  `"lib": ["ES2022"]`, so no element the figures were read off can appear in
  them: `MediaDimensions` is two numbers. That constraint shapes any future
  instance too — core measures and reports figures, `@playdeck/react` decides which
  part they land on and what the property is called. The split is not a
  preference; the no-DOM build fails otherwise.
- `--playdeck-media-aspect-ratio` is the first and only instance — #174, landed as
  PR #134. One instance is not a pattern, and the temptation to resist runs both
  ways: do not invent a second before anyone asks for one, and do not file the
  next real one as a token on the strength of its prefix. The category exists so
  that argument is read rather than re-derived.
