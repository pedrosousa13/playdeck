---
'@reely/core': minor
'@reely/provider-native': patch
'@reely/provider-hls': patch
'@reely/provider-vimeo': patch
'@reely/provider-wistia': patch
'@reely/provider-youtube': patch
---

Every provider fan-out now isolates a throwing subscriber, and `@reely/core`
exports the helper that does it (#233).

An adapter's `subscribe` accepts any number of subscribers and promises each of
them every notification, but each provider published with a bare `Set.forEach`.
That loop stops at the first throw, so one broken listener took two things with
it. Every listener registered _behind_ the thrower silently missed that
notification and resynced only on the next unrelated one — a control that
subscribed late rendered exactly one transition stale, which is the defect #95
measured at the controller. And the throw escaped back into whatever called the
emit: a vendor SDK's own event dispatch, or the adapter's start path, where the
load-error mapping reported a consumer's rendering bug to the viewer as "The
Vimeo player could not load". A subscriber defect was misattributed to the
provider.

The controller had the answer already — `notifySafely`, added for #95 — but it
was private to `@reely/core` and applied only at the controller's own four
fan-outs. Through `Player.Root` the controller is the single subscriber to each
adapter, so the composed path was bounded by subscriber count rather than by
design; a consumer subscribing to an adapter directly, which the public
`subscribe` surface invites, had no such protection.

Each provider's state, dimension and text-track cue fan-outs now route through
that helper. A listener that throws no longer stops the ones behind it, and the
emitting call completes: the state transition lands, the SDK's dispatch loop
runs on, and the start path reaches `ready` instead of reporting a load failure.
The error is isolated rather than silenced — it is still rethrown on a fresh
task, so it reaches the page's uncaught-error handling the way a listener
throwing at top level would. Swallowing it outright is what would have hidden
the media-session defect that found this bug in the first place.

Nothing about `subscribe`/unsubscribe, listener signatures, or the patches and
events an adapter publishes changes. A listener that does not throw sees exactly
what it saw before.

`minor` for `@reely/core`: `notifySafely` joins the public entry, because a
provider package cannot reach a private helper and copying the implementation
into five packages is how five copies drift. It also takes its arguments
variadically now, so a `(patch, event)` state listener is called through it
without a wrapper; the controller's own call sites are unchanged in behaviour.
`patch` for the five providers: no export surface moves and no published value
changes — only what happens when a consumer's own listener throws.
