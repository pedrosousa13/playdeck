---
'@playdeck/core': minor
'@playdeck/provider-native': patch
---

Let a provider withdraw a configuration notice it published, so a retried `startTime` refusal does not outlive the reload that satisfies it

`PlayerController` held a provider's most important `configuration` notice
in a single field, cleared only when the provider was swapped, detached, or
destroyed. `retry()` applied a null error, but the patch that followed
refilled the slot from that still-set field, so the clear never survived its
own patch — the exact defect #418's `startTime` notice made reachable: a
`startTime` refused on one load, followed by a `retry()` whose reload
satisfied the offset, still reported the first load's refusal for the rest
of the provider's life.

`PlayerController`'s `subscribe` wiring now hands back a disposer for every
notice-carrying patch, the same shape `reportRefusedUrl`'s own disposer
already has — one mechanism, not two doing the same job. A provider holds it
and calls it once a later decision no longer needs the notice it published;
withdrawal is the provider's own act, never a side effect of retrying, so a
notice nothing withdraws — Vimeo's `suppressSeoMetadata`, decided once at
attach and never re-emitted — survives a `retry()` untouched.

`provider-native`'s `startTime` seam is the first caller: it withdraws its
own notice at the start of every load's decision, before deciding that load,
so a `retry()` whose reload reaches the requested offset leaves
`PlayerState.error` clear.
