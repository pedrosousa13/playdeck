---
'@playdeck/react': minor
---

Add `QualityMenu`, a preset quality-selection menu

`selectQuality` and `PlayerState.qualities` already existed, but no shipped
part exposed them — a consumer had to compose one from `SettingsMenu`,
`MenuRadioGroup` and `MenuRadioItem` by hand, the way the reference example
and `RateMenu` still do for playback rate.

`Player.QualityMenu` is the same preset shape `Player.CaptionsMenu` is over
that composition: it renders nothing until `capabilities.selectQuality`
resolves `available`, lists `state.qualities` plus an "Auto" row, and marks
the active rung from `state.selectedQualityId`. The auto row's own label
names the level actually playing (`state.quality`), e.g. "Auto (1080p)" —
`selectedQualityId === null` means auto, and a menu needs both fields, since
`quality` moves on its own under adaptive selection while `selectedQualityId`
is only what the consumer chose.
