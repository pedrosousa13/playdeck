# N key presses inside one round trip, on WebKit

Playdeck does not test gestures that require **N keyboard presses to land inside a
single command round trip** on WebKit. The two arrow gestures that need that property
run on Chromium and Firefox and are excluded from WebKit permanently. This is not a gap
waiting to be filled; it is a property of the engine and the test driver, and it was
measured rather than assumed.

## Why this is out of scope

Playwright-injected keyboard events on WebKit return to the browser's task queue between
one event and the next. Anything the page has queued in that gap runs — notably a media
element's `volumechange` or `seeked`, and the state publish behind it. Chromium and
Firefox deliver an injected burst without a macrotask turn in between.

So by the last press of a burst on WebKit, the media element has already answered several
times, and a test asserting that the presses outran the echo cannot be true there.

The measurements, against a faithful model of the shortcut layer's base read and the
command chain's trailing-edge coalescing, 12 repetitions per cell, counting answers
received by the last press:

| congestion burn | keys | webkit     | chromium   | firefox    |
| --------------- | ---- | ---------- | ---------- | ---------- |
| 0               | 24   | 12/12 fail | 12/12 fail | 11/12 fail |
| 5               | 24   | 12/12 fail | 0/12       | 8/12 fail  |
| 15              | 24   | 12/12 fail | **0/12**   | **0/12**   |
| 50              | 24   | 10/12 fail | **0/12**   | **0/12**   |
| 50              | 5    | 10/12 fail | **0/12**   | **0/12**   |

Chromium and Firefox are clean at every burn from 15 upward and at every burst length.
**WebKit fails at every setting including a burn of 0**, so congestion is not the cause
and removing it does not help. WebKit's press spread scales linearly with the burn — at
a burn of 400 over 24 keys the spread reaches 3.6 seconds — so a longer burn is strictly
worse, not better.

Four congestion shapes were tried (a self-rescheduling loop, a single one-shot block, a
long idle gap between bursts, and burning inside the keydown handler) and both dispatch
modes. None improved WebKit.

## Why the obvious workarounds were rejected

Both of the tempting fixes destroy the thing the test exists to prove:

```
// Synthesising untrusted KeyboardEvents in one task would make the
// "presses outran the echo" guard true by construction. It could then no
// longer refuse a run where the presses did not outrace anything.
```

Relaxing the guard to accommodate WebKit's spread has the same effect for the same
reason. **A guard that cannot fail is worth nothing**, and a test suite that reports
green because its assertion became unfalsifiable is worse than one that admits it cannot
cover an engine.

A third option was weighed and declined: re-attempting the whole gesture until one lands
inside a round trip, failing hard if none of N attempts does. It does keep the guard's
refusing power — a quiescence-only run would exhaust every attempt — but it changes what
the test claims from "this gesture behaves correctly" to "this gesture behaves correctly
on at least one of N attempts", and that is a weaker claim bought with real machinery.

## What covers this instead

The engine-independent unit tests cover the same behaviour directly, without needing an
injected key burst at all. The e2e exclusions are narrow: three tests are skipped on
WebKit, each at the top of its own test with the reason stated. The volume
`End`/`Home`/`End` gesture runs on all three engines.

## What would reopen this

A driver or engine change that delivers injected key events on WebKit without a
macrotask turn between them, or a formulation of the property that does not require N
presses inside one round trip. The second is the more likely of the two and nobody has
identified it; if someone does, it is a new issue rather than a reopening of this record.

## Prior requests

- #278 — "WebKit yields to its task queue between injected key events, so no e2e can put
  N presses inside one round trip"
