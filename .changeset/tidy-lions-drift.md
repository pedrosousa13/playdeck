---
'@playdeck/provider-native': patch
---

Confirm a start position once the engine stops seeking, not on a fixed delay

The provider's `startTime` refusal notice was decided from a single, same-tick
read of `currentTime` after the write. Chromium and firefox clamp before that
write's setter returns, so the read already sees the refusal there, but WebKit's
clamp can land after the setter returns — so the read sometimes saw the value it
was just given rather than where the engine settled, and an offset the element
went on to abandon was reported as applied. Measured on 2026-09-01 across two
CI runs of the same WebKit case: the first run failed the initial attempt and
both retries, and the second run passed the initial attempt and failed a
retry, with chromium and firefox passing throughout both runs — a race, not a
flat WebKit limitation, where the same source, offset and engine produced the
forbidden silent drop on some loads and not others.

A single deferred read on a fixed delay after the write is not a fix for that
race, and CI measured one failing rather than assumed it: scheduled on the very
next macrotask, it still reported the playhead at 0 with no notice on two
attempts of three on 2026-09-06, because WebKit's own seek task — which finds
the empty `seekable` and aborts the seek — is not reliably ordered ahead of a
read at any fixed delay.

Where the same-tick read now reports success, the provider instead polls
`media.seeking` — the flag the HTML seek algorithm itself clears once a seek
concludes, whether it completed or was aborted, with no `seeked` fired on the
abort path. The deferred read runs the moment that flag reads false, so it is
confirmed rather than guessed. It publishes the notice if the playhead is
still below the offset by more than the existing tolerance; a playhead found
ahead of it is playback that started, not a refusal, so that publishes
nothing. A seek that never stops is treated as stalled media rather than a
refusal and the check gives up on it after fifteen seconds without publishing.
The check drops silently instead of publishing where a retry has reloaded the
source, a seek command has moved the playhead, or the provider has been
destroyed in the meantime, so the notice still lands at most once per load.

Chromium and firefox already clamped synchronously, so their behaviour is
unchanged.
