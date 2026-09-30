---
'@playdeck/react': minor
---

Add `LiveIndicator`, a live-playback status badge

`PlayerState.live` (`PlayerLiveState`, `@playdeck/core`) already existed, but
no shipped part surfaced it — the comparison page's live-streaming cell was
marked amber for want of one.

`Player.LiveIndicator` renders a `live` part: `data-state="at-edge"` while
the viewer is at the live edge and `data-state="behind-edge"` once they have
fallen more than the shared ten-second tolerance behind it
(`deriveLiveState`, `packages/core/src/live-state.ts`). It renders nothing
when `state.live` is `null` — not live, or liveness not yet known; there is
no third `data-state` for "not live", since `PlayerLiveState` is non-null
only when `isLive` is `true`.

Structurally a `<button type="button">`, and `disabled`: seeking to the live
edge is not built yet, so a press here would do nothing today. The contract —
markup shape, state attribute, and props — is written so live-edge seeking can
be wired onto it later rather than having to replace it.

No `@playdeck/core` or provider package changes: `PlayerState.live` and
`deriveLiveState` already existed everywhere.
