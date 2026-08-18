---
'@playdeck/core': minor
'@playdeck/react': minor
---

One scheme allowlist now governs every source URL, and it is exported as
`isPermittedSourceUrl` so no boundary has to restate it (#219). `http:`,
`https:` and the scheme-less forms — protocol-relative, root-relative and
relative paths — are permitted. `blob:` is permitted for a `video` source only,
which is how a consumer hands over a `MediaSource` or a picked `File`, and
rejected for `hls`, whose manifest loader fetches the URL itself. Everything
else is rejected. The predicate takes the URL and the `type` of the
`ResolvedPlayerSource` it belongs to — or `undefined` for a bare string no type
has been resolved for yet — so `isPermittedSourceUrl(url, source.type)` reads
straight off a resolved source.

The allowlist previously ran on the string path alone, and two things walked
past it. An explicit source object was never scheme-checked at all, so
`{ type: 'video', sources: [{ src: 'javascript:alert(1)', … }] }`,
a `data:text/html,…` source and `{ type: 'hls', src: 'file:///etc/passwd' }`
were all accepted and carried to a `<source src>`, a media element's `src` or
the HLS manifest loader — through the documented public source API, with no
attacker-supplied string required. And a scheme split by a raw tab, line feed
or carriage return — `java<TAB>script:…` — matched no scheme, skipped the
allowlist, and resolved by file extension instead; the URL parser strips
exactly those three characters before parsing, so what would have loaded was
never what was validated. Any of the three, anywhere in a string, is now
rejected as malformed, matching the treatment leading and trailing whitespace
already had. A rejected object fails with the existing `invalid-source` reason
and its existing guidance, so a consumer sees the same shape of refusal it
already sees for a rejected string, and `Player.Root` declines to commit the
source exactly as before.

Protocol-relative sources are also normalised, by both paths. Detection already
resolved `//host/clip.mp4` against `https:` in order to parse it; the resolved
source now carries that resolution, so
`detectSource('//cdn.example.com/video.mp4')` emits
`src: 'https://cdn.example.com/video.mp4'` rather than the caller's form — and
so does `{ type: 'hls', src: '//cdn.example.com/master.m3u8' }`, and every entry
in a `video` source's `sources`. Normalising the string alone would have left
the same string-versus-object split this change exists to close. An explicit
source object is therefore returned as a normalised copy rather than the object
passed in; a successful result's `input` is still, referentially, the caller's
own object.

**What a React consumer sees.** `Player.Root` detects its `source` prop through
the same `detectSource`, so both halves reach React. A source that is now
refused makes `Root` decline to commit it and render its unsupported-source
path, where before it committed and handed the URL to a provider. And a
protocol-relative source's committed `src` changes value, which any test or
snapshot asserting on the rendered `<source src>` or media `src` will fail
against.

Both land as `minor`: every package is still at `0.0.0` with `first-prerelease`
unreleased, and under 0.x `minor` is the channel a breaking change travels on.
It is breaking twice over. Sources that were accepted are now refused — the
`blob:` HLS source is the one plausible case that was not already a defect, and
it must move to `type: 'video'`. And a protocol-relative source's emitted `src`
changes value, which any test asserting on it will fail against, and which
pins such a source to `https:` on a page served over `http:` rather than
letting it follow the page.
