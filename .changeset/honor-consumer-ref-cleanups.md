---
'@playdeck/react': patch
---

`Player.Controls` runs a consumer's cleanup-returning ref callback on detach: the cleanup runs exactly once, and the callback is not also called with `null`. `Player.Captions` clears its own internal ref on detach through the same merged-ref shape `Gestures` and the settings menu parts use.
