---
'@playdeck/react': patch
---

Treat a supplied provider's `detect` throw as a decline instead of letting it escape render

`detectSourceWithProviders` called each `providers` registration's `detect(input)`
with no containment, and it runs during render, inside `Root`'s memoised source
resolution. A `detect` that threw — an ordinary adapter bug, such as parsing a
URL shape the author did not anticipate — escaped render and reached the
consumer's nearest error boundary, or unmounted the whole root if there was
none, for any string an attacker could put in the `source` prop. It also
stopped every later registration from being offered the URL, the opposite of
the deliberate behaviour one line below, where a registration returning a
refused value is treated as a decline and the loop continues.

A `detect` that throws now means the same as `detect` returning `undefined`:
that registration declines, and the loop moves on to the next one. The error
is not silently dropped — it is reported on a fresh task via `queueMicrotask`,
the same mechanism `@playdeck/core`'s `notifySafely` already uses to surface a
throwing subscriber without breaking its caller, so an adapter author can
still see their own bug.

`docs/provider-setup.md`'s "Supplying your own provider" section and the
`detect` JSDoc on `ProviderRegistration` now state this rule.
