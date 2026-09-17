---
'@playdeck/core': minor
---

Open `PlayerProvider` and `ProviderAdapter` through a generic parameter

`PlayerProvider` was a closed union of exactly five provider kinds, with no
member a provider implemented outside the published packages could honestly
report. Both types now take an optional `Extra` type parameter, defaulted to
`never` — a union absorbs `never` without contributing a member, so
`PlayerProvider` and `ProviderAdapter` used bare, the way every existing
caller in this repo and out of it already uses them, are unchanged:
`PlayerState.provider` and `PlayerEventFor.provider` still resolve to exactly
the five-member union they always did, and a consumer narrowing on either
field keeps handling exactly the five cases it always handled.

This mirrors `PlayerSource`'s own widening from #662 rather than inventing a
second shape for the same problem: one precedent, one mental model, and the
two types stay symmetrical, which matters because a supplied provider needs
both — its own `PlayerSource` shape and its own `PlayerProvider` identity.

This is additive rather than breaking, for the same reason that widening was:
no prior usage could have supplied a type argument to either type — neither
took one — so no existing call site is affected by one becoming available,
and a type alias cannot be reflected on or pattern-matched by arity the way a
function can, so there is no way for a consumer's own code to have depended
on either type staying non-generic. Verified directly rather than assumed: a
consumer who narrows `PlayerState.provider` in a switch or an `if` chain today
is narrowing the bare, non-generic field, which is untouched by a type
parameter it never supplies — `packages/react/test/provider-loaders.test.ts`
now asserts this bare form by type equality, not merely by the suite
compiling.

What opens up is new: `@playdeck/react`'s `ProviderAdapterFactory`
(`packages/react/src/provider-loaders.ts`, added alongside the `providers`
prop in #662) instantiates `Extra` with a supplied kind's own source-type
literal, so a supplied provider's own factory can write `provider:
'example-file'` (say) on the adapter it builds directly, with no cast —
`examples/provider-setup-file-adapter.tsx`'s reference adapter no longer needs
one.
