---
'@playdeck/core': patch
'@playdeck/react': patch
---

Give the thumbnails fetch a deadline, a byte cap and a cue cap, and binary-search cue lookup

The React thumbnails loader's fetch (`packages/react/src/thumbnails.tsx`) now
carries a 4000ms deadline (`THUMBNAILS_FETCH_TIMEOUT_MS`), the same figure and
shape `OEMBED_REQUEST_TIMEOUT_MS` (`@playdeck/provider-vimeo`) and
`POSTER_PROBE_TIMEOUT_MS` (`@playdeck/provider-wistia`) already give their own
fetches: a WebVTT host that is malicious or merely compromised can no longer
hold it open indefinitely.

The response body is read through a counting stream reader
(`readCappedBody`) rather than `response.text()`, and abandoned -- the stream
cancelled -- once the running byte count passes `THUMBNAILS_FETCH_BYTE_CAP`
(10,000,000 bytes): `Content-Length` is not trusted on its own, since a
response can omit or understate it.

`parseThumbnailCues` (`@playdeck/core/thumbnails`) now stops, and publishes
no cues at all, once a file's cue count would exceed an internal cap sized
at roughly ten times the ~10,800 cues a 3-hour film produces at one cue per
second. Both this and the byte cap resolve to the same "no thumbnails"
result an unparseable file already produced; neither throws. The cap itself
is not exported: `./thumbnails` is a published subpath built as its own
bundle, so anything exported from that module ships in `dist/thumbnails.js`
and becomes public API, which this internal limit is not meant to be.

`thumbnailCueAt` is now a binary search over the cues' own running-maximum
`endTime`, rather than a linear `Array.prototype.find`, fixing the O(n) scan
`SeekSlider` ran on every `pointermove` while scrubbing a long thumbnail
track. It returns exactly what the linear scan returned, including when
cues share a `startTime` or overlap.

No public API changes beyond two new constants on the React side
(`THUMBNAILS_FETCH_TIMEOUT_MS`, `THUMBNAILS_FETCH_BYTE_CAP`), neither
re-exported from `@playdeck/react`'s main entry point -- the same treatment
`OEMBED_REQUEST_TIMEOUT_MS` and `POSTER_PROBE_TIMEOUT_MS` already get.
