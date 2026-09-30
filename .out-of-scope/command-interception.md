# Command interception

Playdeck lets a plugin observe player state and issue commands, but not stand
between a command and the provider. A behaviour plugin built on
`usePlayerState` and `usePlayerActions` sees a command's result the same way
any other caller does, after the provider has already acted on it. There is
no seam where a plugin could inspect, rewrite, or refuse a command before that
happens.

Two cases were raised that need exactly that seam. An ad plugin needs to
substitute its own source for a `play()` before the provider ever attaches to
one. A "confirm before seek" plugin needs to hold a `seekTo()` back until the
viewer confirms, or refuse it outright. Neither is reachable by observation:
by the time a behaviour plugin's effect fires on the resulting state
transition, the command has already run.

## Why this is out of scope

**Observation already covers the cases that do not need interception.** The
behaviour-plugin convention, written up in
`apps/storybook/stories/BehaviourPlugins.mdx` and proven by
`examples/react-behaviour-plugin.tsx`, maps `PlayerController` state
transitions to events through nothing but the two hooks every consumer
already has. That is enough for analytics and for resuming a saved playback
position: both only need to know what happened, not to change whether it
happens. Ads and a seek confirmation are a different shape of request — they
need to change the outcome of a command, not just react to it — and no amount
of extending the observation pattern gets there.

**The seam that would carry interception is not free.** Supporting it means a
command-middleware chain on `PlayerController`, sitting between a caller's
`play()` or `seekTo()` and the provider that would otherwise receive it
unchanged. That is a stable public contract, not an internal detail: every
command signature, every `CommandResult`, and every consumer of
`usePlayerActions` would need to account for a chain that might rewrite,
delay, or refuse what they called — whether or not they ever register a
middleware. Bytes and surface area are paid in core by every consumer,
including the large majority who never intercept anything.

## The maintainer's decision

Observe now, intercept later. The issue stays open, undated, as the place a
future brief starts from — it is not scheduled and nothing here is in
progress.

## Recorded answers, for whoever reopens it

Three design questions were answered ahead of any implementation, so a future
brief does not re-litigate them:

- **Where the chain runs.** On `PlayerController`, not on `Player.Root` and
  not in the React bindings. Playdeck has non-React hosts, and the controller
  is the seam they already share with the React surface — putting the chain
  above it would give React hosts an interception path that other hosts
  cannot use.
- **What a middleware may do.** More than intercept or refuse: a middleware
  may rewrite the source a command carries, with a published origin so a
  later consumer (or another middleware) can tell a command was substituted
  rather than issued as called.
- **How a refusal is published.** Through the existing `refusedCommand` field
  on `PlayerState` — a new `RefusedCommand['reason']` value alongside
  `'not-ready'`, not a second field or a parallel vocabulary.

## What would reopen this

A consumer asking for interception, not the pattern being generalised
speculatively. The concretely named case is ads — tracked as later work, with
no date — and a seek-confirmation plugin would count as a second. Either
starting is what turns the recorded answers above into a brief.

## Prior requests

- [#665](https://github.com/pedrosousa13/playdeck/issues/665) — "Decide
  whether commands can be intercepted by a plugin", raised alongside #664
  (behaviour plugins) and split from it once it became clear observation and
  interception are different seams. The maintainer's answers above are
  recorded on the issue for whenever it is reopened.
