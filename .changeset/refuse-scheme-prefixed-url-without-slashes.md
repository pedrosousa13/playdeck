---
'@playdeck/core': patch
---

The shared allowlist (`isPermittedSourceUrl`) refuses an `http:` or `https:` URL whose scheme is not immediately followed by `//`, not only inside `detectSource`'s bare-string path: an explicit `{ type: 'video', sources: [{ src }] }` entry, an `HlsSource.src`, and every consumer-supplied URL prop the allowlist already gates — poster `src` and `srcSet`, `nativePoster`, text-track `src`, `mediaSession` artwork and thumbnails — refuse the same input. A refused value is reported exactly as any other refused URL already is: a failed detection for a source, the existing refused-URL configuration notice everywhere else. Well-formed `http(s)://…`, root-relative, relative and protocol-relative URLs are unaffected.
