---
'@playdeck/core': minor
---

A refused play command now reaches player state. `PlayerState` gains
`refusedPlay`, which carries the last play command that was turned down against
the media attached now — an `origin` and a `CommandFailureReason` — and `null`
while none stands (#361).

Before this, a refusal existed only as the `CommandResult` returned to whoever
called `play()`. Under `autoplay={false}` a `NotAllowedError` left `playback` at
`'paused'`, `autoplay` at `'idle'` because that machine never engaged, and
`error` unset, so nothing subscribable moved. A consumer calling
`handle.current?.play()` could at least read the result. A consumer whose viewer
pressed `PlayButton` could not read anything at all: the button issues the
command on the viewer's behalf and discards the result, so the one party who has
to present the outcome never saw one. `refusedPlay` is what they subscribe to,
and no React change was needed to get it — the press already routes through the
same command funnel as every other play.

**Why this is a state field when #244's attempt record deliberately was not.**
That decision reasoned that a refusal is bookkeeping about a command, reported to
the caller that issued it and to nobody else. The first half still holds and the
second half is what #361 disproved: a `PlayButton` press has no caller in that
sense. Where the library issues a command on a viewer's behalf and throws the
answer away, "reported to the caller" reports it to nobody. So a **settled**
refusal is a fact about the player that outlives its command and belongs on
state, while an attempt **still in flight** is a property of the command alone
and stays where #244 put it. `hasUnconfirmedPlayAttempt()` is unchanged and is
still the poster writer's, for exactly the in-flight case this field cannot
answer.

**Beside the blocked-autoplay state, not folded into it.** `autoplay` keeps
`'blocked'` and `'failed'`: it reports the autoplay machine, whose
`'attempting'`, `'suppressed'`, `'started'` and recovered members are states no
record of a refusal could carry. What the new field subsumes is the _question_ —
"was a play refused, and who asked for it" — for every trigger at once. There
are not two independent ways to observe a refusal to choose between. An autoplay
refused by policy appears in both, and `refusedPlay.origin` is `'autoplay'`,
which is the whole story about which applies when: ask `refusedPlay` about the
refusal, ask `autoplay` about autoplay. A viewer's refused press is
`origin: 'user'`; an untagged `play()` is `origin: 'api'`.

**Lifecycle.** A refusal is a moment and a field is a condition, so what is
published is the condition: _the last play command was refused and nothing has
played since_. It is set when a play command settles unsuccessfully, replaced by
a later refusal, and cleared by exactly two transitions.

- **A provider patch that confirms playback.** Not the play promise resolving —
  playback is what a provider reports — and not only the patch answering the
  retry: any play that starts clears it, including autoplay's own muted
  recovery and the viewer working the provider's native controls. This is the
  same site and the same moment at which #244's attempt record is dropped, which
  is deliberate: the two describe the same window and must not disagree about
  when it closed.
- **The provider changing.** Attach, swap and detach all end it, so a new source
  never inherits the last one's refusal. That is where it parts company with a
  refused-URL notice, which survives an attach: a notice describes a consumer
  prop no provider ever saw, while this describes a command one provider turned
  down.

Nothing else clears it, and that is the point of stating it as a condition — a
pause, a seek, a stall or a later error leaves a refused play exactly as refused
as it was, and a consumer presenting it is not made to guess when to stop.

**What did not change.** The `CommandResult` handed back to a direct caller is
untouched, byte for byte, including the `PlayerError` a refusal carries.
`playback` still stays `'paused'` through a refused play, `autoplay` still stays
`'idle'` where the autoplay machine never ran, and the error slot is still not
filled — `keeps confirmed paused state when the media play command rejects`
passes unchanged. `@playdeck/react` is not listed here at all — it ships no
behaviour change, and takes only the dependency patch every dependent gets:
`PlayButton` still discards its command result, which after this costs a consumer
nothing, and no primitive, prop or part presents the refusal. That decision
stands and is recorded in
`.out-of-scope/default-presentation-on-blocked-autoplay.md`, which #361 updates:
this is the primitive that file's composed path assumes, supplied rather than
reopened.

The refusal deliberately does **not** carry the `PlayerError` from the command
result. The state has one error slot, `ErrorDisplay` renders whatever is in it,
and filling it on a refused play would ship exactly the default presentation
that file declines. Repeating the error inside `refusedPlay` instead would give
one `PlayerError` two homes with two clearing rules. `reason` is what a consumer
branches on, and the copy is theirs to write.

A provider cannot forge one: `ProviderStatePatch` is a `Partial<PlayerState>`,
so the key is in every patch's reach, and the field is filled from the
controller's own record and never from the patch — the same rule
`autoplayRecovered` already keeps.

`CONTEXT.md` gains a **Refused play** term and qualifies **Unconfirmed play
attempt**, whose "reported to the caller and to nobody else" no longer describes
what the library does.
