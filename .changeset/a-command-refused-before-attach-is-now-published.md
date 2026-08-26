---
'@playdeck/core': minor
---

A command issued before a provider attaches is now published on
`PlayerState.refusedCommand`, and a play refused that way now fills
`PlayerState.refusedPlay` as well (#484).

**What was wrong.** `playWithOrigin` and `pauseWithOrigin` return
`{ ok: false, reason: 'not-ready' }` from an early return taken when no provider
is attached, and `#seekWithOrigin` and the shared command path do the same. The
publication that fills `refusedPlay` lives inside the private method the play
early return never reaches, so a pre-attach refusal was produced correctly,
returned to the caller correctly, and published nowhere. Every control this
package's React bindings ship is rendered, enabled and `aria-pressed` from first
paint, and each discards the `CommandResult` it gets — so a viewer who pressed
play on a cold page got a control that looked actionable, did nothing, and left
no record anywhere that they had asked. A consumer who was already reading
`refusedPlay` could not see it either, because the field they would read was
never written.

**What is published.** One new field beside `refusedPlay`, not replacing it:

```ts
export type PlayerCommand =
  | 'play' | 'pause' | 'seek'
  | 'mute' | 'unmute' | 'setVolume' | 'setPlaybackRate'
  | 'selectQuality' | 'selectTextTrack'
  | 'requestFullscreen' | 'exitFullscreen'
  | 'requestPictureInPicture' | 'exitPictureInPicture'
  | 'showAirPlayPicker';

export type RefusedCommand = {
  readonly command: PlayerCommand;
  readonly origin: PlayerEventOrigin | null;
  readonly reason: 'not-ready';
};

readonly refusedCommand: RefusedCommand | null; // on PlayerState
```

`PlayerCommand` and `RefusedCommand` are exported from the package entry.

**One field rather than fourteen.** Eleven of the fourteen commands funnel
through a single refusal site, and a consumer asking "was anything I asked for
refused" would otherwise OR eleven slots together — the assembly `refusedPlay`
was introduced to prevent (#361). A field rather than an event for the same
reason that one settled: a refusal is a moment, but what a consumer presents is
a condition, and an event would re-open that.

**`reason` is the literal `'not-ready'` and nothing else.** No other
`CommandFailureReason` has a clearing rule that would keep this a condition
rather than a log. `unsupported` is already published per command as
`PlayerCapabilities`; a `blocked` or a `provider-error` on a `setVolume` is a
moment with no natural end.

**`origin` is nullable, and its `null` is not `seekOrigin`'s.** Only `play`,
`pause` and `seek` have `*WithOrigin` entry points, so the other eleven carry
`null`. Here that means the origin was never recorded — not, as on
`PlayerState.seekOrigin`, that nothing is in flight. The three that do carry one
keep it, because the shipped controls tag their seeks and pauses as `'user'`,
and "the viewer scrubbed and nothing happened" is worth telling apart from a
programmatic call.

**Its lifetime is the pre-attach window.** The refusal stands from the moment it
is made until a provider attaches, and attach is what withdraws it — in the same
synchronous update that publishes `activation: 'loading-provider'`, so no
snapshot reports a provider in hand beside a refusal saying there was none. A
swap and a detach clear it too, because each re-opens the window rather than
leaving the old refusal describing it. Nothing else clears it, because nothing
else can make "no provider was attached" stop being true.

**A pre-attach play fills both fields, deliberately.** They do not end together:
`refusedPlay` carries any failure reason and is cleared by confirmed playback,
`refusedCommand` carries one reason and is cleared by attach. One field with two
clearing rules would be worse than two fields, and dropping `'play'` from
`PlayerCommand` would force a consumer to check two fields and OR them. This is
the overlap `refusedPlay` and `autoplay` already have, documented the same way.

**`retry` is not a `PlayerCommand`.** The `not-ready` it can raise comes from a
guard that runs with a provider attached and the generation moved under it, so
the attach that moved it would withdraw the refusal it caused. That is a moment,
not a condition. Leaving it out of the vocabulary keeps both of its refusal
sites silent rather than one of them.

**`refusedPlay`'s published behaviour is unchanged.** Its shape, its clearing
rules and the three guards that drop a refusal a later state contradicted are
all as they were, and the tests that settled them pass unmodified. The one
change to it is that the play early return now records a refusal — the hole this
release closes. The three guards hold on that branch without being tested: it is
synchronous, so no later play can have replaced it and the generation cannot
have moved, and `playback` cannot be `'playing'` with no provider attached to be
playing anything.

**Nothing renders differently.** No control gained a `disabled` attribute, none
inspects a command result it did not inspect before, and no shipped UI presents
a refusal. This publishes the fact and leaves the copy, and the decision to show
it at all, to the consumer.

**Why `minor`.** No API broke, but the published state gained a field and two
types, and a consumer comparing snapshots or asserting on `refusedPlay` sees
something they did not see before.
