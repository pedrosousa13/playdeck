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
URL. That union is `RefusedUrlSurface`, the one addition this change makes to
`@playdeck/core`'s public surface. The message is built in core from that key
alone, so a refused value cannot be carried into an error that a monitoring
system may log or `ErrorDisplay` may render.

The method registers a standing refusal and returns a disposer. The notice is
published while any registration stands and is withdrawn only by the reporter
that made it, so fix the poisoned CMS field and the notice goes — a notice that
could never be cleared would be a permanent false positive, and an operator who
cannot clear a security notice learns to ignore all of them, which is the
monitoring failure this change exists to fix. Registration is per reporter and
not per prop because a prop name is not a component instance: two `PosterImage`s
under one `Player.Root` both hold a `src`, and the one holding a permitted value
must not be able to withdraw the other's notice. Each call site registers from an
effect and returns the disposer as that effect's cleanup, so a refusal is
withdrawn exactly when the value turns permitted or the component holding it goes
away, and nothing is left standing that no live reporter owns.

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
never displaces a standing error. Against a provider's own notice the single
error slot decides by arrival, not by rank: a provider notice resolved in the
same pass as a refused URL wins, but a refused URL already published keeps the
slot against a provider notice that arrives after it, until a later patch clears
the slot and the two are ranked together. That first-one-wins is the single-slot
behaviour #332 owns; this change makes it reachable from one more direction and
does not settle it.

`PosterImage` reads the player context optionally rather than through
`usePlayer()`, so a poster rendered outside `Player.Root` keeps working and
simply has nothing to report to.
