---
'@playdeck/core': minor
---

Resolve thumbnail cue URLs against the WebVTT file's own address

The still-unreleased sprite-thumbnail seek preview (`.changeset/lucky-hounds-thumbnail.md`)
published each cue's image URL exactly as the file wrote it, relative paths
included -- a common shape for sprite generator output. Used as an `<img
src>`, a relative cue URL resolves against the page's own address rather
than the thumbnails file's, so a sprite generator's ordinary relative output
would have produced a blank, 404'd preview with no notice.

`parseThumbnailCues` takes a second, optional argument, `baseUrl`: each
cue's `url` resolves against it the same way a browser resolves a relative
URL found inside any other fetched document -- against that document's own
final address, not the page that requested it. A cue's `url` is left
exactly as the file wrote it, unresolved, in every case resolution cannot
answer for cleanly: no `baseUrl` given; `baseUrl` not itself a valid
absolute URL; `baseUrl` using a non-hierarchical scheme such as `data:` or
`blob:`; or the cue's own URL carrying a raw tab, newline or other C0
control character, which the URL parser would otherwise strip before the
existing allowlist ever saw it.
