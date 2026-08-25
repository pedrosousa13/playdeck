---
'@playdeck/core': minor
'@playdeck/provider-vimeo': minor
'@playdeck/provider-wistia': minor
'@playdeck/provider-youtube': minor
'@playdeck/react': patch
'@playdeck/provider-native': patch
---

`startTime` is now a floor the YouTube, Vimeo and Wistia embeds are held to,
rather than a position applied once when the provider adopts the player (#381).
A reported position below it is pulled back into the window and the published
`currentTime` reports the corrected position.

**This is a behaviour change for shipped consumers, and it is deliberate.**
Until now a viewer could drag the platform's own scrub bar below `startTime` and
stay there. From this release they are returned to `startTime`. That follows from
what `startTime` already claimed to be — the window playback is confined to —
and from `seekTo` and `seekBy` having been clamped into that window since #214;
a floor that only a Playdeck command respected was the inconsistency. A consumer
who wants the viewer to reach earlier material should not set a `startTime` for
it.

**What was broken.** The start was written as a load hint and then seeked to
once, at adopt, and nothing re-applied it. From that one seek onwards the window
had no floor at all. Any later cause of a below-start position — an SDK-side
seek, a repeat `ready`, or the viewer dragging the platform's own scrub bar —
left the playhead outside the window, playing material the window was supposed
to exclude, and no report said so. The clamp on `seekTo` and `seekBy` did not
help: the positions that escaped were exactly the ones that arrived without a
Playdeck command. It is corrected now however the position arrived.

**The end of the window is corrected the same way, through the same predicate.**
It was already enforced — a pause plus an `ended` — but only the published
`currentTime` was pinned to the boundary; the playhead itself was left wherever
the player had run on to before the pause landed. A viewer was therefore left
looking at a frame outside the window, for as long as the player stayed there,
while `currentTime` reported the boundary. The playhead is now seeked back onto
the boundary, so what is on screen and what is published agree. Stated without
inflation: the frames between the boundary and the report that notices it are
still shown, briefly. These platforms report time on their own cadence — a poll
every 250 ms on YouTube, the platform's own `timeupdate` on Vimeo and Wistia —
so nothing driven by a report can stop before the boundary. What ends is the
lasting disagreement, not the overshoot.

**One rule, in one place.** `@playdeck/core`'s `createTimeBoundary` gains
`correction(duration, time)`: where a position that simply _arrived_ has to move
for the window to hold, or `undefined` when it needs no move. The three embed
ports consult it, so one prop cannot mean three things — the reason the window
was centralised in #214. `TimeBoundary` gains a member and loses none, and the
existing questions (`start`, `end`, `atEnd`, `atWrap`, `restartsAtStart`,
`clamp`) are unchanged in meaning and in what they answer.

**It does not fight the seek clamp, and it cannot chase itself.** Every answer
`correction` gives is the `clamp` of the same time, so a command the clamp
already pulled into the window reports a position `correction` leaves alone —
the two agree by construction rather than correcting one position twice. And
every answer is a fixed point: move the playhead to it and the report that move
produces asks for no correction, so one out-of-window position costs at most one
corrective seek however many reports of it arrive.

**The loop wrap guard is untouched.** `atWrap` is byte-identical — the loop
concept it was documented as, still short-circuiting on `loop`, still the rule
that restarts a looping embed and starts it playing again. What moved is the
deference to it. Only the time-report paths ask it first: Vimeo's and Wistia's
`onSeeked` call `correction` with no wrap test in front of them, because a
paused embed reports no time update after a seek and the position has to be
published from that handler. So the rule that a playhead behind the start of a
looping player belongs to the loop now lives inside `correction`, which reads
the loop from a parameter rather than from the call site and answers `undefined`
for anything `atWrap` owns — sliding such a playhead onto the start instead
would consume the wrap, leaving a position `atWrap` no longer recognises and
quietly retiring the restart. A looping embed is therefore corrected by the loop
rule exactly as it was and never reaches the floor below it, and that now holds
wherever `correction` is asked from rather than depending on each call site
remembering to ask in the right order. Widening `atWrap` into "enforce a floor
whenever not looping" would have changed all three embeds' loop behaviour to fix
something else, which is why it was not done.

**The native and HLS providers are unchanged**, as they were for #214: native
keeps its own boundary state machine, entangled with the element's `seekable`
ranges, and nothing here reaches it. So `startTime` now means two things, and
both ends say so rather than leaving it to be discovered: `RootProps.startTime`
in `@playdeck/react` and `NativePlaybackOptions.startTime` in
`@playdeck/provider-native` each state the divergence. Those two packages carry
no code change at all — the corrected prose is their whole diff — but it is
prose a consumer reads from the shipped `.d.ts`, so they take a `patch` for it,
the way `@playdeck/react` took one for documentation alone in #457.

**Why `minor` and not `patch`.** This is a defect fix, but not one behind an
unchanged surface. `PlayerState.currentTime` publishes a value it did not
publish before for the same viewer action, the library now moves a playhead it
previously left alone, and `@playdeck/core` gained an export member. `patch`
answers to a fix a consumer cannot observe except as the absence of a bug —
`07e47c3` released the subscriber fan-out isolation that way — and this is
observable on purpose: a consumer asserting on the provider stream sees patches
that were not there before, and a viewer sees a seek they did not ask for. The
precedent is `vimeo-no-longer-obeys-a-url-time-parameter.md` and
`native-duration-no-longer-latches.md`: no API broke in either, but what a
released package does changed, and a behaviour change should not arrive as a
patch.
