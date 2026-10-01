---
'@playdeck/react': minor
'@playdeck/provider-youtube': minor
'@playdeck/core': minor
---

Add `Player.Root`'s `preferredTextTrackLanguage` and `defaultTextTrack` props

`Player.Root` gains two optional caption props. `preferredTextTrackLanguage`
is a BCP 47 language tag: once a source's tracks publish, and again whenever
captions turn on without the viewer having picked a track of their own,
selection resolves to an exact `TextTrack.language` match, then the same
base language (`en` matches `en-GB`), then the provider's own default track,
and otherwise the first `captions`/`subtitles` track. `defaultTextTrack`
(`'auto'` default, or `'off'`) starts every source, including YouTube, with
no track selected. Either prop stops acting the moment the viewer makes
their own choice for a source, through a control or `selectTextTrack`, and a
new source applies both again.

`preferredTextTrackLanguage` is checked against a BCP 47 tag's shape
(letters, digits and hyphens, up to 35 characters —
`isValidTextTrackLanguage`, newly exported from `@playdeck/core`) before it
is used for matching or folded into the YouTube embed's `cc_lang_pref` var.
A value that fails is ignored outright, exactly as an absent prop is, and a
`configuration`-category notice naming the rejected value is published on
`PlayerState.error` (`PlayerController.reportRejectedTextTrackLanguage`)
instead of being thrown.

On YouTube, `defaultTextTrack="off"` also writes the embed's own
`cc_load_policy=0` player var. This is unverified against a real YouTube
player: the platform's docs document `cc_load_policy=1` as forcing captions
on, but give `0` no documented meaning beyond matching the var's own
absence, so this repo's own coverage of it is a fake iframe API honouring
the var by construction, not a measurement of a real embed's response to it.
