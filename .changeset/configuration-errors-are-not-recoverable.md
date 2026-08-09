---
'@reely/core': minor
'@reely/react': minor
---

Every configuration error now reports `recoverable: false`, and both
`Player.ActivationButton` and `Player.ErrorDisplay` decide what to offer from
that one flag (#198). The two used to disagree over the same error:
`ErrorDisplay` offered a retry, because a configuration error stamped itself
recoverable, while `ActivationButton` refused one, because it re-read the
error's category. A composition rendering both offered a retry and refused it at
once.

Retrying a configuration error cannot succeed by any path. The three published
by the activation layer — interaction loading with autoplay, viewport loading
without `Player.Viewport`, an invalid viewport margin or threshold — are all
published before a provider exists, so a retry returns its not-ready result and
leaves the state untouched. The muted-autoplay conflict published by core does
reach a provider, and the conflict flag survives it: only reconfiguring autoplay
clears that one. The remedy for every one of them is a change the consumer
makes.

So `ErrorDisplay` renders no retry action for one, and hands render-prop
children a `null` retry, which is the capability-aware behaviour it already
applied to every other non-recoverable error. `ActivationButton` refuses
activation and reports itself `aria-disabled` when the current error is not
recoverable, whatever its category, and offers activation when it is — so a
non-fatal notice that says nothing about retrying can no longer disable it. Its
accessible name follows: `Retry loading video` only where a retry is on offer,
`Play video` otherwise, with the child text (`Retry` / `Play`) tracking it.
Recoverable values on every other category are unchanged.

**Also a widening, beyond the configuration category.** `ActivationButton` and
the `activateFromInteraction` behind it now refuse _any_ error the state reports
as not recoverable, where before they refused only the `configuration` category.
A provider-supplied `recoverable: false` error reaching the activation error
state — a failed retry that concluded there is nothing left to try, say —
previously rendered an operable `Retry loading video` whose press re-ran an
activation that could not succeed. It is now `aria-disabled` and reads
`Play video`, matching the retry `ErrorDisplay` already withheld for it. That is
the point of deciding retryability once, but it does change what these controls
do for errors no configuration factory produces.

Both land as `minor`: every package is still at `0.0.0` with `first-prerelease`
not yet released, and under 0.x `minor` is the channel a breaking change travels
on. It is breaking twice over — the published value of the public
`PlayerState.error.recoverable` field flips for an entire category, which any
consumer branching on it sees, and the retry action and the `Retry loading
video` accessible name disappear from every configuration error, which a test
suite asserting on either will fail against.
