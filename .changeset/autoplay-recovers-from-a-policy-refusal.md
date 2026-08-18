---
'@playdeck/core': minor
'@playdeck/react': minor
---

`AutoplayMode` gains a fourth member, `'audible-then-muted'`, and `PlayerState`
gains `autoplayRecovered` (#306). In the new mode the player attempts audible
playback first; if and only if that attempt is refused by policy — the
`reason: 'blocked'` an adapter reports for a browser that would not start
unmuted playback — it mutes and attempts once more. Any other failure is
reported as it is, unretried: a decode error or a provider fault fails for a
reason muting does not address.

`autoplay` still reads `'started'` after a recovery, because playback did start
and nothing switching on that value should have to change. `autoplayRecovered`
is what tells the two apart: it is `true` only where the audible attempt was
refused and the muted retry is what played, so a consumer can offer an unmute
affordance. It is `false` everywhere else — a deliberate `'muted'` autoplay, an
audible attempt accepted first time, a failed recovery, and an in-flight retry
too, since the recovery is recorded at the moment playback starts and not when
the retry is issued. The poster therefore stays over the frame for the whole
recovery and uncovers only if it succeeds.

Exactly one retry ever fires, and only inside this mode. The retry is a second
attempt within one configuration, so the same guard that governs the first one
governs it: a source change, a reconfiguration or a teardown that lands while
the audible attempt is in flight discards the retry rather than adopting it.

`'muted'` and `'audible'` are unchanged in every respect, as is how a refusal is
detected. The React `autoplay` prop accepts the new mode and its default stays
`false`.

**The new mode against a controlled `muted={false}` suppresses the recovery.**
The audible attempt runs normally, and a refusal ends `'blocked'` with
`autoplayRecovered` false, exactly as `'audible'` would. The configuration is
not rejected up front — an audible attempt under a controlled unmuted state is
a legitimate thing to ask for — but muting to recover would override a value the
consumer owns, and this library does not do that. `'muted'` against a controlled
`muted={false}` keeps its existing configuration error, which is a different
case: there the two requests contradict each other before anything is attempted.

Which providers the recovery reaches was established per adapter rather than
generalised from the native one:

- **Native** maps a `NotAllowedError` to `reason: 'blocked'`, so it recovers.
- **HLS** delegates `play` to the native adapter verbatim, so it recovers
  identically.
- **Vimeo** maps the same error name off the promise its SDK rejects, so it
  recovers wherever the SDK names the rejection that way.
- **YouTube** throws nothing for a refusal. It reports `'blocked'` when the
  player has not reached playing or buffering inside its playback-confirmation
  window, so the recovery does run — it just begins at the end of that window
  rather than at the refusal.
- **Wistia** does not recover. It carries the same error-name mapping, but
  `player.play()` is synchronous and returns nothing, so the command resolves
  successfully whatever the browser did and no refusal ever reaches the
  controller. Making Wistia report one is a separate change.
