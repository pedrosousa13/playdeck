---
'@playdeck/provider-youtube': patch
---

Pause the YouTube time poll while the document is hidden

The 250ms position poll stops outright while the document is hidden, rather
than keep running at the browser's throttled rate, and polls once
immediately on show, restarting the interval only if playback is still
wanted. Playback itself is never paused, and the visibility listener is
removed whenever the poll stops wanting to run, including on destroy and on
retry.
