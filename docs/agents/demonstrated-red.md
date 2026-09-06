# Demonstrated red

An assertion does not count until it has been shown failing against the
unfixed code. This is not a claim that the discipline is a good idea — it is
a report of what happens without it: four assertions that could not fail
shipped across two independently written and reviewed plans, and review
caught none of them.

## What review does not catch

Review reads what an assertion means. It does not run it. All four of these
sat in plans that had been reviewed and approved before anyone ran them
against code that did not yet have the fix. #608 records all four, and is
where to go for the fuller account of each:

| Where                 | The criterion                                           | Why it could not fail                                                                                                                                                             |
| --------------------- | ------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| #541 (landed in #593) | the seek thumb sits on its track                        | scanned horizontally with `centreRow`, while the drift is vertical; the thumb ring is 16px tall, so every row inside it read the same colour whether or not the input had drifted |
| #594 task 5           | the skin fieldset is hidden below 48rem                 | asserted immediately after `goto`, before the `client:only` island hydrated — the element did not exist yet, so `toBeHidden()` passed at once (#608 records 290ms)                |
| #594 task 9           | the changed-line mark fades                             | `getComputedStyle(el, '::before').opacity` returns `"1"` for an element with no `::before` rule at all, so the poll read true before the feature existed                          |
| #594 task 14          | the control bar shows all ten controls under both skins | unsatisfiable on either bench source — the controls are capability-gated, and no one source available to the bench satisfied every gate at once                                   |

Two of these were caught only because an implementer ran the check
against the unwritten feature and noticed it passed anyway. The other two
were caught by an audit of the plan before implementation started. In no
case did the reviewer who approved the plan notice, because approving a plan
means agreeing that the assertion, if it passed, would mean the right thing —
and every one of these did mean the right thing. What none of them did was
fail on a codebase that did not do it.

## The rule

A new assertion is not done when it is written, and not done when it passes.
It is done when it has been run against the code as it stood before the fix,
has failed, and the failure has been recorded somewhere a reader can check:
the PR body, the commit message, or a comment beside the test. "I ran it and
it was red" is a claim about a run nobody else witnessed. The numbers are the
run:

> Red: with only the guard reverted, both cases time out on chromium
> (playhead drifts from 0, `refusedCommand` null).

(#640's PR body, for `e2e/archetype-resume.spec.ts`.) Or:

> Red: the narrow no-script test on the unfixed header found zero links in
> the `Site` landmark.

(#641's PR body, for `e2e/site-nav.spec.ts`.) Both name what was reverted or
absent, what was run, and what came back — a reader who doubts either can
reproduce the run and knows what a contradicting result would look like. "It
failed as expected" would have told them nothing.

## The fallback: when the code cannot be un-written

Sometimes there is no unfixed state to run against — the change is additive,
or reverting it would take the repo somewhere nobody wants to commit from.
The fallback is not to skip the red, and not to reason about it in the
abstract. It is to make a small, deliberate mutation that the assertion is
supposed to catch, run the assertion against that mutation, record what came
back, and say in the PR what the substitute was. This has already shipped
successfully more than once:

> Confirmed both fail with the expected diff when the docked grid rule is
> reverted to a single row, and pass once restored.

(a commit landing #594's grid-shape assertions in `e2e/site-bench.spec.ts` —
the mutation was reverting one CSS rule, named as such.) And, from #555's
activation-fill fix, which landed in the same PR as #593's plan:

> Falsified rather than assumed: with the flat reset in place the themed
> activation computes `rgba(0, 0, 0, 0)` where the theme asks for
> `rgba(0, 0, 0, 0.72)`.

Both name the substitute — one rule reverted, one style flattened — rather
than describing the fallback in general terms and leaving the reader to
trust that it was done. "Recolour a token, revert one rule, delete one key"
is the shape of a substitute mutation, not a menu to pick from; the point is
that whatever stands in for the unwritten feature is named and its output is
recorded exactly as a real red run's would be.

## Three shapes that read a default as a result

The four assertions above are not four unrelated mistakes. Three of them
share a structure worth watching for on sight: each reads a value that a
codebase produces by default, before anyone builds the feature, and that
default happens to equal what passing looks like.

- **A computed-style read on a pseudo-element that may not exist.**
  `getComputedStyle` never fails for a missing `::before` — it returns the
  browser's defaults, and `opacity` defaults to `"1"`. An assertion built
  around "opacity moves toward 0" passes immediately if there is no rule at
  all, because `1` is where a real fade also starts.
- **An assertion made before a `client:only` island hydrates.** The element
  the assertion is about is not on the page yet. `toBeHidden()` and similar
  negative assertions pass for an element that does not exist for exactly
  the same reason they would pass for one that exists and is hidden, so the
  test cannot tell "correctly hidden" from "not there yet."
- **A criterion whose subject is capability-gated.** "All ten controls
  appear" is unfalsifiable the moment some controls are conditionally
  rendered and no available source satisfies every condition at once — the
  assertion was never going to see all ten, fixed or not, so its outcome
  carries no information about the fix.

Each of these returns the same value on the day the feature ships and on the
day it does not exist. That is the tell: **if an assertion would read the
same whether or not the feature is there, running it after the fix proves
nothing — you have to have watched it read differently before the fix, or
you don't know which case you're in.**

## What this is not

This is not a proposal to detect any of this automatically. Whether an
assertion can fail is not decidable in general — it would require reasoning
about what the codebase does not yet do, which is exactly the thing the
assertion exists to check. A lint rule that tried to approximate it would
flag plenty of assertions that are perfectly sound and miss the shapes above
that don't pattern-match, producing noise until it was ignored. The discipline
is cheaper than the detector: run the thing before the fix exists, and write
down what it did.
