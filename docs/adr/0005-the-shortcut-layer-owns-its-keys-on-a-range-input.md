# The shortcut layer owns its keys on a focused range input

`Player.Controls` is a focusable region that binds ten media actions to keys,
and two of the controls it holds are native range inputs: `SeekSlider`'s
scrubber (`step={1}`) and `VolumeSlider` (`step={step ?? 0.05}`, so a consumer
can set its own by passing `step` to the component, which is the input). A range
input answers the arrow keys itself, so on those two controls every bound arrow
has two plausible owners. Before #181 the region resolved that by standing
down — `controls.tsx`'s target test skipped any element whose tag was `INPUT`,
and it ran before the key was looked at, so a focused slider handed the layer's
arrows to the input and killed Space, `k`, `j`, `l`, `m`, `f` and `c` in the
same move, none of which a range input consumes. The seek slider is one of the
likeliest places for focus to rest, and it was the position from which the
player was least controllable.

#181 sanctioned either of two answers once the layer stopped standing down: the
layer owns the arrows and prevents the default, making the native stepping
inert; or the slider keeps its finer step and announces the different
granularity through its own accessible value. **The layer owns them.** The seek
and volume branches call `preventDefault()` whatever the target, so
`ArrowLeft`/`ArrowRight` seek five seconds and `ArrowUp`/`ArrowDown` move volume
by 0.05 everywhere inside the region, on either slider included. `PageUp` and
`PageDown` join `l` and `j` on the ten-second jumps for the same reason: on a
range input the page jump is otherwise whatever the engine chose, which no
library code owns and no two engines have to agree on.

Three things decided it.

**One distance, wherever focus sits.** The same keypress used to travel one
second on the scrubber and five off it, and nothing marked the boundary. A user
does not know where focus is by feel; a seek key that changes meaning when it
crosses an invisible line is a key with no meaning at all. Ownership makes the
distance a property of the region rather than of the element under focus.

**Nothing has to be announced.** The alternative keeps two distances and puts
the difference in the seek slider's `aria-valuetext` — the field that already
carries the time readout and rewrites itself many times a second during
playback. A granularity note there is either re-announced with every tick or
has to appear and disappear with focus, and both are worse than the silence the
issue complained about. Owning the keys removes the thing that would need
announcing.

**Both sliders stay operable.** Ownership costs neither slider its keyboard
access. The scrubber keeps `ArrowLeft`/`ArrowRight` — at five seconds, through
`seekBy`, instead of at one through `step` — plus `PageUp`/`PageDown` and native
`Home`/`End`. The volume slider keeps `ArrowUp`/`ArrowDown`, now at the layer's
fixed 0.05 through `setVolume` rather than at its own `step`, plus native
`Home`/`End` for 0 and 1. Neither control loses an axis; one of them changes
which keys reach it.

## The conflict rule

Ownership is only defensible if the exceptions are stated rather than
discovered, so the target test classifies by what a control does with a
keystroke and not by its tag:

- **Text entry silences the whole layer**, as it always did — a `<textarea>`, a
  `<select>`, a content-editable region, and an `<input>` whose type is not on
  `controls.tsx`'s `nonTextInputTypes` list. An unknown or absent `type` counts
  as text entry, which fails safe: protecting typing is the point of the rule.
  An open menu (`[role="menu"]`, `[role="menubar"]`, `[role="listbox"]`,
  `[data-playdeck-menu="open"]`) silences it the same way.
- **An activation target keeps `' '` and `Enter` and nothing else.** A
  `button`, `[role="button"]`, `a[href]`, `summary`, or an `<input>` of a type
  that acts on those two keys — `button`, `submit`, `reset`, `image`,
  `checkbox`, `radio`, `color`, `file`. Every other bound key still fires while
  focus is on one, which generalises a carve-out that used to cover Space alone.
  Each input type is named because a CSS `button` selector matches `<button>`
  and never an `<input>`.
- **Everything else goes to the layer**, which acts and prevents the default.

`range` is the one type on the non-text list and off the activation list, and
the two lists differ by it alone. The lists ask different questions: non-text
asks whether a keystroke is being typed, activation asks whether Space and
Enter belong to the control. A range input answers no to both — it takes no
text, and it answers arrows, which is exactly the key group this decision
claims. That is why it is the type that had to be separated out, and why one
shared list drives both tests: a type held to be non-text but not conceded Space
would be a swallowed form submit or file picker.

Which action a key reaches is fixed by the library's own action order, not by
the order a consumer wrote their bindings object in, so two actions bound to one
key resolve identically on every render and in every consumer.

## Consequences

- **`ArrowLeft`/`ArrowRight` on a focused volume slider now seek instead of
  changing the volume.** Natively they stepped it by that input's `step`, and
  `ArrowUp`/`ArrowDown` still adjust the volume, so no axis is lost — but a
  consumer who reached for Left on the volume slider gets a seek. This is the
  real cost of one distance everywhere, and it is paid here.
- **The arrow distances are the layer's numbers, not the sliders'.** Five
  seconds and 0.05 are constants in `controls.tsx`, so a consumer who set either
  slider's `step` finds the arrows no longer honour their value, and no
  `onChange` on either input sees an arrow press, because the layer prevents the
  default before the input does anything. Each slider takes that `step` by its
  own route: `VolumeSlider` is itself the range input, so a `step` prop on the
  component sets it, while `SeekSlider` wraps its input and takes
  `inputProps={{ step: 5 }}`.
  `shortcuts={{ seekBackward: null, seekForward: null }}` suppresses
  those two bindings and hands `ArrowLeft`/`ArrowRight` straight back to the
  input, in either scoping mode; the volume pair has the same escape hatch
  under `volumeUp`/`volumeDown`.
- **`SeekSlider` keeps `step={1}` even though its arrows now move five
  seconds**, which does mean the element advertises an increment its own
  keyboard no longer uses. That is deliberate. `step` still governs pointer
  scrubbing, and coarsening it to 5 would make a clip of a few seconds
  unscrubbable by mouse; assistive technology announces `aria-valuetext` — the
  time readout, which stays accurate whatever moved the value — rather than the
  `step` attribute, so nothing reads the stale number out. Pointer dragging on
  both sliders is untouched by this decision.
- **Ownership is conditional on the layer having something to do.** Capability
  gating runs before `preventDefault()`, so where `seek` is unavailable the
  arrows still step whatever range input has focus, and where `setVolume` is
  unavailable `ArrowUp`/`ArrowDown` do. A key the layer cannot act on is left to
  the page, which is also what keeps the region out of the way on a provider
  that cannot seek at all. `togglePlayback` is the exception, and it is not one
  this decision introduced: there is no playback capability to gate on, so
  Space and `k` are claimed on every provider.
- **The rule is about range inputs, not about Playdeck's two sliders.** A consumer
  who puts their own `<input type="range">` inside `Player.Controls` gets the
  same treatment, and the same escape hatch. That is deliberate: a rule that
  named the library's own parts would be undiscoverable from outside them.
- **The classification is now a list that has to be maintained.** A new
  `<input>` type, or a new native control that answers a key the layer binds,
  is a decision someone has to take rather than a default someone inherits.
  Getting it wrong in the safe direction costs a shortcut; getting it wrong in
  the other costs a keystroke a user meant for their own control.
