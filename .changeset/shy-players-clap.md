---
'@playdeck/react': minor
---

Add `PlaybackRateMenu`, a preset playback-rate menu

`setPlaybackRate` and `PlayerState.playbackRate` already existed, but no
shipped part exposed them — a consumer had to compose one from
`SettingsMenu`, `MenuRadioGroup` and `MenuRadioItem` by hand, the way the
reference example's `RateMenu` still does for a consumer who wants rate and
quality under one trigger.

`Player.PlaybackRateMenu` is the same preset shape `Player.QualityMenu` is
over that composition: it renders nothing until
`capabilities.setPlaybackRate` resolves `available`, lists a rate ladder
(default `[0.5, 1, 1.5, 2]`, overridable via a `rates` prop), and marks the
active rung from `state.playbackRate`.

No core or provider package changes: `setPlaybackRate` and its capability
already existed everywhere.
