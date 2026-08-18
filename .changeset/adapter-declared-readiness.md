---
'@playdeck/core': minor
'@playdeck/react': minor
'@playdeck/provider-native': minor
'@playdeck/provider-hls': minor
'@playdeck/provider-youtube': minor
'@playdeck/provider-vimeo': minor
---

Add `PlayerState.commandsReady` and `PlayerController.whenReady()`. Each
provider declares for itself when a command will be accepted and will not be
undone by a pending load, which core cannot derive — the four adapters open
their command guards at four different moments. Commands issued before that are
still refused with `{ ok: false, reason: 'not-ready' }`; this adds a signal to
await rather than changing any behaviour. `whenReady()` is also on the React
player actions and the `Player.Root` ref handle.
