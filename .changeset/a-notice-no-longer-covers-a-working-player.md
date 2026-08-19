---
'@playdeck/react': minor
---

`ErrorDisplay` no longer paints a full-bleed overlay for a **Notice** — a
non-fatal `configuration` error a provider publishes to report a value it
rejected, while the fall-back it degraded to stands unchanged. Nothing stopped
working, so covering a playing video with a `role="alert"` that carries no
retry reported a failure that had not happened. A notice now renders at
`data-playdeck-part="notice"` with no geometry, no stacking and no `role`, and
`notice-message` inside it by default. It carries the error category on
`data-state` like `error` does, and a consumer places it with their own `style`.

The gate is notice-ness — `category === 'configuration'`, not `fatal`, and not
in the error lifecycle — and deliberately **not** `fatal` alone. `fatal: false`
also covers `toProviderError` (`provider`, and `recoverable: true`, so it offers
a retry), Wistia's `policy` refusal and its `unsupported` refusal. Gating on
`fatal` would have silently suppressed all three, including the retry a consumer
relies on. Every failure keeps the overlay it had; only notices lose it.

The lifecycle clause matters as much as the category. A `configuration` error is
not always a notice: `useActivation` publishes one alongside
`activation: 'error'` for `loading="interaction"` with autoplay, and for
viewport activation without a `Player.Viewport`. Both mean the player will never
load, so both keep the overlay — without that clause they would have rendered as
an invisible notice, leaving a dead player with nothing on screen, which is the
defect this change removes rather than relocates.

The predicate mirrors `noticeIn` in `@playdeck/core`'s controller rather than
importing it: that one classifies a `ProviderStatePatch` on the way in, this one
classifies the published `PlayerState.error` on the way out. No new core export,
so nothing is added to that package's public surface.

This changes what an existing composition renders. The muted-autoplay
configuration conflict produced the identical overlay before this and is
included, which was the pre-existing case #319 recorded rather than something
introduced by the notices #235 added. A consumer who was relying on a
`configuration` error rendering as `error` should target `notice` as well —
`ErrorDisplay`'s render-prop child still receives every error, with `retry` as
`null` for a notice, because `configuration` is always `recoverable: false`
(#198).

It lands as `minor` rather than `patch`: nothing about the API changed, but what
the component puts on screen did, and a released behaviour change should not
arrive as a patch.
