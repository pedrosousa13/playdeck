# Decoding the hls.js stream, on WebKit

Playdeck does not assert that the bench's hls.js position reaches a playing rendition on
WebKit. The one e2e test that needs a decoded segment — the live stats readout's
"reports a real rendition" assertion — runs on Chromium and Firefox and is excluded from
WebKit permanently. This is not a gap waiting to be filled; it is a property of the
engine, and it was measured rather than assumed.

## Why this is out of scope

A CI measurement on 2026-09-05 (workflow run 33949679832, draft PR #635, Playwright's
Linux WebKit reporting UA "Version/26.5 Safari/605.1.15", hls.js 1.6.16 with
`preferManagedMediaSource: false`) established the cause.

`canPlayType('video/mp4; codecs="avc1.64001f"')` answers `"probably"` and
`MediaSource.isTypeSupported` answers `true` for `avc1.4d4028`, `avc1.64001f` and
`mp4a.40.2` — and hls.js queried and got `true` for every rung's codec pair — so nothing
filters the ladder and nothing routes away from hls.js onto the native decoder.
(`webkit-buffered-ranges.md` recorded `canPlayType('video/mp4')` as the empty string on
an earlier Playwright WebKit; on this build it answers `"maybe"` — a changed probe, not
a changed conclusion, since the codec-specific probe above is the one that governs the
bench's own source resolution.)

hls.js attaches, parses the master manifest, and publishes the correct three-rung ladder
(`3 · 268p, 536p, 804p`, the shape `Ladder` reads from the first snapshot on). It picks
the 804p rung, creates a video `SourceBuffer` for `video/mp4;codecs=avc1.4d4028` and an
audio one for `mp4a.40.2`, and appends the init segments plus three media segments
(~1.0-1.2 MB video each, ~77 KB audio each).

The element reaches `loadedmetadata` with `readyState` 1 and `videoWidth`/`videoHeight`
1920×804, `play` fires, then `waiting`. `buffered` briefly reads `[[0.023, 11.98]]` at a
`seeking` event (`currentTime` 0.1), and about 100 ms later the element fires `error`
with `MediaError.code` 3 (`MEDIA_ERR_DECODE`), message "Media failed to decode: Failed
to send data for decoding". From then on `buffered` is empty, `seekable` is empty,
`networkState` is 1, `readyState` stays 1, and `currentTime` stays 0.1 for the whole
25-second window. No console output, no page error, no failed request.

hls.js fires `LEVEL_SWITCHED` only from its `checkFragmentChanged` tick, which requires
`media.readyState > 1` and a buffered range under the playhead; neither ever happens, so
`PlayerState.quality` stays `null` and "Playing" prints the en dash.

This is a deterministic failure, not a rate, which is why one instrumented run was
enough: WebKit failed this test on every attempt of the four CI runs that carried it
(33905556602, 33912088294, 33912789627 and 33949679832, three attempts each under the
configured `retries: 2` — twelve of twelve), while Chromium and Firefox passed it on
each of those runs.

The conclusion is a property of Playwright's Linux WebKit's media pipeline — its decoder
rejects the H.264 stream the library correctly appended — not of the library or the
bench; real Safari decodes H.264.

Also observed, but out of this issue's scope and filed separately: the controller's
`State` field kept reading `playing` after the element's decode error.

## Why the obvious workarounds were rejected

**`preferManagedMediaSource: false`** was already applied in PR #631, and it changes
nothing about this readout: the measurement above shows the append succeeding under
plain `MediaSource` and the failure landing after it, at the element's own decode step —
a step no `MediaSource` flavour reaches past.

**A different ladder codec** is not available. HLS-in-MPEG-TS decoded with hls.js is
H.264 video and AAC audio, and the bench exists to show this exact ladder — swapping the
codec would mean showing a different feature.

**Relaxing the "Playing" assertion** to accept the en dash would leave a check that
cannot fail: the en dash is precisely the failure state this test exists to catch.

## What covers this instead

The ladder assertion still runs on WebKit and proves the manifest, the engine pin and
the quality-levels seam there — hls.js publishing `3 · 268p, 536p, 804p` from the
manifest alone, before any segment is decoded. The rendition assertion runs on Chromium
and Firefox every run. `packages/provider-hls`'s unit tests cover `LEVEL_SWITCHED` →
`quality` engine-independently, with no browser media pipeline in the loop.

## What would reopen this

A Playwright WebKit whose decoder accepts the appended H.264 stream. The check is the
readout itself, plus the `readyState`/`error` reading the diagnostic above took.

## Prior requests

- #632 — the "Playing" field stays "–" on the site bench's live stats readout, on
  WebKit. The full measurement lives on that issue.
