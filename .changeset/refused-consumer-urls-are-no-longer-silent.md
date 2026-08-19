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

`PlayerController` gains one method, `setRefusedUrl(surface, refused)`. It takes
a closed union naming the prop — `'poster src'`, `'poster srcSet'`,
`'nativePoster'`, `'textTracks src'`, `'mediaSession artwork'` — and never the
URL. That union is `RefusedUrlSurface`, the one addition this change makes to
`@playdeck/core`'s public surface. The message is built in core from that key
alone, so a refused value cannot be carried into an error that a monitoring
system may log or `ErrorDisplay` may render.

The method is declarative, not a fire-once report: it states whether that one
prop stands refused **right now**. Replace a poisoned CMS value with a good one
and the notice is withdrawn; the controller tracks the refused surfaces as a set
and publishes a notice exactly while that set is non-empty. A notice that could
never be cleared would be a permanent false positive, and an operator who cannot
clear a security notice learns to ignore all of them — which is the monitoring
failure this change exists to fix. Restating what the controller already knows
costs nothing, so the React effects and the media-session binding that call it
may re-run freely.

Several surfaces can stand refused at once and the state has one error slot, so
the published notice is the first refused surface in the order the union
declares — `poster src`, `poster srcSet`, `nativePoster`, `textTracks src`,
`mediaSession artwork` — never the order the reports arrived in. Report order
depends on where a consumer placed `PosterImage` in the tree and on whether the
pass is a mount or an update; the same poisoned fields should always produce the
same message.

A refused consumer URL is scoped to the controller rather than to a provider,
unlike a provider's own notice. It has to be: a poster reports from its mount
effect, which in the ordinary flow runs before the provider module has finished
loading, so a provider-scoped report would be wiped by the very next attach. It
also ranks below a provider's notice, and below any standing error.

`PosterImage` reads the player context optionally rather than through
`usePlayer()`, so a poster rendered outside `Player.Root` keeps working and
simply has nothing to report to.
