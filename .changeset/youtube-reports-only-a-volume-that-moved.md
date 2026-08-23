---
'@playdeck/provider-youtube': minor
---

The YouTube provider now publishes `volumechange` — and the state patch beside
it — only when the volume or the muted flag it was handed differs from the one
it is already holding. It published both for every accepted `mute`, `unmute` and
`setVolume`, whether or not the value moved, so an event reported a change the
media never made (#365).

The helper that emits the pair compared nothing, and could not: each of the
three commands overwrote the known value first and then asked for the emit, so
by the time the comparison would have run, the value to compare against was
gone. It now takes the values it is about to publish as arguments and does the
assignment itself, which is what puts the current and the next values in the
same place at the same time.

**Why this was YouTube's alone.** It was the only adapter that treated an
accepted command as an event. The native provider assigns the media element's
`volume` and emits nothing of its own — the element fires `volumechange` only on
a real change, so a redundant command there is genuinely inert — and HLS
delegates to it. Vimeo and Wistia publish nothing at all for an accepted volume
command. The only thing either emits off one is a **capability downgrade** —
`{ capabilities }`, carrying no volume — when `setVolume` comes back refused as
`unsupported`, and `mute`/`unmute` emit nothing on any refusal. #365's
description said the two "re-emit only when the SDK refuses a command, to snap
consumer state back off a change that did not land"; neither re-emits a volume,
and the point that reading was reaching for — that no other adapter turns an
accepted command into a volume event — holds without it. Nothing
downstream absorbed the difference: `PlayerController` fans every provider event
straight out to the registered listeners rather than deduping them, and that is
deliberately still true. A general filter in the controller would have masked
the same defect wherever else it appeared.

**Where a consumer will notice it.** A muted volume-arrow press. `Player.Controls`
records the level an unmute is restoring as a volume request (#274), which at a
nonzero published volume asks the player for the volume it already holds. That
second command moves no state value on any provider and is silent on all five,
YouTube now included. The unmute is the one real change in the pair, and every
other provider does publish exactly one event for it — through its element or
SDK event path rather than its command path. Native's `muted = false` makes the
element fire `volumechange`, and HLS inherits that; Vimeo's attachment
subscribes to the SDK's `volumechange`, which is where the muted half arrives,
which is why it re-reads `getMuted()` on every fire; Wistia's subscribes to
`mute-change`. So the count to match here was one, not zero: YouTube fired the
unmute's event and then a second, value-identical one off the redundant
`setVolume`, and now fires the one. One press, one real change, one event, on
every provider. That is the extra event
[#274](https://github.com/pedrosousa13/playdeck/issues/274)'s changeset stated
so it would not be silent in the meantime; it is gone.

**This removes events, and that is the direction that needs the care.** A
consumer counting `volumechange` — analytics, telemetry, anything persisting the
volume on the event rather than on a state diff — counted more volume changes on
YouTube than the viewer made, and now counts what the other four providers
count. A consumer treating the event as an acknowledgement that a command was
carried out is the one that has to look: it never was that. The command result
is what answers a command, and it is unchanged here — an accepted no-op still
resolves `{ ok: true }`, it simply publishes nothing. The event says the volume
moved, and now it only fires when it did.

**The commands themselves still reach the player.** `mute()`, `unMute()` and
`setVolume()` are called on the iframe API whether or not the mirror moves, and
that call is load-bearing rather than defensive. `adoptVolume` reads `isMuted()`
and `getVolume()` back off the player at ready, and nothing re-reads it after
that — there is no volume event to subscribe to and no volume poll — so
re-asserting a mirror the command did not move is the only mechanism that
re-converges a player whose volume has drifted from it. Nothing else would
notice until the next `onReady`. Only the report is suppressed.

**Rounding is untouched, and the comparison is deliberately not made on it.**
The player is sent a rounded `0-100` integer while the mirror keeps the
unrounded clamped `0-1` value, so `setVolume(0.501)` and `setVolume(0.502)` are
two distinct requests that land on the same player step, and both are still
published. The comment on `emitVolumeIntent` carries the reasoning, next to the
comparison it governs.

**Nothing was silenced that the platform reports.** The IFrame Player API
publishes no volume event of its own to arrive through this path: its event set
is `onReady`, `onStateChange`, `onPlaybackQualityChange`, `onPlaybackRateChange`,
`onError` and `onApiChange`, and the adapter subscribes to five of those and to
nothing else. Volume is readable only through the `isMuted()` and `getVolume()`
getters, which is why these mirrors exist at all. The adapter does read them:
`adoptVolume` runs at ready and the ready patch publishes what it found, so a
volume the viewer set in YouTube's own chrome before that point does reach a
consumer. What has never existed is an ongoing report — a change made in that
chrome mid-session is not observed until the next ready adopt, which was as
true before this change as after it.

It lands as `minor` rather than `patch` for the reason
[#400](https://github.com/pedrosousa13/playdeck/issues/400)'s duration fix did:
no API moved, but what a released version puts on the provider stream did, and a
consumer asserting on that stream sees a difference. Here the difference is a
subtraction, which is the stronger case of the two — a consumer counting these
events gets a smaller number from the same session. `patch` answers to a defect
fix behind a surface whose behaviour did not change, and this one's did.
`major` would ask a consumer to do something before upgrading; there is nothing
to do, and at `0.x` the `minor` slot is where an intentional behaviour change
belongs.
