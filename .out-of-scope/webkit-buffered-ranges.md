# The buffered indicator's appearance, on WebKit

Playdeck does not assert **what the buffered indicator looks like** on WebKit. The two
e2e tests that need a rendered buffered range — the reference composition's visibility
test and its forced-colors counterpart — run on Chromium and Firefox and are excluded
from WebKit permanently. This is not a gap waiting to be filled; it is a property of the
engine and the fixture, and it was measured rather than assumed.

## Why this is out of scope

Playwright's Linux WebKit has no H.264 decoder — `el.canPlayType('video/mp4')` is the
empty string — so the reference composition falls past the MP4 to the WebM behind it and
plays `tracer.webm`. For that clip WebKit populates `el.buffered` on roughly **half** of
loads, and on the other half it never populates it at any observable instant.

Not "at instants the adapter does not sample" — at any instant at all. A probe on the
real story, reading `el.buffered.length` on every `requestAnimationFrame` and on 18 media
events across 13 loads, measured a length of 0 in **0 of ~450 frames** and **0 of 708-751
`durationchange` ticks** over ~8s of wall clock on the failing loads, while `el.seekable`
grew to `[[0, 1.000333333]]` and playback ran through to `ended`. In all **7 of 7** loads
where `buffered` was ever non-empty, the `canplay` snapshot the native adapter already
takes caught it.

So the two tests fail at their precondition, at about the rate the engine misses:
sequential runs on an idle machine gave 4 passes / 4 failures for the visibility test and
3 passes / 5 failures for the forced-colors one, each failure a range count of 0. On the
same builds Chromium and Firefox passed every run.

## Why the obvious workarounds were rejected

**Publishing `buffered` from more media events** is the fix its sibling defect got, and
it buys exactly zero passing runs here: 7 of 7 populated loads were already caught at
`canplay`, and a failing load has no instant to publish from. That is what distinguishes
this from an adapter gap.

**A different or longer fixture** was tried, not reasoned about. A generated 30s VP8 clip
failed 3 of 8 — the same rate as the 1.000s original's 3 of 8 — so clip length is not the
variable. Also ruled out by measurement: `Accept-Ranges`, `preload="metadata"`, the
entries in the `<source>` set, the adapter's second `media.load()`, and rescuing a bare
load after the fact with a seek, a replay or another `load()`.

**Relaxing the assertion** to tolerate zero ranges would leave a test that cannot refuse
the defect it exists for — #191's indicator rendering nothing is precisely a range count
of 0. A guard that cannot fail is worth nothing, the same reasoning as
[webkit-key-event-round-trip](./webkit-key-event-round-trip.md).

## What covers this instead

The behaviour is not engine-specific: the layer's geometry, its two-tone contrast, its
pointer-transparency and its forced-colors treatment are all authored CSS over
`PlayerState.buffered`, and Chromium and Firefox exercise every one of those assertions
on every run. What WebKit alone would add is confidence that this engine reports the
ranges, which is the thing measured absent. The adapter's own `buffered` publishing is
covered by engine-independent unit tests.

The exclusion is narrow: two tests, each skipped at the top of its own test with the
reason stated, in `e2e/reference.spec.ts`. Every other test in that file still runs on
WebKit.

## What would reopen this

A WebKit build that reports buffered ranges for this clip on every load, or a fixture
this engine populates `buffered` for deterministically — an H.264-capable Playwright
WebKit, which would take the MP4 and never reach the WebM, is the likelier of the two.
Either way the check is the one that produced this record: at a failure rate of one in
two, a single green run proves nothing, so the runs have to be repeated enough times to
tell "always" apart from "half the time".

## Prior requests

- #401 — "WebKit reports no buffered ranges for the WebM tracer clip, so the buffered
  indicator never renders there". The full measurement lives on that issue.
