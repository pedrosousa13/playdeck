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

Lock-screen behaviour once bound carries over exactly, with no new request
before the first play under `eager` or `viewport` loading. The "Playdeck (no
parts)" comparison row drops from 23.13 KB to 22.53 KB gzip, with
`@playdeck/core/media-session` now its own chunk a provider-only build
downloads only after mount.
