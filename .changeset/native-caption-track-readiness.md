---
'@playdeck/provider-native': patch
---

Follow a native caption track's `load`/`error` lifecycle for its `readiness`

A caption/subtitle track's `readiness` was read once, at track discovery, as
a cue-count snapshot: a track whose cues arrive after discovery stays
`'loading'` forever, and a track whose fetch fails (a 404 or a CORS block)
also stays `'loading'` rather than ever reading `'error'`.

Each caption/subtitle track's `<track>` element gets a `load`/`error`
listener, diffed against the track set on every discovery pass so a
departed track's listener is removed rather than left dangling. `load`
republishes the track as `'loaded'`, `error` republishes it as `'error'`,
and either only when the value actually changes. A track nobody has
discovered an element for (a disabled track the browser has not started
fetching) is unaffected: it keeps publishing the cue-count snapshot it
always has.
