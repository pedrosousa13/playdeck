# An autoplay claim on the landing page

`/` makes no claim about autoplay. It carries no autoplay switch, no autoplay
readout in the provider truth table, and no prose stating the capability either
way. This is a decision about that page, not about the library: playdeck's
autoplay support is real, documented in `CONTEXT.md`'s vocabulary and pinned by
tests, and the provider pages and README are where a reader learns about it.

## Why this is out of scope

**The demonstration cannot happen on that page.** `/` mounts its player with
`loading="interaction"`, so playback can only begin from a user gesture — and
after a gesture, the browser permits the audible attempt. The refusal and the
muted retry are the whole of what an autoplay feature has to show, and neither
can ever occur there. An autoplay switch was specced as one of three switch
groups, built, and cut for exactly this: what was left was a control whose only
effect was to add a prop to the printed composition, which is a knob arguing by
printing itself. `apps/site/DESIGN.md` records the cut.

**A live readout would contradict the page's headline claim.** Determining
autoplay availability for real means attempting it, and an attempt costs a media
fetch. `/`'s central argument is that it fetches nothing before a click.
`ProviderTruth.astro` records this as its reason for carrying no autoplay row,
and it is the stronger of the two arguments, because it rules out the readout
even on a page that did not use `loading="interaction"`.

**Prose alone would be an ungated claim.** The remaining option is a hand-written
sentence. Everything else `/` asserts is either generated from a checked source —
the truth table is derived from `docs/provider-setup.md` at build time — or is
demonstrated by the instrument itself. A hand-written capability sentence is the
one shape the page has consistently refused: nothing would notice when it stopped
being true, on a page whose argument is that this library does not claim
capabilities it lacks.

## What playdeck does provide

- Full autoplay support, with `AutoplayMode` covering `false`, `'muted'`,
  `'audible'` and `'audible-then-muted'`, and the refusal path pinned by unit,
  component and e2e tests.
- The vocabulary — play gate, autoplay attempt, recovered autoplay, suppressed
  autoplay — defined in `CONTEXT.md`.
- Documentation on the provider pages and in the package READMEs, where a reader
  looking for capability detail actually goes.

## What would reopen this

A version of `/` that no longer mounts with `loading="interaction"` **and** a way
to state the capability that is read off a gated source rather than hand-written.
Both halves are needed: the first makes a demonstration possible, the second is
what the page requires of any claim it makes. A request for autoplay prose on its
own does not reopen it.

Note that this file is about a claim *on the landing page*. It is not about the
library's behaviour when a browser refuses autoplay — that is a separate decline,
recorded in `default-presentation-on-blocked-autoplay.md`.

## Prior requests

- [#550](https://github.com/pedrosousa13/playdeck/issues/550) — "State the
  autoplay capability on /, from a source that documents it." Inherited from
  [#542](https://github.com/pedrosousa13/playdeck/issues/542) as an unwritten
  "autoplay prose fallback", and filed before the autoplay switch was cut. It
  asked for a fallback to a claim that no longer exists.
