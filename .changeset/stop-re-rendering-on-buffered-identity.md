---
'@playdeck/core': patch
---

Keep a held `buffered`/`seekable` array when a patch repeats the same ranges

`PlayerController` keeps the `buffered`/`seekable` array it already holds
when a provider patch reports the same ranges again under a fresh array
identity, so a `usePlayerState` selector naming either field re-renders only
when a range actually moves. A provider's own poll -- YouTube's 250ms tick
is one -- can otherwise allocate a fresh array on every tick regardless of
whether anything changed.
