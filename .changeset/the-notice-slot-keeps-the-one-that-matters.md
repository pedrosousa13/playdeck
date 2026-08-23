---
'@playdeck/core': minor
'@playdeck/provider-vimeo': minor
'@playdeck/provider-wistia': minor
'@playdeck/provider-youtube': minor
'@playdeck/react': patch
---

`PlayerState.error` now keeps the most important **Notice** of an attach rather
than the first one reported (#368).

A notice is a non-fatal `configuration` error reporting a value that was
rejected while the fall-back it degraded to stands unchanged. The state has one
error slot and no event carries the loser, so an adapter that rejects two
options in one attach has one of them silenced for good — and until now that was
whichever it happened to check first. A cosmetic refusal reported early
therefore hid a security- or privacy-relevant one reported after it: exactly
what #332 fixed for Wistia by reordering two checks, a fix that held the
instance and left the mechanism.

Notices are now ranked. `PlayerError` carries an optional
`severity: PlayerErrorSeverity` — `'protective'` where a control that protects
the viewer fired (an untrusted URL blocked, a privacy opt-out that did not
take), `'presentational'` where a cosmetic option was ignored — and the slot
keeps the highest severity whatever order the notices arrived in. Ties are
settled by a fixed precedence rather than by arrival — the notice already
standing in the slot, then the provider's own notice, then a refused consumer
URL, the order #330 recorded — so a single attach still cannot flap the slot.
The rule governs a provider's notice against a refused consumer URL as well,
which was the one masking path #332 never covered: a refused URL is protective,
so a cosmetic provider notice no longer takes the slot from one, and where the
two tie and are resolved in the same pass the provider's own notice wins.

The field is optional and an absent severity ranks as `'presentational'`, so a
provider adapter outside this repo emitting a notice without one keeps working
and displaces nothing. Every notice this repo emits declares one: the five
refused-URL surfaces, Wistia's `poster` and YouTube's `host` and Vimeo's
ineffective `suppressSeoMetadata` are protective; Wistia's `playerColor` and
Vimeo's incomplete chromeless probe are presentational.

**No message changed and no notice stopped being emitted.** What changed is
which of two an operator observes where an attach reports both. The
hand-placed orders that used to carry this — Wistia's poster-before-colour,
Vimeo's suppression-before-probe — are correct and stay as they are; they are
simply no longer what the outcome rests on.

`@playdeck/core` also exports `isNotice(error, lifecycle)`, the one rule that
tells a notice from a failure. The controller and `ErrorDisplay` both apply it,
and a consumer rendering `PlayerState.error` itself can now classify an error
exactly as the bundled surface does instead of restating the rule.

`@playdeck/core` and the three provider packages land as `minor` rather than
`patch` for the reason #319 and #332 did: no API was removed or narrowed, but
what a released package reports did — an attach that rejects two options now
surfaces the other one of them — and a behaviour change should not arrive as a
patch. Core carries public additions besides, which `minor` answers to on their
own: `PlayerErrorSeverity`, the optional `severity` field on `PlayerError`, and
the `isNotice` export.

`@playdeck/react` takes `patch` because nothing it renders moved.
`ErrorDisplay` gave up its own copy of the notice rule for core's `isNotice`,
which is the same three clauses in the same order, so every error classifies
exactly as it did and every overlay falls exactly where it fell; the
`use-activation.ts` change is comments only, and `setActivation` still ranks
nothing. What a React consumer observes differently is state core publishes, and
it arrives through the dependency rather than from this package.
