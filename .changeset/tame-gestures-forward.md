---
'@playdeck/react': patch
---

Fix a consumer ref on `Player.Gestures` and the settings menu parts never reaching the element

`Gestures`, `SettingsMenu`, `SettingsMenuTrigger` and `SettingsMenuContent`
spread `...props` -- which carries a consumer's `ref` in React 19 -- and then
set their own internal `ref` afterward, so the internal one always won and
`ref.current` stayed `null` with no warning. Each now merges the two refs
through `assignRef`: the consumer gets the part's element (an object ref) or
is called with it (a callback ref, its own cleanup respected), while the
part's internal ref keeps working -- and is explicitly released again on
unmount, rather than assuming a second call with `null` that a
cleanup-returning consumer ref would otherwise suppress. `PlaybackRateMenu`,
`QualityMenu` and `AudioTrackMenu` spread their props into `SettingsMenu`
unchanged, so they inherit the fix without any change of their own.
