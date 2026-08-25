---
'@playdeck/provider-native': minor
---

A `startTime` the native provider could not position the source at now publishes
a non-fatal `configuration` notice on `PlayerState.error` instead of being
dropped in silence (#418).

**The offset still does not apply.** This release makes the refusal observable
and nothing more. Making the requested position actually take — deferring the
write until the seekable window reaches it, or positioning off the container's
declared duration rather than off `seekable` — is tracked separately (#465), as
is the shape where the window's end falls below the requested start (#466). A
consumer reading this changeset should expect a report, not a repair.

**What was measured.** On WebKit, a `<video>` that has not started playing
reports `duration === 0` and an empty `seekable` at `loadedmetadata`, which is
when the provider considers the configured start. The clamp into those bounds
answers `0`, the playhead is already at `0`, so the write is skipped and the
start is never applied. Measured on 2026-08-23 against Playwright's Linux
WebKit, 6 parallel workers, a 10s WebM served in trickled chunks so the parse
lags playback, `startTime: 5`: of 60 loads, **51 silently dropped the offset**,
8 applied it, and 1 wrote nothing for an unrelated reason. Chromium and Firefox
were not run in that arm. Nothing on `PlayerState` said so — the player simply
began at 0:00 — so a consumer could not tell a source that ignored the setting
from a setting they had mis-wired.

**What is published.** One notice per load, decided by the same latch the
positioning write uses, so a repeat `loadedmetadata` republishes nothing. It
carries `category: 'configuration'`, `fatal: false`, `recoverable: false` — the
remedy is a change the consumer makes, so a retry re-runs the same configuration
against the same source and reaches the same answer — and
`severity: 'presentational'`, because a start offset that did not apply left
nothing about the viewer unprotected and must yield the single error slot to any
protective notice the same attach raises (#368). The message is static, and
names neither the requested offset nor the position reached: both are already on
`PlayerState.currentTime` and in the consumer's own props, and a notice that
re-worded itself per load would be unreadable to a monitoring system.

**One limit worth knowing.** A `retry()` gets a fresh decision from the
provider, but the controller holds one configuration notice per attach and has
no way to withdraw one. So a refusal published before a retry stays on
`PlayerState.error` even where the reloaded source satisfies the offset. That
mechanism predates this change and is filed as #475; nothing here narrows or
widens it.

**The condition is the position, not the write.** The notice is published
whenever the position that would be applied is not the one configured. That
covers all three shapes: the empty-`seekable` case above, a clamp into a window
still being parsed (a fraction of the clip), and a start above every seekable
range, where there is nowhere legal to land and nothing is written at all. It is
deliberately not keyed on whether a write happened — an element already sitting
exactly on `startTime` writes nothing and publishes nothing, because the
consumer got the position they asked for.

**Nothing else changed.** `startTime: 0` remains an ordinary load that writes
nothing and publishes nothing, and the existing write/skip rules after the check
are untouched: still skipped when the position matches where the element already
is, still written otherwise.

**Why `minor` and not `patch`.** No API broke, but a released package publishes
an error it did not publish before for the same source, and a consumer asserting
on `PlayerState.error` or rendering `Player.ErrorDisplay` sees something new.
That is observable on purpose.
