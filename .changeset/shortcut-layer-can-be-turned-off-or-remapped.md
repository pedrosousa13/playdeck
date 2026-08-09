---
'@reely/react': minor
---

`Player.Controls` takes a `shortcuts` prop, and the media shortcut layer it has
always owned is now something a consumer can turn off or rebind (#181). Every
action in the default map, and the capability each is gated on, is unchanged;
what a consumer who configures nothing does get differently is set out under
the three behaviour changes below.

`shortcuts={false}` turns the layer off entirely — in `global` mode no
`document` listener is attached at all. An object is a partial override map of
action to a `KeyboardEvent.key` value, an array of them, or `null` to suppress
that one binding, and every action it does not name keeps its default, so
moving one key never means restating the map. Both forms behave the same in the
default region-scoped mode and in `global` mode. `ShortcutAction` names the ten
actions — `togglePlayback`, `seekBackward`, `seekForward`, `seekBackwardLarge`,
`seekForwardLarge`, `volumeUp`, `volumeDown`, `toggleMuted`,
`toggleFullscreen`, `toggleCaptions` — and `ShortcutBindings` is the map type.
Hoist the object or `useMemo` it: a fresh literal on every render re-attaches
the global listener.

This is what WCAG 2.1.4 Character Key Shortcuts asks for. `global` mode's
single-character keys are live wherever focus is on the page, and until now
there was neither a way to switch them off nor a way to move them; the
region-scoped default was never the problem and conforms through the
active-on-focus exception. `global` mode itself stays.

**A focused slider no longer silences the layer.** The layer used to skip any
`<input>` target before it looked at the key, so
standing on the seek slider — a native range input — killed Space, `k`, `j`,
`l`, `m`, `f`, `c` and the volume arrows as well as the seek arrows. Targets
are now classified by what they do with a keystroke: text entry (a text
`<input>`, `<textarea>`, `<select>`, a content-editable region) and an open
menu still silence everything, a focused button, link, `summary`, checkbox or
similar keeps Space and `Enter` for itself, and everything else — a range input
included — goes to the layer. That, and the two page keys the map now claims,
give a consumer who configures nothing three changes they will notice:

- **`ArrowLeft`/`ArrowRight` on a focused volume slider now seek** rather than
  changing the volume. `ArrowUp`/`ArrowDown` still adjust it and `Home`/`End`
  still jump to 0 and 1, so the control stays fully operable — but they adjust
  it by the layer's fixed 0.05, not by the input's `step`. `VolumeSlider` is
  itself the range input, so its `step` — that same 0.05 by default, and
  overridable with `<Player.VolumeSlider step={0.1} />` — no longer reaches the
  arrows for a consumer who set their own.
- **`ArrowLeft`/`ArrowRight` on a focused seek slider now travel 5s, not 1s.**
  They used to step the input by its `step`; the region owns them now, so the
  seek distance is the same wherever focus sits, and no `step` or `onChange`
  set on that input through `inputProps` sees an arrow press any more.
  `SeekSlider` keeps `step={1}`, which still governs pointer scrubbing —
  coarsening it to 5 would make a short clip unscrubbable — and the announced
  `aria-valuetext` stays the accurate time readout.
- **`PageUp` and `PageDown` are now bound**, to the same ten-second jumps as
  `l` and `j`. A consumer who configures nothing therefore gets two keys the
  map did not claim before, and on a focused range input they no longer produce
  the engine's own page step. That was the point: the large jump is now a
  defined distance rather than whatever the browser does. `Home` and `End`
  remain native.

`shortcuts={{ seekBackward: null, seekForward: null }}` is the way back for the
seek arrows: it suppresses those two bindings and hands the arrows straight to
whatever native control has focus, leaving the rest of the map in place. The
volume pair and the two large jumps take the same treatment, under
`volumeUp`/`volumeDown` and `seekBackwardLarge`/`seekForwardLarge`.

Capability gating still runs before any key is claimed: a binding whose
capability is unavailable neither acts nor prevents the default, so the key is
left to the page — and to the focused control, which is why the arrows still
step a slider on a provider that cannot seek. `togglePlayback` is the one
ungated binding, unchanged by this release: there is no playback capability to
gate on, so Space and `k` are claimed on every provider.

It lands as `minor`: every package is still at `0.0.0` with `first-prerelease`
not yet released, and under 0.x `minor` is the channel a breaking change travels
on. It is breaking three times over — `ArrowLeft`/`ArrowRight` on a focused
volume slider change what they do, the seek slider's arrow distance changes from
1s to 5s and stops reaching that input's `step` and `onChange` at all, and
`PageUp`/`PageDown` stop producing the engine's page step on any range input
inside the region. A consumer relying on any of the three sees it without
changing a line, and `shortcuts` is what hands each one back.
