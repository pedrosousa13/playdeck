---
'@playdeck/react': patch
---

Name a supplied provider by its registration key in a load-failure message

A supplied provider's own load failure -- its factory throwing, its `load()`
rejecting, or its `detect` returning a value whose `type` names no
registration of its own, no `type` at all included -- names that provider by
its own registration key in the message `ErrorDisplay` renders, in place of
"undefined". A factory throw or a `load()` rejection reads the key straight
off the resolved source's own `type`, since `loadProvider` only reaches a
registration's own code by finding it there first. A `detect` result whose
`type` does not route to any registration carries nothing to read a key from
at that point, so `detectSourceWithProviders` records the registration
behind such a result at detection time, and the message reads it back from
there. A `detect` result whose `type` names a different, real registration
still names that registration. The five built-in providers' own
load-failure messages are unchanged.
