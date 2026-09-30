---
'@playdeck/react': minor
---

Add `AudioTrackMenu`, a preset audio-track menu

`selectAudioTrack` and `PlayerState.audioTracks` already existed (#656), but
no shipped part exposed them — a consumer had to compose one from
`SettingsMenu`, `MenuRadioGroup` and `MenuRadioItem` by hand.

`Player.AudioTrackMenu` is the same preset shape `Player.QualityMenu`,
`Player.PlaybackRateMenu` and `Player.ChaptersMenu` are over that
composition: it renders nothing until `capabilities.selectAudioTrack`
resolves `available`, and lists one rung per published audio track. Unlike
`QualityMenu`, there is no "Auto" row and no sibling selection field to read
`MenuRadioGroup`'s value from — each `AudioTrack` carries its own `active`
flag, so the active row is derived from whichever entry has it set.

No core or provider package changes: `selectAudioTrack`,
`PlayerState.audioTracks` and their capability already existed everywhere.
