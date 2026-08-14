---
'@reely/core': minor
'@reely/provider-wistia': minor
'@reely/provider-youtube': minor
'@reely/provider-vimeo': minor
---

Each provider factory now validates the id it is handed before it does
anything else with it, rather than trusting it as far as the vendor (#222).
`createWistiaProvider`, `createYouTubeProvider` and `createVimeoProvider` are
each package's own published entry point, and `Player.Root` is only one
caller of it. `detectSource`'s validation protected every source routed
through `Root`, but a consumer calling a factory directly bypassed it
entirely. A media id, video id or privacy hash that would never have survived
`detectSource` — a script-injection payload, a path-traversal segment, a
query string appended to an id — reached the factory unchecked and was
carried straight into a DOM attribute, an iframe src, or an SDK call.

The fix is the same shape in all three packages: the id (and, for Vimeo, the
hash, when one is present) is checked with a predicate now exported from
`@reely/core` — `isWistiaMediaId`, `isYouTubeVideoId`, `isVimeoVideoId`,
`isVimeoHash` — before the factory builds anything. A value that fails is
never carried to the vendor at all; the factory returns a rejected adapter
instead, whose every method is a no-op and whose state immediately reports a
`category: 'source', fatal: true, recoverable: true` error to every
subscriber, present or late-arriving. `attach`, `load` and `retry` do nothing,
`destroy` is idempotent, and every command resolves `{ ok: false, reason:
'not-ready' }` rather than hanging or throwing.

**What a consumer sees.** A valid id: byte-identical behaviour, unaffected by
the added check. An invalid id passed directly to a factory: previously an
unguarded pass-through to the vendor — a request, a DOM write, an SDK call,
whatever consulting the vendor with that value would do; now a same-shaped
`source` error, delivered synchronously through the normal state-subscription
path, with no vendor ever contacted. A consumer going through `Player.Root`
sees no change: `detectSource` already turned away the same ids before a
factory was ever called.

Also, defence in depth beyond the new checks: the Vimeo embed URL is now
built with `url.pathname` and `encodeURIComponent(source.videoId)` rather
than interpolating the id into the URL string directly, so a rejected id that
somehow still reached the builder could not break out of the path segment it
is written into.

Both land as `minor`: every package is still at `0.0.0` with
`first-prerelease` unreleased, and under 0.x `minor` is the channel any
change — including this purely additive one — travels on.
