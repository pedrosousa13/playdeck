---
'@playdeck/core': major
'@playdeck/react': minor
'@playdeck/provider-hls': minor
'@playdeck/provider-vimeo': minor
'@playdeck/provider-youtube': minor
'@playdeck/provider-wistia': minor
'@playdeck/provider-native': minor
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

The Auto row carries its own gate, `capabilities.selectQualityAuto` — a new
`PlayerCapabilities` field, distinct from `selectQuality`. A provider can
select real rungs without honouring `selectQuality(null)` for auto:
`@playdeck/provider-vimeo`'s ladder does not always carry an `auto` entry,
and where it does not, `selectQuality(null)` resolves `unsupported` against a
ladder that otherwise selects fine. A menu gated on `selectQuality` alone
would render an Auto row that silently does nothing when chosen on such an
embed. `@playdeck/provider-hls` never splits the two — hls.js honours
`currentLevel = -1` whenever it has a ladder at all, so `selectQualityAuto`
mirrors `selectQuality` there. `@playdeck/provider-native`,
`-youtube` and `-wistia` report `selectQualityAuto` unavailable alongside
their existing `selectQuality` verdict, for the same reason: none of the
three offers quality selection at all.

`@playdeck/core`'s `PlayerCapabilities` gains a required field, which is a
breaking change under this project's 1.0 contract: any object built to
satisfy that type — a custom provider adapter, a capabilities fixture in a
test — needs the new field before it type-checks again.
