---
'@reely/core': minor
'@reely/provider-youtube': minor
'@reely/provider-vimeo': minor
'@reely/provider-wistia': minor
'@reely/react': minor
---

`Player.Root`'s `startTime` and `endTime` props now bound a YouTube, Vimeo or
Wistia source. They used to travel only inside `NativePlaybackOptions`, which
`loadProvider` hands to the native and HLS providers and to no others, so
`<Player.Root startTime={30} />` on an embed began at zero and ran to the end of
the media (#214).

Both now take the route `loop` took in SIDEPRO-210: `Root` folds them into the
bag belonging to the detected source's own provider, and each of the three
embeds enforces the boundary itself. Playback starts at the start boundary,
reaching the end boundary publishes `ended` there rather than at the media's
end, the pause that produces is not reported as a pause, and `loop` restarts
from the start boundary instead of from zero. The embeds' own start expressions
— YouTube's `start` player var, Vimeo's `#t=` fragment, Wistia's `current-time`
attribute — are written as load hints so there is no visible seek after load,
but the adapter is the authority either way. No provider's native end mechanism
is trusted.

The sanitisation rules are the native provider's, unchanged and now identical on
all five: a start that is absent, non-positive or non-finite is no start; an end
that is absent, non-finite, or not above the start is no end; an end past the
duration is clamped to it. `@reely/core` gains the shared helper that states
them — `resolveTimeBoundary`, `boundaryStart`, `boundaryEnd`, `atBoundaryEnd`
and `withinBoundary`, plus the `TimeBoundary` type.

`PlayerProviderOptions` omits `startTime` and `endTime` from all three bags, so
the setting has one home (ADR-0004). Nothing that compiled before stops
compiling: no embed bag declared either key until now.

No new re-attach cost comes with this. Both values already took part in the
activation identity on every source type, so changing either mid-playback
already rebuilt the provider. Before this change the rebuild produced an
unbounded embed, the values having reached nothing; now it produces a bounded
one. Native and HLS are unchanged.
