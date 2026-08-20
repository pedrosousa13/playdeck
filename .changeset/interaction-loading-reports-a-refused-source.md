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

**Nothing about the refusal changed.** No provider was constructed for a refused
source before this and none is now; no URL was fetched and none is. This is the
reporting half only, and the error is the same record the other two strategies
publish — `unsupported`, `fatal: false`, `recoverable: true`, "The player source
is not supported." — so a consumer already handling it under `eager` handles it
here with no change.

The refusal is reported **ahead of** the `interaction`-with-autoplay
configuration conflict when both are true at once. `setActivation` carries one
error, and the order matters: a security-relevant refusal masked by a complaint
about an unrelated cosmetic prop is the failure #332 reports elsewhere in the
tree. Source first is also the order `eager` and `viewport` already check in.
Neither error is lost — fix the source and the autoplay conflict is what you are
told next.

The interaction path also refuses to **arm** on a refused source. Publishing the
error alone would not have been enough: `unsupported` is `recoverable: true`, so
`ActivationButton` offers an enabled retry, and `activateFromInteraction` would
have taken that retry, committed to `eligible` and cleared the error — putting
the player back at the silent dead end this change removes, one click later. The
session guards could not catch it, because they compare a source key that is the
same constant for every detection failure.

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
