---
'@playdeck/core': minor
'@playdeck/react': minor
'@playdeck/provider-native': patch
---

Each entry in a `{ type: 'video' }` source's `sources` takes an optional `media`, a CSS media query, so a site with a lighter mobile rendition alongside a heavier desktop one can express the split without a second player. Order works like `<source>` elements in a native `<video>`: the first entry whose `media` matches, or that has no `media`, and whose `mimeType` the browser can play, is the one that loads. A source string, or an entry without `media`, loads with no media check.

An element the client creates renders only the entries whose `media` currently matches, so no browser ever has a wrong entry to pick. An element from the server HTML (`loading="eager"` for a `video` file source) renders every entry with its `media` attribute instead, since the browser's own resource-selection algorithm is what picks among them there; once hydration runs, a mismatch between that pick and the current `matchMedia` result is corrected with one `media.load()`, and never while `currentSrc` is still empty. A `media` query that starts or stops matching after commit does not swap the source of a player that is already loaded — the same once-only timing the browser's own `media` attribute already has.

`isValidMediaQuery` (`@playdeck/core`) gates every `media` value before it reaches a `<source>` attribute or `window.matchMedia`: a length cap and a plain-text shape check, in the same spirit as `isValidTextTrackLanguage`. A value it rejects drops that source entry — never read as unconditional — and publishes a `configuration` notice naming it, the same way a refused `nativePoster` or a rejected `preferredTextTrackLanguage` does.
