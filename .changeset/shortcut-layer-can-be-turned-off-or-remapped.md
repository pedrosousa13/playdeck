---
'@reely/react': minor
---

`Player.Controls` takes a `shortcuts` prop, and the media shortcut layer it has
always owned is now something a consumer can turn off or rebind (#181). The
default map, its keys and its capability gating are unchanged for anyone who
configures nothing.

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

**A focused slider no longer silences the layer, and that changes two keys.**
The layer used to skip any `<input>` target before it looked at the key, so
standing on the seek slider — a native range input — killed Space, `k`, `j`,
`l`, `m`, `f`, `c` and the volume arrows as well as the seek arrows. Targets
are now classified by what they do with a keystroke: text entry (a text
`<input>`, `<textarea>`, `<select>`, a content-editable region) and an open
menu still silence everything, a focused button, link, `summary`, checkbox or
similar keeps Space and `Enter` for itself, and everything else — a range input
included — goes to the layer. Two consequences a consumer will notice:

- **`ArrowLeft`/`ArrowRight` on a focused volume slider now seek** rather than
  changing the volume. `ArrowUp`/`ArrowDown` still adjust it, by the same 0.05,
  and `Home`/`End` still jump to 0 and 1.
- **`ArrowLeft`/`ArrowRight` on a focused seek slider now travel 5s, not 1s.**
  They used to step the input by its `step`; the region owns them now, so the
  seek distance is the same wherever focus sits, and any `step` or `onChange`
  set on that input through `inputProps` no longer sees an arrow press.
  Pointer dragging is untouched.

`shortcuts={{ seekBackward: null, seekForward: null }}` is the way back: it
suppresses those two bindings and hands `ArrowLeft`/`ArrowRight` straight to
whatever native control has focus, leaving the rest of the map in place.

`PageUp` and `PageDown` are now bound to the ten-second jumps alongside `l` and
`j`, so on a range input the large jump is a defined distance instead of
whatever the engine does with a page key. `Home` and `End` remain native.
Capability gating still runs first everywhere: a binding whose capability is
unavailable neither acts nor prevents the default, so the key is left to the
page — and to the focused control, which is why the arrows still step a slider
on a provider that cannot seek.
