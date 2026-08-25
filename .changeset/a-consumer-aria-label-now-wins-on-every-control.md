---
'@playdeck/react': minor
---

An `aria-label` a consumer passes now wins on every control, and `SeekSlider`
forwards one onto the element that carries the slider role (#446, #437).

**This is not internationalisation.** Playdeck still ships one hardcoded English
label per control, still carries no message catalogue, and still has no locale
mechanism. What changes is that the label is now a fallback rather than an
override, so a consumer can finally supply their own string — which is the
prerequisite for any i18n approach, not an instance of one.

**What was broken.** Six controls — `PlayButton`, `MuteButton`,
`CaptionsButton`, `FullscreenButton`, `PipButton` and `AirPlayButton` — spread
the consumer's props _above_ their own literal `aria-label`. React's later-wins
rule then dropped the consumer's value with no error and no warning, and the
control kept announcing the built-in English. The literal was written last
because five of the six swap their wording by state, and writing it last is
exactly what discarded the consumer's name. Each now reads the label off props
and falls back inside the branch, which is the shape `VolumeSlider` and
`ActivationButton` already had; those two are untouched.

**One name holds in every state.** Where a control's default wording changes
with state, a consumer who supplies a single name keeps it on both sides of the
toggle. The library does not reassert `'Pause'` over a name the consumer chose
for the paused state. That follows from the fallback being evaluated per state
and short-circuited by the consumer's value in all of them: naming a control is
taken as ownership of the name, not as a per-state override.

**`SeekSlider`'s name is relocated, not duplicated.** Its props are the wrapper
`<div>`'s, since it renders buffered geometry around the input, so
`<Player.SeekSlider aria-label="Buscar" />` type-checked cleanly, landed the name
on an element with no role, and left the input announcing `"Seek"` — nothing from
the compiler, nothing at runtime, and nothing in the shipped docs said so. A
top-level `aria-label` is now written onto the inner `<input type="range">`, and
the wrapper no longer receives it: the same string on both elements is one of
them saying it twice. `VolumeSlider` and `SeekSlider` therefore answer the same
consumer code the same way, which is the rule the README now states.

**Precedence, pinned by test.** `inputProps['aria-label']` outranks a top-level
`aria-label`, which outranks the built-in `"Seek"`. The nested object is the more
specific of the two — it names the element it is written for — and it keeps
working exactly as it did.

**Scoped to the name.** No general mechanism for relocating wrapper props to the
input was added, and none is wanted: `className`, `style`, `data-*` and every
other top-level prop still land on the wrapper, and `inputProps` remains the
route for everything input-level. Which element a prop lands on stays one rule
with one exception, rather than a per-prop table.

**No default wording changed.** With no consumer name supplied, all seven
controls render byte-identical labels to the previous release, in every state.

**Documentation.** `inputProps` appeared nowhere in any shipped README or doc —
the reasoning for which attributes the library keeps existed only in the source,
where a consumer cannot read it. `@playdeck/react`'s README now documents the
escape hatch, the precedence order, and the rule that a consumer label wins on
every control.

**Why `minor` and not `patch`.** No API broke and no type widened, but a
released package renders something different for consumer code that already
compiled: an `aria-label` that was previously discarded now takes effect, and
`SeekSlider`'s wrapper no longer carries an attribute it used to render. A test
or selector asserting on either sees the change. That is observable on purpose.
