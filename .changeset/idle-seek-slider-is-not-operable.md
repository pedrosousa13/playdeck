---
'@playdeck/react': minor
---

`SeekSlider` now exposes its idle state to assistive technology. While the
`seek` capability is available but no seek window can be derived — no positive
duration and no seekable extent — its `[data-playdeck-part='seek-slider-input']`
range control carries `aria-disabled="true"`, its `aria-valuetext` reads
`Unavailable` instead of `0:00`, and a change event on it issues no seek.
Previously the control announced a position it did not have and silently
accepted scrubs that went nowhere, with the state reaching CSS through
`data-state="idle"` and nothing else (WCAG 2.2 AA 4.1.2). It is `aria-disabled`
and not the native `disabled` attribute on purpose: the state flips the moment
the media reports a duration or a seekable extent, and `disabled` would drop the
control out of the tab order and move focus out from under a keyboard user each
time. `aria-disabled` joins `value`/`min`/`max`/`type`/`aria-valuetext` as an
attribute the library owns against `inputProps`.

It lands as `minor`: every package is still at `0.0.0` with `first-prerelease`
not yet released, and under 0.x `minor` is the channel a breaking change travels
on. It is breaking because that last sentence takes an attribute away from the
consumer. `aria-disabled` on `[data-playdeck-part='seek-slider-input']` was
settable through the documented `inputProps` escape hatch and was applied as
passed; it is now owned by the library, which strips it wherever a seek window
exists and forces `true` wherever none does. A consumer disabling the control
for reasons of its own through that hatch no longer has it honoured.
