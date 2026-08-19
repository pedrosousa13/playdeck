---
'@playdeck/core': minor
'@playdeck/react': minor
---

The five consumer-supplied URL props the shared allowlist refuses now publish a
**Notice** instead of dropping the value in silence: `PosterImage`'s `src` and
each `srcSet` candidate, `Media`'s `nativePoster` and each `textTracks[].src`,
and `bindMediaSession`'s artwork `src`. All five were routed through
`isPermittedSourceUrl` without one, three hours after the library's rule that a
refused consumer value must be observable was written and applied to `host`,
`playerColor` and the provider-side `poster`. A poisoned CMS field was blocked
correctly and left no trace anywhere — no error, no event, no console output —
so the only symptom was a missing thumbnail.

**Nothing about the refusal changed.** The value is still dropped exactly as an
absent prop would be: no attribute, no `<track>`, no throw, no lifecycle move,
and a poster given only refused values still settles in `data-state="idle"`.
This is the detection half only.

`PlayerController` gains one method, `reportRefusedUrl(surface)`. It takes a
closed union naming the prop — `'poster src'`, `'poster srcSet'`,
`'nativePoster'`, `'textTracks src'`, `'mediaSession artwork'` — and never the
URL. The message is built in core from that key alone, so a refused value cannot
be carried into an error that a monitoring system may log or `ErrorDisplay` may
render. First report wins and a repeat is inert, so the React effects that call
it may re-run freely.

A refused consumer URL is held for the controller's life rather than the
provider's, unlike a provider's own notice. It has to be: a poster reports from
its mount effect, which in the ordinary flow runs before the provider module has
finished loading, so a provider-scoped report would be wiped by the very next
attach. It also ranks below a provider's notice, and below any standing error.

`PosterImage` reads the player context optionally rather than through
`usePlayer()`, so a poster rendered outside `Player.Root` keeps working and
simply has nothing to report to.
