---
'@playdeck/core': patch
'@playdeck/react': patch
---

Gate a supplied provider's own `providerOptions` bag through the shared allowlist before its factory is called

`loadProvider`'s supplied-kind branch handed `providerOptions[source.type]` straight
to the registration's factory with no validation, unlike the resolved source itself,
which the shared allowlist already covers. The reference file adapter carries its
playback URL in that bag and writes it into a `<source src>`, and `docs/provider-setup.md`
told readers that is where the playback URL goes — so a `javascript:` or `data:`
value written there by a consumer had no gate between it and provider-authored code.
A registration that builds an iframe from an option would have executed a
`javascript:` URL in the embedding origin.

Every string in a supplied kind's own option bag now passes the same shared
allowlist the resolved source passes before the factory is ever called. A refused
string is omitted from the bag exactly as if the consumer had not set it, never a
throw, and reported through `PlayerController.reportRefusedUrl` under a new
`providerOptions` surface — the same mechanism every other refused consumer-supplied
URL already uses. Numbers and booleans are never checked and always pass through
untouched, and built-in kinds' own option handling is unchanged.

`docs/provider-setup.md` and the reference adapter's comments
(`examples/provider-setup-file-adapter.tsx`) now say the allowlist applies here too.

`@playdeck/core`'s `RefusedUrlSurface` gains a new member, `'providerOptions'`,
alongside its notice in `REFUSED_URL_NOTICES` and its rank in
`REFUSED_URL_SURFACE_RANK` — the same closed union and tables every other
refused-prop surface is already declared in.
