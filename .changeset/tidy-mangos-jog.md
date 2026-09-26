---
'@playdeck/react': patch
---

Fix an inline callback ref on `Player.Media` reloading the provider on every parent re-render

An inline ref (`<Player.Media ref={(el) => ...} />`) gets a new function
identity on every render, which made the internal media registration tear
down and rebuild along with it -- stopping playback, resetting the position,
and showing the poster again. The consumer's ref no longer drives that
registration's identity, so a volatile ref stops churning it while still
receiving the node on mount and `null` on unmount.
