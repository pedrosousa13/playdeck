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

Only one string shape is read, and it is the shape the SDK forwards: an ordinary
decimal number, with optional ASCII whitespace around it and an optional sign.
Everything else is refused — an empty or whitespace-only string, a non-numeric
one, `null`, `NaN`, and the exotic numeric literals `Number` would otherwise
have accepted (`'0x10'` as 16, `'0b11'` as 3, `'0o17'` as 15, `'1e3'` as 1000),
along with a non-breaking space that `trim` would have stripped. That narrowness
is deliberate: the string on this path is a slice of the embedding page's url,
so the grammar accepted here is a grammar somebody else writes. A bare
`Number(value)` would have given none of it — `Number('')` is 0, so coercing
straight through would have turned a report carrying nothing into a valid
playhead position of zero and published it.
