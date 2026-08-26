---
'@playdeck/core': patch
'@playdeck/provider-hls': patch
'@playdeck/provider-native': patch
'@playdeck/provider-vimeo': patch
'@playdeck/provider-wistia': patch
'@playdeck/provider-youtube': patch
'@playdeck/react': patch
---

Every package now ships its own `CHANGELOG.md` (#460). The file existed in the
repository all along, but `files` named `dist` and nothing else, and a changelog
is not one of the names npm includes regardless — unlike the README, the LICENSE
and the manifest. So an installed `node_modules/@playdeck/react` carried no
account of what had changed, and a consumer upgrading between two published
versions had nowhere local to read one.

This is packaging only. No code, no types and no rendered output changed, and
`dist` is byte-identical.

**It is not free, and the number belongs here rather than in a commit message.**
Measured on the 0.2.0 tarballs, packed: `@playdeck/react` 123,391 → 170,286
bytes (+38%), `@playdeck/core` 69,941 → 95,793 (+37%), and the seven together
408,465 → 549,301 (+34%). None of it is code — a changelog is never imported, so
it reaches no bundle and no bundle budget moved — but it is bytes in every
install, and it grows with every release. If that becomes the wrong trade the
next step is a truncated or per-major changelog, not a return to shipping none.

Alongside it, and outside the packages: a published version now has a git tag on
the remote. One per package, named `@playdeck/core@0.2.0`, because these
packages version independently and are not all at the same version. The tags are
pushed before the publish rather than after it, so a release that fails halfway
still leaves something to diff against. Versions published before this change
are deliberately not backfilled.
