---
'@reely/core': minor
'@reely/react': minor
'@reely/provider-wistia': minor
---

`isPermittedSourceUrl` now refuses a URL carrying a C0 control (U+0000 to
U+001F) or a space at either end, which closes a bypass of the scheme allowlist
itself (#326). The allowlist rejected a tab, line feed or carriage return
anywhere and then read the scheme with a start-anchored match — but the URL
parser's pre-processing is wider than those three characters: it also strips
leading and trailing C0 controls and spaces. One leading space was enough to
make the anchored read find no scheme at all, and a URL with no scheme is
permitted for every source type. `' javascript:alert(1)'`,
`' data:text/html,…'` and, for an `hls` source, `' blob:https://…'` all came
back permitted, while the browser stripped the same byte and resolved exactly
the scheme that was never checked. Their unprefixed forms were rejected then
and are rejected now.

The correction widens the rule that already covered the three interior
characters rather than adding a second kind of rule: the whole set the parser
pre-processes is rejected outright rather than stripped, which keeps the value
that plays identical to the value that was validated (#219). Nothing is trimmed
and nothing is rewritten. No URL that was permitted before is refused now — the
guard stops at U+0020, the last character the parser strips, and U+0021 is
outside it. `resolveNetworkPath` needs no trimming of its own as a result:
`' //host/a'` is refused before any caller reaches the substitution, so a
protocol-relative URL can no longer skip the `https:` normalisation (#219)
behind a leading space and be resolved against the page's own scheme instead.

**What a consumer sees.** Every boundary that runs the shared allowlist gets
this, since none of them restate it. Through `detectSource`'s explicit-object
path,
`{ type: 'video', sources: [{ src: ' javascript:alert(1)', … }] }` and
`{ type: 'hls', src: ' blob:https://…' }` no longer detect, and fail with the
existing `invalid-source` reason. MediaSession artwork with such an edge is
omitted. In `@reely/react`, a `Player.Poster` `src` or `srcSet` candidate, a
`nativePoster` or a text-track `src` carrying one is dropped rather than
rendered; `@reely/provider-wistia` emits its poster configuration notice
instead of writing the value onto `<wistia-player>`.

`@reely/core`'s README stated that everything outside the allowlist "is
rejected, whether it arrives as a string or inside an explicit source object".
That was false as executed for as long as the bypass stood. It is true now, and
the sentence after it describes the whole set the parser strips rather than the
three characters alone.

`minor` for the same reason `one-scheme-allowlist-for-source-urls` is, which is
the changeset this one corrects: every package is still at `0.0.0` with
`first-prerelease` unreleased, and under 0.x `minor` is the channel a breaking
change travels on. A URL that was accepted can now be refused — though a source
URL with a space or a control character at an edge has no reading the browser
and the allowlist ever agreed on, so what breaks is a value that was never
carried faithfully in the first place.
