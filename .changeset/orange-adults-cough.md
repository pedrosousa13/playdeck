---
'@playdeck/core': minor
'@playdeck/provider-native': patch
'@playdeck/provider-hls': patch
'@playdeck/provider-vimeo': patch
---

Decode WebVTT cue markup for native and HLS captions

`defaultCueRenderer` in `@playdeck/react`'s captions overlay renders
`TextCue.text` as React text, which is safe from injection but only correct
if that text is already plain. It wasn't for the native and HLS providers: a
standard cue payload like `<v Bob><i>Look out</i> &amp; run` passed straight
through from `VTTCue.text`/hls.js's parsed cue, so tags and character
references showed up on screen literally. The Vimeo provider was the only one
that stripped WebVTT tags and decoded entities before publishing a cue.

`TextCue.text`'s own doc comment now states the contract every provider is
held to: plain text, markup stripped, character references decoded.
`@playdeck/core` gains `plainCueText`, alongside `textTrackLabel` in
`text-tracks.ts`, which turns a raw cue payload into that contract -- tag
spans removed, and the WebVTT cue-text grammar's six named escapes (`&amp;`,
`&lt;`, `&gt;`, `&nbsp;`, `&lrm;`, `&rlm;`) and its decimal and hexadecimal
numeric character references (`&#38;`, `&#x26;`) decoded. An invalid or
out-of-range numeric reference (0, a lone surrogate half, anything past
U+10FFFF) maps to U+FFFD rather than being left literal. Nothing renders
through `dangerouslySetInnerHTML`; the overlay keeps drawing plain text
exactly as before, and a consumer's own `renderCue` now receives the same
cleaned text the default renderer does.

`@playdeck/provider-native`'s cue-text helper and `@playdeck/provider-hls`'s
`normalizeHlsCue` both run their cue's `text` through `plainCueText` before
publishing it. `@playdeck/provider-vimeo`'s own `decodeCueEntities` moves to
`@playdeck/core` verbatim; its `vimeoCueText` now calls the shared helper
after its own `↵`-to-newline substitution, which stays Vimeo's own since no
other provider's payload uses it. Vimeo's cue output is unchanged.

`minor` for `@playdeck/core`: `plainCueText` joins the public entry, the same
reason `notifySafely` did (1.1.0) -- a provider package cannot reach a
private helper, and copying the implementation into two more packages is how
those copies drift. `patch` for the three providers: no export surface moves
and no published type changes -- only what a native or HLS `TextCue.text`
now reads for a cue whose payload carried markup.
