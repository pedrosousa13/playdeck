# Comments

Which comment content belongs in source, and which belongs in the issue tracker.

**This is not a case for writing fewer comments.** The dense rationale in this
repo is an asset and most of it ages perfectly — the header of `scripts/audit.mjs`
runs to dozens of lines explaining why that gate measures reachability rather than
severity, and that reasoning has outlived several rewrites of the code beneath it.
Nothing here asks for shorter comments, thinner comments, or fewer of them. It asks
for one distinction to be made deliberately as you write.

The two kinds are not two kinds of comment. They are two kinds of sentence, and
they mix freely inside one block — see the worked example at the end, where three
lines rotted inside a header that is otherwise entirely durable.

## Two kinds of content, and only one of them rots

**Durable rationale** — why a decision was made. It describes the reasoning behind
code that exists, so it stays true for as long as the code does. Worth every line:

```
// Focus, never click: a click on a range input sets its value from where the
// pointer landed, and the gesture would start from somewhere nobody chose.
```

(`e2e/rapid-slider-presses.spec.ts`, inside `activateForVolume`, above the
`focus()` call it justifies.) It explains a
choice that would otherwise look arbitrary, and there is no future in which it
becomes false while the code it sits on is unchanged. The `scripts/audit.mjs`
header is the same thing at length: "Severity is a label, not the axis" and the
failure modes underneath it are the design of that gate, not a report on the
state of the world.

That header is also the sharpest warning available that the distinction is per
sentence and not per comment. It has counted the ways the gate can fail since it
was written, and the count is the one part of it that has ever been wrong. It
opened at "One thing besides an advisory fails it, and only one", became "Two
things" when a second was added, and then went stale: #373 added a third cause
and left the count reading two, where it stayed across three commits until #374
added a fourth and corrected it to "Four things". The reasoning underneath was
true throughout. A count of the things you are about to describe is an assertion
about the current state of the world sitting in the middle of prose that is not,
and it is invisible to review precisely because everything around it is sound.

**Time-bound claims** — assertions about the current state of the world. What is
suspected, what is waiting on what, what does or does not happen on some machine,
what a test does or does not prove. These go stale silently, because a comment
cannot fail a test. Six were found and corrected across recent sessions; none broke
anything, none failed a test, and no reviewer had caught any of them:

| the claim                                                                                | the reality                                                                        |
| ---------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `// a max blip to 0 ... is the remaining suspect`                                        | ruled out by the traces                                                            |
| `// the tolerance is kept for whoever re-enables this on WebKit under #277`              | nobody will; the exclusion is permanent                                            |
| `// the issue it is waiting on`                                                          | it was not waiting on anything                                                     |
| `**This is the fix for #277 and not a demonstration of it.**`                            | it was not, and being an unreleased changeset it would have shipped in a changelog |
| a guard's comment claiming it "fails every run instead of flaking once in a few hundred" | the guard was measured to be inert — it passed both regressions it named (#392)    |
| a doc line claiming a referrer policy was "verified"                                     | the tests observe only the declaration; nothing observes a `Referer` header (#394) |

A confident false comment is worse than no comment: it sends the next reader down
a dead end. The `max` blip line did exactly that — a probe was built around a
suspect the file presented as live, which the evidence had already eliminated.

The last two are the reason this is a convention and not a script. Both were
written _after_ their author had read a warning about this exact failure, by an
author trying to avoid it, and both were caught only by review. A checker
resolving issue references would have passed all six.

## The tell: an open issue number is an expiry date

**A comment naming an open issue number is a claim with an expiry date.** Durable
rationale rarely needs one — the range-input comment above names nothing, because
nothing about it is pending. A reference to an issue that is still open says "this
is how things stand while that work is outstanding", and nothing revisits the
comment when the work lands.

This is close to mechanical, and it is the single most useful line of this
convention: when you find yourself typing `#` and a number, stop and ask whether
what you are writing is rationale or narrative. A reference to a _closed_ issue is
usually fine and usually history — "#271, driven through #67's composed example" is
provenance, not a pending claim.

## Investigation narrative goes in the tracker

Keep investigation narrative — suspects, hypotheses, what has been ruled out, what
is being waited on — in the issue tracker, and write into source only the settled
conclusion, once it exists.

The tracker is the right home because people re-read it and it updates as the
investigation moves: a comment on the issue is read in the order it was written,
alongside everything that came after it, and it is the thing an author returns to
when the picture changes. Source is not. Nobody revisits a file's header when the
investigation that produced it ends, which is exactly why "the remaining suspect"
and "the issue it is waiting on" survived — the investigations moved and the source
did not.

So: the reasoning that explains the code you are landing goes in the comment. The
reasoning that explains what you have not worked out yet goes on the issue.

## Two classes that need extra care

**A comment naming a local-environment limitation is the highest-risk class here.**
It encodes a fact about one machine at one moment, and this repo's environments
differ deliberately: CI installs the codec set, the local install does not. Such a
claim can be false without anything changing on your machine at all — someone else
changes what the code asks the environment for. Prefer describing what the code
does about the limitation over asserting what the environment cannot do.

**A comment citing a measured pass/fail rate is among the most useful in this
codebase and the most perishable.** These are worth writing — a rate is often the
only honest description of a flake. Write one so a reader can re-measure it: carry
what was measured, on what, and when. `e2e/reference.spec.ts`'s
`skipWithoutWebKitBuffered` is close to the model:

```
// the MP4 to the WebM #384 put behind it. For that clip WebKit populates
// `el.buffered` on roughly HALF of loads — the first test below, run 8 times
// sequentially on an IDLE machine, passed 4 and failed 4, while chromium went
// 6/6 and firefox 6/6.
```

It names the engine, the fixture, the machine state, the count and what the other
two engines did, so a reader who doubts it can reproduce the measurement and knows
what a contradicting result would look like. What it does not carry is a date, and
a bare "N of M runs" with neither environment nor date is a number nobody can check
or refute.

## A worked example

This one is in the tree on purpose. Above `HOLD_MS` in `e2e/reference.spec.ts`, a
long and otherwise excellent block diagnoses a chromium flake from measured
timings, then reaches a webkit flake of the same shape and said:

```
// Its mechanism is NOT measured here — WebKit does not run on the maintainer's
// machine (it fails at `played()` on clean main), so that one was never
// reproduced.
```

Everything around it is durable rationale — why the controls are treated as
controlled inputs, why one `toHaveValue` sample is not enough, why `HOLD_MS` is
wall clock — and none of it turned on the environment. The three lines above were
true when written and stopped being: #384 gave the reference composition a WebM
source behind the MP4, so local WebKit falls through to `tracer.webm` rather than
failing source selection, which is what the file's own `#401` block now describes
at length. Nothing failed when the claim stopped being true, and the sentence that
made it was never re-read.

The failure is not the length of the block or the effort in it. It is that one
sentence of environment reporting was written into a file that reports on a design.
It now reads:

```
// Its mechanism is NOT measured here — that flake was never reproduced, so the
// shape above is read across from the chromium diagnosis rather than measured
// on WebKit.
```

which says what the surrounding block needs a reader to know — that this half is
inference, not measurement — and asserts nothing about any machine.

## Not covered here

Stale `file:line` citations in documentation are the same failure mechanised
differently, and they are #317's, along with the evidence collected for them. This
document is about prose that asserts a mechanism the evidence does not establish.
