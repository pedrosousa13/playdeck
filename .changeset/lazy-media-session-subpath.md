---
'@playdeck/core': minor
'@playdeck/react': patch
---

Reach Media Session binding through a subpath `Root` imports lazily

`@playdeck/core` gains a second export subpath, `@playdeck/core/media-session`,
exposing `bindMediaSession`, `getMediaSessionCoordinator` and their types --
built as its own bundle, the same way `@playdeck/core/thumbnails` already is.
Both functions and every type stay exported from `@playdeck/core` itself too,
so a direct import needs no rework.

`@playdeck/react`'s `Root` reaches that subpath through a dynamic `import()`,
from inside the effect that binds the session to `navigator.mediaSession`.
The import starts right after mount and never on the server or during
render, so the module leaves the eager graph a page ships before any
provider attaches. An unmount (or a source swap starting the next effect
run) ahead of that import settling never binds, so nothing it would have
released stays bound.

The coordinator registry that enforces one coordinator per
`navigator.mediaSession` now lives on a well-known global rather than this
module's own top-level scope, so the main entry's inlined copy and the
subpath's own bundled copy -- and two installed copies of `@playdeck/core`
entirely -- resolve the same registry for the same session instead of two
coordinators unaware of each other.

Lock-screen behaviour once bound carries over exactly, with no new request
before the first play under `eager` or `viewport` loading. The "Playdeck (no
parts)" comparison row drops from 23.13 KB to 22.56 KB gzip, with
`@playdeck/core/media-session` now its own chunk a provider-only build
downloads only after mount.
