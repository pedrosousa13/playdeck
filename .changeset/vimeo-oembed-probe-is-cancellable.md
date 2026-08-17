---
'@reely/provider-vimeo': patch
---

The Vimeo chromeless-availability probe is now cancellable, and every path that
ends or supersedes an attachment cancels it (#232).

The probe asks Vimeo's public oEmbed record which account tier is behind the
video, because that is the only place the tier is reported — the player SDK
publishes it nowhere. It issued a bare `fetch` with no init object, so it had no
`signal` and nothing held a handle on the request. The 4 second deadline
(`CHROMELESS_PROBE_TIMEOUT_MS`, unchanged) resolved a provisional verdict
_beside_ the request rather than stopping it, and the attachment's start
generation decided which verdict was adopted, not which request kept running. So
`destroy()` cleared the listeners and left the request in flight, and each
`retry()` added a fresh one. Unmounting a React tree is the one action a
consumer has to stop a component talking to a third party, and on this path it
did not work: a player scrolled past, unmounted or retried went on disclosing the
viewer to `vimeo.com` after the consumer's component was gone.

Each probe now runs under its own `AbortController`. The seam gains a `cancel`
alongside its `probe` and `adopt`, and the attachment calls it from its own
teardown — the one thing `destroy` and `retry` both already run, and which a
failed attach runs too. So the request is discarded with the player it was
informing, in `retry`'s case before the replacement request is issued, and a
teardown path added later cancels without having to remember to. The seam also
abandons a request of its own accord if a second probe starts while one is
running, so "one request at a time" holds in the seam rather than in its
caller's ordering. The deadline aborts too, rather than only resolving beside
the request.

What the caller receives is unchanged in every case. An abandoned probe — timed
out, destroyed, or superseded — resolves the same provisional `unknown` /
`provider-check` verdict it resolved before, and resolves it rather than
rejecting: an abort makes the request reject, and that lands on the fallback the
way an offline network or a refused response already did, so no rejection reaches
the page. A superseded probe still never records a verdict. A live probe still
resolves and adopts the tier-derived one.

The opt-in that governs whether a request happens at all is untouched: without
`customControls: true`, or with the provider's own `controls` asked for, there is
no request and the verdict resolves from a constant, so no viewer is disclosed to
Vimeo before anyone has asked for the capability. This change is about when a
request _stops_, which nothing governed before.

`patch`: no export surface moves — `VimeoChromelessAvailability` is an internal
seam type, not part of the package's public entry — and a consumer calling
`createVimeoProvider`, or reaching it through `Player.Root`, sees the same
capability values it saw before. Only the request's lifetime changes.
