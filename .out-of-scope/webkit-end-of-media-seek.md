# Seeking to exactly the duration, on WebKit

Playdeck does not assert **that a seek to exactly `duration` arrives** on WebKit. The
one e2e test that cannot ask for anything else — the reference composition's
`the seek slider stays operable by keyboard in both directions`, whose `End` press
necessarily targets the control's `max` — runs on Chromium and Firefox and is excluded
from WebKit permanently. This is not a library defect and not a gap waiting to be
filled; it is a property of the engine and the fixture, and it was measured rather
than assumed.

## Why this is out of scope

The write is not dropped. The **seek that follows it** is what fails, and the two are
separable because they were separated.

A CI measurement of 50 unretried WebKit runs, made 2026-08-25
(`--repeat-each=25 --retries=0`, the configured `retries: 2` being what reports this
defect's rate as zero), established:

- **The write always takes.** On the pointer test, a reading taken inside the same
  `evaluate` one statement after `el.currentTime = 1` — where no task, no microtask
  and no media event can have run in between — read back exactly `1` on **25 of 25**
  runs, passing and failing alike, on a source whose `duration` and `seekable` window
  had both reached `1.000000`.
- **The seek resolves at 0.** Perfect correlation over all 50 runs: passing runs land
  the seek at `1.000000`, failing runs land it at `0.000000`. The element's own events
  record the whole of it — `seeking` at `ct=1.000000`, then `timeupdate` and `seeked`
  at `ct=0.000000` a few milliseconds behind it.
- **The rate is roughly a third.** The pointer test failed **9 of 25** (36%), the
  keyboard test **7 of 25** (28%).
- **No JavaScript writes 0.** A `currentTime` accessor trap, installed before the
  story's own script ran and capturing a stack for every write, recorded exactly one
  write on a failing pointer run: the test's own, of `1.000000`, taking. Nothing in
  the library, the React bindings or the story wrote the playhead back.
- **The keyboard test is the same defect, not a second one.** On its failing runs the
  trap recorded the library's write from the `End` press setting `1.000000` and taking
  — `provider-native/src/playback.ts` through `core/src/player-controller.ts` on the
  captured stack — and the test still read `0`.

So the library issues the seek the press asked for, the element accepts it, and the
engine parks the playhead at the start of the clip instead of the end. There is
nothing above the engine left to fix.

The trigger combination is Playwright's Linux WebKit falling past the MP4 to
`tracer.webm`, the WebM #384 put behind it, because this build has no H.264 decoder —
`el.canPlayType('video/mp4')` is the empty string — the same source selection
[webkit-buffered-ranges](./webkit-buffered-ranges.md) turns on. **Whether the MP4 is
affected is unmeasured, and could not be measured here: no H.264-capable WebKit is
available in this environment.** Nothing in this record says real Safari is
unaffected; that is not established either way.

**Whether `paused` and `ended` are also necessary conditions is unmeasured.** #470
asked about a seek to exactly the end "while paused, on an element that has already
played through". What was isolated is the target position and nothing else: every run
in the measurement was paused and had played through, so neither of those two was
ever varied, and this evidence cannot say whether they are part of the trigger or
merely how the tests happen to be written.

## Why the obvious workarounds were rejected

**A library workaround** — clamping a requested position near `duration` down to
`duration - epsilon` — was rejected outright. It would change seek semantics for
every consumer on every engine: a seek to the end would no longer end the clip, so
`ended` would not fire, the play button would not reach its `ended` state, and any
consumer whose "restart" or "play next" hangs off that would break. That is a
permanent behavioural change to the public API to accommodate one engine's defect on
one fixture, and the measurements above say the library is already correct — the
write it makes takes, and the seek it asks for is accepted.

**Retrying the seek** is the same trade in a smaller package. A retry loop around
`duration` would mean the adapter deciding that an accepted, `seeked`-confirmed
position is wrong and issuing traffic to correct it, on every engine, from evidence
that is indistinguishable from a consumer having seeked elsewhere in between.

**Keeping half the test on WebKit** — asserting that the control moves to its `max`
on `End` and back to its `min` on `Home`, and skipping only the assertions that need
the media element to have arrived — does not work, and was checked rather than
assumed. The control is not an independent witness: `SeekSlider`'s `value` comes from
`PlayerState.currentTime`, with `useSeekPreview` holding the requested value only
until the published state answers for it
(`packages/react/src/optimistic-request.ts`). On a failing run the seek _succeeds_,
the element publishes `0`, the preview is released and the control follows the media
back down — which is exactly what the pointer test's own failure string reported:
`control 0 (target 1) / media 0`. So a control-only assertion after `End` would fail
on precisely the runs the media assertion fails on. The `Home` half degrades the
other way, and worse: on a defective run the playhead is already at 0 when `Home` is
pressed, so the control already sits at its minimum, the press produces no `input`
event, and `toBe(0)` passes. A kept-`Home` variant would go green **precisely on the
runs where the defect fired** — a silent false pass, not a flake, which is a worse
failure than the one being avoided. On the runs where `End` works the playhead is at
1 and that same assertion is perfectly live, so this is not a check that can never
fail; it is one that stops being able to fail exactly when it is needed. A guard that
cannot refuse the defect it exists for is worth nothing, the same reasoning as
[webkit-key-event-round-trip](./webkit-key-event-round-trip.md) and as this
directory's [buffered-ranges record](./webkit-buffered-ranges.md).

**Relaxing the assertion** to accept a playhead of 0 after a seek to the end is the
same objection in its plainest form: 0 after `End` is the failure, so a test that
accepts it asserts nothing.

## What covers this instead

The behaviour is not engine-specific, and the exclusion is one test on one engine.

**Chromium and Firefox run the keyboard test on every run**, both directions, with
the full media-element assertion intact — so "`End` and `Home` reach the media
element" stays continuously covered, which matters because it is an accessibility
claim and ADR-0005 names those two keys as what keeps each slider operable.

**The pointer test still runs on all three engines, WebKit included.** It was
retargeted rather than excluded: it now settles the seek slider at `0.95` — a stop on
the control's derived grid, 19 of 20 steps from the minimum its click asks for —
instead of at `1`. All three engines park the playhead at exactly `0.95` for that
write (measured 2026-08-25, locally on an idle machine: webkit 6 of 6, chromium 4 of
4, firefox 4 of 4), so WebKit keeps its coverage of "a pointer click reaches the
media element". Only the end-of-media target was ever the problem.

**The mid-clip `End`/`Home` tests below it** (#383) run on WebKit and assert that the
press became an `input` event and a media `seeking`, deliberately not where the
playhead settles — the stronger statement, and the one this defect cannot touch.

**The adapter's own seek behaviour** is covered by engine-independent unit tests in
`packages/provider-native`.

## What would reopen this

A WebKit build that lands a seek to exactly `duration` on this clip on every run, or
a fixture this engine seeks to the end deterministically — an H.264-capable
Playwright WebKit, which would take the MP4 and never reach the WebM, is the likelier
of the two, and would also answer the MP4 question this record has to leave open.
Evidence that the defect reaches real Safari, or any engine on the MP4 leg, would
reopen it from the other direction and would be a different record. So would a
reproduction on a playing element, or on one that has not played through: those are
the two conditions of #470's hypothesis this work never varied, and either result
would say the trigger is wider than the target position this record pins it to.

Either way the check is the one that produced this record: at roughly one failure in
three, a single green run proves nothing and the configured `retries: 2` turns the
whole thing green, so the runs have to be repeated with retries disabled and counted
— `--repeat-each=25 --retries=0` is what it took to see it at all.

## Prior requests

- #470 — "A `currentTime` write is dropped on a fully-parsed WebKit source, and the
  playhead reads 0". The title states the conclusion this record refutes: the write is
  not dropped, and the issue is kept under its original name rather than renamed after
  the fact. The issue carries the write-up and representative excerpts of the
  accessor-trap output and the per-run event logs. It does not carry the raw logs:
  those were written to a gitignored `.scratch/issue-470-measurement/` and to a CI
  artifact that expires, and the workflow that produced them has since been deleted.
  So the measurement is not reproducible from the repo as it stands — repeating it
  means rebuilding that workflow from the recipe above.
