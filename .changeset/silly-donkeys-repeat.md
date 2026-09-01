---
'@playdeck/provider-vimeo': patch
---

Read a Vimeo player value that arrives as a string, so the published position follows the embed

The Vimeo SDK's `checkUrlTimeParam` hands `setCurrentTime` the substring it
matched out of the embedding page's url without coercing it, and the embed
echoes that string back in the `seconds` of every event it publishes afterwards.
The adapter refused anything that was not already a number, so it never learned
the playhead had moved: the embed sat at one position while Playdeck went on
publishing another, with nothing to say the two disagreed. A consumer reading
`currentTime` got a value the player was not at.

The coercion now reads a finite number however it arrived, and it is deliberately
every value this adapter takes off that bridge — `seconds`, `percent`,
`duration`, `volume`, `playbackRate`, `videoWidth` and `videoHeight` — because
what varies is the transport, not the field: these cross a `postMessage`
boundary as untyped JSON and nothing on the way types them.

Nothing that is not a number becomes one. An empty string, a whitespace-only
string, a non-numeric string, `null` and `NaN` are all still refused, which a
bare `Number(value)` would not have done — `Number('')` is 0, so coercing
straight through would have turned a report carrying nothing into a valid
playhead position of zero and published it.
