# Decomposing the `create*Provider` closures

Each provider package puts effectively its whole implementation inside one
`create*Provider` closure:

| Package            | Closure                 | Lines |
| ------------------ | ----------------------- | ----- |
| `provider-hls`     | `createHlsProvider`     | 783   |
| `provider-vimeo`   | `createVimeoProvider`   | 724   |
| `provider-native`  | `createNativeProvider`  | 627   |
| `provider-youtube` | `createYouTubeProvider` | 574   |

Everything inside shares one lexical scope, so any state is reachable from any
handler and the units inside are not separately testable. Breaking them apart —
by lifecycle seam, one provider per PR — is not planned.

## Why this is out of scope

The cost of the current shape is navigability and test granularity. It is not
correctness: all four adapters pass the `@real` provider suite against the live
SDKs, and the capability contract they implement is covered by unit tests at the
boundary.

Against that, restructuring four working adapters is a large change whose only
guard is a suite that **no longer runs on a schedule** — the scheduled `@real`
workflow was retired because a hosted runner's IP reputation, not our code,
decided whether it passed. `@real` now runs only when someone runs it locally
with `REELY_REAL_PROVIDERS=1`. So the safety net for exactly this kind of
refactor is manual, which raises the price of the change and lowers the odds a
regression is caught.

There is also nothing obvious to extract _to_. The four adapters differ enough
that a shared base class or common lifecycle abstraction would be speculative —
invented to justify the split rather than discovered from the code. A refactor
that has to invent its own target is the kind that leaves the codebase harder to
follow than it found it.

Weighed together: real, ongoing risk against an improvement no consumer sees and
no test asserts.

## What would change this

Concrete friction, not size. If a provider bug takes an unreasonable amount of
time to locate because of the scope sharing, or a behaviour genuinely cannot be
tested without splitting the closure, that is the evidence this decision is
missing. Line count alone is not it — the measurement above was already taken
and deliberately not acted on.

If it is reconsidered, the prerequisites recorded on the original issue still
apply and still make it safe: `@real` green before and after per provider, one
provider per PR, and extraction by lifecycle seam (load / playback / tracks /
teardown) rather than by line count.

## Prior requests

- SIDEPRO-135 — "Provider adapters: the create*Provider closures are 574-783
  lines each" (2026-07-29). Recorded from a security and simplification review
  that found the measurement and deliberately did not act on it; the issue
  itself named `wontfix` a legitimate outcome.
