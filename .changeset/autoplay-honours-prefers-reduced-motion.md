---
'@playdeck/core': minor
'@playdeck/react': minor
---

Playdeck no longer starts playback on its own for a viewer who matches
`prefers-reduced-motion: reduce` (#311). Both `loading: 'eager'` and
`loading: 'viewport'` autoplay are declined — the rule is about motion the
viewer did not ask for, not about where on the page it happens. `PlayerState`
gains a sixth `autoplay` member, `'suppressed'`, and `Player.Root` gains an
`ignoreReducedMotion` prop that opts out.

**The mode stays configured; only the attempt is declined.** That distinction is
the whole implementation. The poster gate reads the configured autoplay mode as
an allow-list, so a suppressed autoplay keeps its poster over the frame through
`loadeddata` exactly as a refused one does. Clearing the mode instead would open
that gate and uncover a paused first frame with no cover over it and no gesture
that put it there — the defect fixed in #242, arriving by a different route.
Nothing else changes: `playback` stays where it was, `PlayButton` still starts
playback from a click, and `autoplayRecovered` is `false`, as it is for every
autoplay that did not start.

`'suppressed'` is its own member rather than a reuse of `'idle'` because `'idle'`
already means "no autoplay configured". Without it a consumer cannot tell an
autoplay that was suppressed from one that never existed, which is what a
"video paused for reduced motion" affordance needs to know. What the viewer sees
is unchanged — the existing poster surface, with no presentation Playdeck
invented for the occasion.

`ignoreReducedMotion` defaults to `false` and is named for what it does, so a
call site setting it reads as the deliberate accessibility trade-off it is. With
it set, autoplay behaves exactly as it did before this change.

The query is read fresh at the moment each player decides whether to attempt,
not subscribed to. A viewer who turns reduced motion on mid-session is honoured
by every player that has not yet decided; one who turns it off does not get
video retroactively starting at them. Where `matchMedia` is unavailable — server
rendering, a worker, an older engine — the query cannot match and autoplay
proceeds unchanged, so the browser-support floor is where it was.
