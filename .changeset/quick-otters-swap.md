---
'@playdeck/core': patch
---

Replace a re-emitted provider notice rather than registering it again

A provider that re-decides a `configuration` notice per load and never
withdraws it registered one entry per emit in the controller's notice
registry, each of them held for the rest of that provider's life.
`@playdeck/provider-vimeo` is the concrete case: `start()` re-checks the
SEO-metadata suppression and re-emits its notice, `retry()` calls `start()`
again, and nothing takes the earlier registration away.

Nothing a consumer could observe was wrong while they accumulated -- the
read-time fold picks one winner however many equal entries stand behind it, so
`PlayerState.error` was right throughout -- but the registry grew with every
retry, where the single field it replaced could not.

Registering a provider notice that matches one already registered now replaces
it: one provider subscription speaks on that scope, so the same notice again
is the same claim restated rather than a second claim. Matching is every field
`PlayerError` declares, compared with `Object.is` (`cause` by reference, like
the rest), because the controller freezes each notice it is handed and so
mints a fresh object per registration -- identity cannot answer the question.
Two notices differing in any field are still two entries, and a replacement
keeps the earlier registration's place in the registration order the error
slot breaks ties by, so which notice that slot publishes is unchanged in every
case that worked before.

Refused consumer URLs are deliberately untouched. Those registrations are one
per reporter -- several reporters can hold the same prop and register the very
same shared notice value for one surface -- and each is withdrawn only by the
reporter that made it.
