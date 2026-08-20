---
'@playdeck/react': minor
---

`loading="interaction"` now reports a refused `source` the way `eager` and
`viewport` already did. Source detection turning a URL down **is** the security
control — it is where `javascript:`, `data:` and tab-split scheme smuggling are
rejected — and two of the three loading strategies published that refusal as an
`unsupported` error while the third checked only whether `autoplay` had been
combined with it. The consumer's own code is identical in all three cases, so
whether a poisoned `source` prop was observable at all depended on an unrelated
prop. Under `interaction` the player sat at `activation: 'dormant'` with
`error: null`, which is indistinguishable from "the viewer has not clicked yet":
nothing to render, nothing to log, and a play button that did nothing forever.

**Nothing about the refusal itself changed.** No provider was constructed for a
refused source before this and none is now; no URL was fetched and none is. The
error is the same record the other two strategies publish — `unsupported`,
`fatal: false`, and the same message text — with one field changed for all
three, described under its own heading below.

The refusal is reported **ahead of** the `interaction`-with-autoplay
configuration conflict when both are true at once. `setActivation` carries one
error, and the order matters: a security-relevant refusal masked by a complaint
about an unrelated cosmetic prop is what #332 reported in the Wistia notice
slot, where the same order-first rule settled it. Source first is also the
order `eager` and `viewport` already check in. Neither error is lost — fix the
source and the autoplay conflict is what you are told next.

The interaction path also refuses to **arm** on a refused source. Publishing the
error alone would not have been enough: `activateFromInteraction` would have
taken the error branch, committed to `eligible` and cleared the error — putting
the player back at the silent dead end this change removes, one call later. The
session guards could not catch it, because they compare a source key that is the
same constant for every detection failure.

## A refused source no longer offers a retry — under `eager` and `viewport` too

The refused-source error changes from `recoverable: true` to
`recoverable: false`. `recoverable` is the one flag `ActivationButton` and
`ErrorDisplay` read to decide whether to offer a retry (#34, #198), and a retry
here cannot work: it re-reads the same `source` prop, and the allowlist refuses
the same URL again. An enabled control that does nothing is the affordance this
change exists to remove, so the honest answer is to withhold it —
`ActivationButton` renders `aria-disabled` and `ErrorDisplay` renders no retry
button at all.

**This is deliberately wider than `interaction`.** All three strategies publish
this error, so all three lose that retry, and a consumer on `eager` or
`viewport` will see a retry button that used to be enabled become disabled (or,
in `ErrorDisplay`, disappear). Those two strategies had the same defect all
along: the button armed a source the library had already refused. Nothing else
is affected — the other `unsupported` error `useActivation` publishes, for a
missing `IntersectionObserver`, is about the environment rather than the URL and
stays `recoverable: true`. If you branch on `error.recoverable` yourself, that is
the one field to re-check.

This changes what an existing composition renders: a player whose `source` was
being refused under `interaction` showed nothing and now enters the error
lifecycle, so `ErrorDisplay` paints its overlay for it as it does under the other
two strategies. That is the point of the change rather than a side effect of it —
the alternative is a player that cannot play and says so nowhere. It is not a
Notice and does not render as one: a notice is a `configuration` error published
beside a fall-back that still works, and there is no fall-back here.

It lands as `minor` rather than `patch`: no API changed, but a consumer who saw
no error now sees one, and a released behaviour change should not arrive as a
patch.
