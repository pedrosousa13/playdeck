---
'@playdeck/react': minor
---

Widen `ProviderAdapterFactory`'s return type to the supplied kind's own provider identity

`ProviderAdapterFactory<Source, Options>` (added in #662 for the `providers`
prop) returned the bare `ProviderAdapter` — `@playdeck/core`'s closed,
five-built-in-kind union — so no factory for a supplied kind could honestly
set `provider:` on the adapter it built without a cast to that narrower type.
It now returns `ProviderAdapter<Source['type']>`, instantiating
`@playdeck/core`'s newly-generic `ProviderAdapter` (companion changeset in
`@playdeck/core`) with the same literal a registration's own `Source` already
carries, so a supplied kind's factory writes its own identity directly.

Additive: this only widens what a valid `ProviderAdapterFactory` may return.
Every existing implementation — every one necessarily reported one of the
five built-in identities, since reporting anything else required the very
cast this change removes the need for — still satisfies the wider contract
unchanged, and `loadProvider`'s own five built-in branches are untouched.
`examples/provider-setup-file-adapter.tsx`'s reference adapter is the first
implementation that reports a supplied identity directly, with its
`as unknown as PlayerProvider` cast removed.
