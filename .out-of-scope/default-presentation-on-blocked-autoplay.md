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
first frame with no cover, no playback and no gesture that asked for either —
was a real defect, and it is fixed. The poster now stays up because the frame
writer defers on either of two counts: while autoplay is configured and has not
played, and while a play command issued against the attached media has not been
confirmed — which is what covers a refused `play()` where no autoplay was
configured at all (#244). Once the cover
survives the refusal, the viewer sees exactly what they saw before playback was
attempted, which is the state the consumer designed. Adding a second behaviour
on top would be solving a problem that no longer exists.

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

- The poster stays visible through the refusal, on every source type.
- `autoplay` reaches `'blocked'` for a refusal and `'failed'` for other errors,
  distinguishable in player state.
- `PlayButton` retries from a user-origin click and works after a refusal.

That is enough to build any of the presentations this was asking for, in the
consumer's own components, without playdeck choosing among them.

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
