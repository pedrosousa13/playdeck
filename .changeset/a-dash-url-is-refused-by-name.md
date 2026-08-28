---
'@playdeck/core': minor
'@playdeck/react': minor
---

A DASH source is refused by name instead of by shape

A `.mpd` URL used to fall through source detection to `unsupported-string`, the
reason that cannot name a cause, and the message it produced restated the list
of accepted forms. A consumer reading it learned that their URL was not on the
list, not that DASH is out of scope, so the natural next move was to file an
issue and wait.

`detectSource` now raises the new `unsupported-format` reason for a URL whose
path ends in a streaming manifest extension this library recognises and does not
play, and `Player.Root` renders a message that names the format:

> Playdeck does not play DASH. The player source "https://cdn.example.com/stream.mpd"
> is a DASH manifest, and Playdeck plays HLS (.m3u8), MP4 and WebM.

The list behind it is exported as `unsupportedSourceFormat` and has both readers
— detection and the message — so a format added to it cannot be refused under a
sentence that fails to name it. It holds `.mpd` and DASH alone today.

`SourceDetectionFailureReason` gains a fourth member, which is breaking for a
consumer switching on it exhaustively. That is why it lands before 1.0 rather
than after.
