---
'@playdeck/provider-vimeo': minor
---

The Vimeo provider now reports a `suppressSeoMetadata` request that did not
take, as a non-fatal `configuration` Notice on `PlayerState.error` (#333).

`suppressSeoMetadata` is a privacy control: it stops the `@vimeo/player` SDK
answering a recognised embed's readiness handshake with `window.location.href`,
path and query included. It works by setting a `window` guard the SDK reads
while its module evaluates, and the module is imported once per page — so only
the attach that performs the import decides it. A second player asking for
suppression after a first one loaded without it got nothing, and was told
nothing, while every other consumer option that degrades publishes a Notice
(#235, #318). This one degraded to the **unsafe** default in silence.

**The ordering is not fixed, because it cannot be.** The SDK reads the guard as
it evaluates; a request arriving later is too late by construction. What lands
is the missing signal, and nothing about when suppression applies has changed.

The check is by outcome, not by mechanism: suppression was asked for, and the
SDK's module evaluation did not suppress. That covers both ways a request goes
nowhere — a module already imported, and a page that set the guard itself,
`false` included — with one condition, and it stays quiet when somebody else
suppressed first, because then the request was honoured.

The outcome cannot be read off `window` afterwards, which is the subtlety the
whole change turns on. On the branch that installs the listener the SDK also
writes the guard `true` (`dist/player.js:999`), so once the module has
evaluated every case is truthy — suppressed and sending alike. The answer is
therefore recorded in the importing call, from what the guard held in the
instant before the import, and a new `isSeoMetadataSuppressed` predicate in the
loader reports that record. It answers `undefined` until a load has resolved, so
"no evaluation has decided" is never reported as a failure. The vendor global's
name stays in the one module that already owns it, and `loadVimeoSdk` keeps its
signature.

Vimeo now has two Notices, and the controller keeps one per attach — the first
emitted wins and the rest are dropped with the provider (#332, #368). This one
is emitted at the SDK load, which every path to the chromeless probe's Notice
runs through, so the privacy report beats the presentational one by
construction rather than by convention. The placement is commented as
load-bearing and pinned by a test that fails if the emit moves past the probe.

`e2e/vimeo-seo-metadata.spec.ts` covers it against the real SDK, which is the
only place the vendor's own write to the guard is in play, and the loader's
test doubles now perform that write the way module evaluation does.

It lands as `minor` rather than `patch` for the reason #319 and #332 did: no
API changed, but what a released package reports did, and a behaviour change
should not arrive as a patch.
