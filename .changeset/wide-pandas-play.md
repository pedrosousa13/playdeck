---
'@playdeck/react': minor
---

Add `playThreshold` to `Player.Root`, so a player can prefetch early and play late

`loadThreshold` decided both when the provider attached and, because autoplay
fires once the provider is ready, when playback began. Those are two decisions
with different costs. Loading at the first visible pixel is cheap and makes
playback instant when the viewer reaches the player; starting playback there
spends bandwidth on a player nobody is looking at. Raising `loadThreshold` to
delay the second also delayed the first, which removed the reason to prefetch at
all, so `loadThreshold={0} playThreshold={0.5}` — load at the first pixel, play
at half visible — was unreachable.

`playThreshold` defaults to `loadThreshold`, so a player that sets neither, or
only `loadThreshold`, loads and plays on the same crossing it always did. One
`IntersectionObserver` watches both, and the taller-than-root escape that keeps
an oversized box from stalling on an unreachable `loadThreshold` covers
`playThreshold` too.

A `playThreshold` below `loadThreshold` is a configuration error rather than a
silent clamp — it asks the player to start before it is allowed to load — and is
reported the way the `loading="interaction"` with autoplay conflict already is.
