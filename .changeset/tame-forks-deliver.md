---
'@playdeck/react': patch
---

Deliver a volume or seek value requested right after a provider swap

`createCommandChain` (`optimistic-request.ts`) tags a value queued behind an
in-flight command with the generation live at the moment it is queued. When
the in-flight command drains, the chain compares that tag against the current
generation: a value tagged with a generation `invalidate()` has since moved
past is discarded, aimed as it was at media that is gone, while a value
tagged with the current generation is delivered to whatever provider is
current when the drain happens. `VolumeSlider` and `useSeekPreview` share this
chain, so a volume or seek change requested for a new provider, made while
the previous provider's command is still settling, reaches the new provider
once that command drains instead of being discarded alongside the stale
value.
