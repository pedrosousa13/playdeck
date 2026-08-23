---
'@playdeck/provider-wistia': minor
---

The Wistia provider now checks `poster` before `playerColor` when it builds the
`<wistia-player>` element, so an attach that rejects both reports the poster
refusal rather than the colour one (#332).

Both options are validated where they become attributes, and each rejection
emits its own non-fatal `configuration` Notice. The controller keeps one such
Notice per attach — the first one wins, and it is dropped with the provider
that reported it — so with `{ playerColor: 'notacolour', poster:
'javascript:alert(1)' }` an operator was told only about the colour. The poster
refusal is the security-relevant half: it is the shared allowlist turning down
a `javascript:`, `data:` or `blob:` value, and it was never reported and never
would be. Checking the cosmetic option second makes "first wins" coincide with
"most important wins".

**Nothing about either refusal changed.** A rejected value still sets no
attribute — the same element state as omitting the option — the messages are
the same two records, and both are still emitted. What changed is which of the
two an operator observes on `PlayerState.error` in the one case where both are
rejected in the same attach. A consumer who sets only one of the options, or
whose values both pass, sees exactly what they saw before.

The ordering is the fix, so it is commented as load-bearing at the call site
and pinned by a test that fails if the two blocks are swapped back. The
controller's single slot is unchanged: ranking notices there was weighed and
declined as a concept addition disproportionate to the exposure, and Wistia is
the only provider that can emit two notices in one attach, so nothing else can
mask anything.

It lands as `minor` rather than `patch` for the reason #319 did: no API
changed, but what a released package reports did, and a behaviour change should
not arrive as a patch.

**Superseded in this release by #368.** The controller no longer decides its one
notice slot by arrival. `PlayerError` carries a `severity` and the highest one
holds the slot, so the ranking weighed and declined above is what shipped — in
the same release as this. The ordering here is still correct and stays exactly
as it is: the poster refusal is `protective` and the colour refusal
`presentational`, so "first" and "most important" agree. It is simply no longer
what the outcome rests on, and Wistia is no longer the only provider that can
emit two notices in one attach.
