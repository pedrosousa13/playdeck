---
'@playdeck/core': minor
'@playdeck/provider-wistia': minor
---

The Wistia provider's `poster` option now runs through the one shared URL
scheme allowlist (`isPermittedSourceUrl`, introduced for source detection)
instead of a stricter, provider-local `https:`-only check. `http:`,
protocol-relative and relative poster values are now accepted where they
were silently dropped before; `javascript:`, `data:`, `file:` and `blob:`
stay rejected, and a rejected poster still sets no attribute rather than
raising or warning — that part of the behaviour is unchanged. A
protocol-relative poster (`//host/...`) is normalised to `https:` in the
value actually written, the same substitution source detection already
performs (#219).

**What a consumer sees.** A poster URL that previously had to be an
`https://`-prefixed absolute URL can now be `http:`, `//host/path`, or a
relative path, matching every other URL-bearing surface in the library. A
poster that was accepted before (a well-formed `https:` URL) is written
identically, byte for byte.

Also exports `resolveNetworkPath` from `@playdeck/core` — the protocol-relative
normaliser the poster fix consumes, previously private to source detection.

Lands as `minor`: every package is still at `0.0.0` with `first-prerelease`
unreleased, and under 0.x `minor` is the channel a breaking change travels
on. It is breaking in one direction — a poster the old check dropped may now
be accepted and written to the DOM.
