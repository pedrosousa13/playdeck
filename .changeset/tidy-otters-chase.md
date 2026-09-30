---
'@playdeck/react': minor
---

Add `ChaptersMenu`, a preset chapters-navigation menu

`PlayerState.chapters` and `capabilities.chapters` already existed, but no
shipped part let a consumer browse or jump to a chapter — a consumer had to
compose one from `SettingsMenu`, `MenuRadioGroup` and `MenuRadioItem` by
hand.

`Player.ChaptersMenu` is the same preset shape `Player.QualityMenu` and
`Player.PlaybackRateMenu` are over that composition: it renders nothing
until `capabilities.chapters` resolves `available`, or while the published
list is empty; otherwise it lists one rung per chapter (title and start
time), marks the rung containing the current playback position (derived
from `state.currentTime`, not read raw), and seeks to a chapter's start time
through `controller.seekToWithOrigin(startTime, 'user')` when chosen.

No core or provider package changes: `PlayerState.chapters` and
`capabilities.chapters` already existed everywhere they are populated.
