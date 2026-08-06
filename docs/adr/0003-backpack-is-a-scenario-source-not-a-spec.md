# Backpack and react-player are scenario sources, not a specification

The `backpack-parity` branch's `BackpackVideo` wrapper reimplements a slice of
EF Backpack's `VideoPlayer` prop API on Reely primitives, tracking Backpack
story against Reely story in a parity matrix. The shape of that work invites a
reading it should not have: that Backpack's behaviour is the specification and
a difference is a defect.

It is the other way round. Backpack's stories are valuable because they are a
**catalogue of scenarios** a real consumer already depends on — a cover image
before playback, a video that pauses when scrolled past, three buttons driving
one player. Covering those scenarios is what makes "replace react-player with
Reely" a checkable claim rather than an aspiration. That is the whole reason the
matrix exists.

Backpack's _implementation_ carries no such authority. It is one team's answer,
built on react-player, and parts of it are workarounds for react-player rather
than decisions anyone would make freely. So:

**A behaviour copied from Backpack or react-player must survive review on its
own merits. "Backpack does it this way" is not a justification.** Where their
answer is wrong, Reely does it properly and records the divergence with its
reason. Where their answer is right, Reely follows it — because it is right, not
because it is theirs.

## Why this needed writing down

Because the default pull is the other way, and it already cost something. During
SIDEPRO-200 a review found that pausing by hand through the visible controls
left a pending auto-resume armed, so scrolling back restarted a video against
the viewer's last instruction. The finding was set aside on the grounds that
Backpack behaved the same way. It was fixed only after the maintainer pushed
back — and the fix is better than Backpack's, because it disarms on any playback
transition the pause logic did not request, rather than relying on a handler
being wired to every affordance that can pause.

Worth noting what the follow-up audit then found: Backpack does **not** have that
bug, and cannot reach it — its `onPlay` handler routes through `start()`, which
clears the same flag. The bug was introduced by porting the state machine
without that clearing path. So the "parity" argument was not merely a weak
justification for a real bug; it was factually wrong about the thing it
deferred to. Deference invites that error, because it stops the reader checking.

## What follows from it

- **Divergences are documented, not hidden.** The `backpack-parity` branch's
  parity matrix carries a "Deliberate divergences" section: what they do, why
  it is wrong, what Reely does instead. It also lists the places Reely is
  currently _worse_, which is the same discipline pointed inward — a section
  that only ever flattered Reely would not be worth reading.
- **Citations stay, as provenance.** A `file:line` into the Backpack checkout is
  how a reader finds the source scenario or the origin of a prop name. It is not
  an argument. Comments that used it as one were rewritten.
- **Prop names remain Backpack's.** The wrapper exists so a Backpack consumer's
  props keep working, so `pauseOnOutOfViewport`, `placeholderImageSrc` and the
  rest keep their names even where a name is poor. The API surface is a
  compatibility obligation; the behaviour behind it is not.
- **Claims about their code get verified before they are written down.** Three of
  eight assertions in the first pass at the divergences list were wrong, and two
  had already reached a code comment and a merged PR description. An audit
  against the source caught them. Anything asserted about Backpack's behaviour
  needs the same treatment — read it, quote it, cite the line.

## Scope

This governs the compat wrapper and its stories. It says nothing about Reely's
own primitives, whose contract is `CONTEXT.md` and the ADRs before this one —
the wrapper is a consumer of those primitives like any other, and gets no
license to reach behind them because Backpack did something unusual.
