---
'@reely/core': minor
'@reely/react': minor
'@reely/provider-native': minor
'@reely/provider-hls': minor
'@reely/provider-youtube': minor
'@reely/provider-vimeo': minor
---

Add `PlayerState.commandsReady` and `PlayerController.whenReady()`. Each
provider declares for itself when a command will be accepted and will not be
undone by a pending load, which core cannot derive — the four adapters open
their command guards at four different moments. Commands issued before that are
still refused with `{ ok: false, reason: 'not-ready' }`; this adds a signal to
await rather than changing any behaviour. `whenReady()` is also on the React
player actions and the `Player.Root` ref handle.
