# A default presentation when autoplay is refused

When a browser refuses autoplay, playdeck keeps the poster over the video and
changes nothing else. It does not reveal controls, does not render a play
overlay, and does not substitute any other presentation of its own. The player
reaches `autoplay: 'blocked'`, `playback` stays where it was, and what the
viewer sees is whatever the consumer composed.

`PlayButton` still works and still retries through the refusal. A consumer who
wants an affordance on screen mounts one; a consumer who wants to react to the
refusal subscribes to player state. What playdeck will not do is decide for them.

## Why this is out of scope

A refused autoplay is the case where a default is most tempting and least
defensible. Three things weigh against it.

**The cover is already the answer.** The failure this was raised for — a paused
first frame with no cover and no playback — was a real defect, and it is fixed.
The poster now stays up because the frame writer defers on either of two counts:
while autoplay is configured and has not played, and while a play command issued
against the attached media has not been confirmed. Once the cover survives the
refusal, the viewer sees exactly what they saw before playback was attempted,
which is the state the consumer designed. Adding a second behaviour on top would
be solving a problem that no longer exists.

The second count is deliberate, and it is worth saying why, because the obvious
objection is that it should not exist. This file was first written about a
refused _autoplay_, where nothing asked for playback and keeping the cover is
plainly right. A programmatic `play()` — or a `PlayButton` press — is the
opposite: a gesture that did ask, which is an argument for letting the frame
show (#244). It loses on two counts. An uncovered paused frame communicates
nothing about the refusal either, so showing it buys none of the feedback the
argument wants. And it would give one visual defect two behaviours, split by
which API happened to ask for playback, which is harder to explain than either
uniform answer. So the rule is by outcome, not by trigger: **playback was
requested and did not start, so the cover stays**, whoever requested it.

**Revealing controls overrides composition in the worst possible moment.**
Playdeck's controls are composed, not configured — where they sit, whether they
exist, and what they contain are the consumer's decisions, made in their own
layout. A library that materialises its own control row on refusal is making a
layout decision inside someone else's design, in a case they cannot reproduce on
demand and probably never tested. The blast radius is widest exactly where the
consumer's ability to see it coming is narrowest.

**"Blocked" is not one situation.** A muted autoplay refused under iOS Low Power
Mode, an audible autoplay refused by a permissions policy, and an autoplay
refused because the tab was never foregrounded are the same state and different
products. A default presentation has to pick one interpretation and apply it to
all three. The consumer knows which one their application is in; playdeck does not.

## What playdeck does provide

- The poster stays visible through the refusal, on every source type, whether a
  refused autoplay or a refused play command left playback unstarted.
- `autoplay` reaches `'blocked'` for a refusal and `'failed'` for other errors,
  distinguishable in player state.
- `PlayerState.refusedPlay` carries the last play command that was refused, with
  the origin that issued it, for a `PlayButton` press as much as for a
  programmatic `play()`.
- `PlayButton` retries from a user-origin click and works after a refusal.

That is enough to build any of the presentations this was asking for, in the
consumer's own components, without playdeck choosing among them — for a refused
autoplay and for a refused play command alike.

The second of those was not always true, and this file said so. A refusal used to
be reported to the caller of `play()` as a `CommandResult` and to nobody else,
and `PlayButton` discards the result it gets, so a consumer whose viewer pressed
the button could not subscribe to "the press was refused" the way they could
subscribe to `autoplay: 'blocked'`. That was a gap in the primitives by this
file's own reopening test below rather than a request for a default, it was
raised as one, and #361 closed it by publishing the refusal. Nothing about the
decline changed: the primitive exists, and playdeck still presents nothing with
it.

## What would reopen this

Evidence that the composed path is not actually sufficient — a presentation a
consumer cannot build from the state and primitives above. That would be a gap
in the primitives, and it should be raised as that rather than as a request for
a default.

## Prior requests

- [#240](https://github.com/pedrosousa13/playdeck/issues/240) — Nothing in the
  React surface reacts to `autoplay: 'blocked'`, so a client that refuses
  playback presents no fallback. The proven defect in it was split out as
  [#242](https://github.com/pedrosousa13/playdeck/issues/242) and fixed; the
  remaining design half is what this file records as declined.
- [#244](https://github.com/pedrosousa13/playdeck/issues/244) — the same visual
  defect reached by a refused programmatic `play()` under `autoplay={false}`,
  where #242's gate is inert. Fixed rather than declined: the decline above is
  about presenting _something extra_ on a refusal, not about whether the cover
  survives one. Working it is what established that the rule is by outcome
  rather than by trigger, and what surfaced the primitives gap noted above.
- [#361](https://github.com/pedrosousa13/playdeck/issues/361) — that gap,
  raised and closed as a gap: a refused play command reached player state
  nowhere, so `PlayerState` gained `refusedPlay`. The reopening test above is
  what it was measured against, and it did not reopen this file — it supplied
  the primitive the decline assumes. This file still declines to present it.
