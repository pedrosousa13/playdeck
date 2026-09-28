---
'@playdeck/react': patch
---

Stop `Root` from publishing a spurious `refusedCommand` for a controlled
`volume`, `muted`, or `playbackRate` prop before a provider has attached.

Setting one of these props before the player has a provider -- the default
`loading: 'viewport'` before the player scrolls into view, or
`loading: 'interaction'` before the viewer's first gesture -- used to issue
the matching command anyway, which the controller refused for want of a
provider and published on `PlayerState.refusedCommand`. The value was never
lost: `Root` already seeds it once a provider attaches, or once an embed
reports ready, so the early command accomplished nothing but the refusal.
`Root` now skips issuing it while unattached, and still seeds the value the
same way once a provider exists.
