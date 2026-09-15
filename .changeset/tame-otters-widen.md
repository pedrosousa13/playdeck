---
'@playdeck/core': minor
---

Open `PlayerSource` and `ResolvedPlayerSource` through a generic parameter

Both types were a closed union of exactly five source kinds, with no seam for
a sixth. Each now takes an optional `Extra` type parameter, defaulted to
`never` — a union absorbs `never` without contributing a member, so
`PlayerSource` and `ResolvedPlayerSource` used bare, the way every existing
caller in this repo and out of it already uses them, are unchanged: the
identical five-member union they always were.

This is additive rather than breaking. No prior usage could have supplied a
type argument to either type — neither took one — so no existing call site is
affected by one becoming available; a type alias cannot be reflected on or
pattern-matched by arity the way a function can, so there is no way for a
consumer's own code to have depended on either type staying non-generic. What
opens up is new: `@playdeck/react`'s `providers` prop on `Player.Root` (added
alongside this in `@playdeck/react`) instantiates `Extra` with a supplied
kind's own source shape, so `Player.Root`'s `source` prop types that shape
directly once a consumer registers it — without widening what the five
built-in kinds accept for every consumer who never does.
