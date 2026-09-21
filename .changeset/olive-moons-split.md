---
'@playdeck/core': minor
'@playdeck/react': minor
---

Load `SeekSlider`'s thumbnail preview only when a consumer sets `thumbnails`

`@playdeck/core` gains a second export subpath, `@playdeck/core/thumbnails`,
exposing `parseThumbnailCues`, `thumbnailCueAt` and the `ThumbnailCue` and
`ThumbnailRegion` types. All four stay exported from `@playdeck/core` itself
as well, so nothing a consumer writes today changes. The subpath is built as
its own bundle rather than as a second entry of the one beside it, which is
what keeps `dist/index.js` a single module every bundler can tree-shake the
parser out of.

`@playdeck/react` reaches the parser only through that subpath, from the
module it now loads on demand. `SeekSlider` imports its whole thumbnail path
— the cue fetch, the cue lookup, the crop geometry and the `thumbnail` part's
markup — through a dynamic `import()` started when the `thumbnails` prop is
present, the same trade `Player.Root` already makes for provider adapters. A
composition that renders a seek slider without the prop no longer downloads
any of it: the "Playdeck (control bar)" comparison row falls from 27.01 KB to
25.92 KB gzipped, and both bundlers the comparison runs agree on the size of
the drop.

Behaviour with the prop set is unchanged, with one timing difference worth
naming: the `thumbnail` part mounts when its module arrives rather than in the
same tick as the slider. It is `position: absolute` and starts hidden, so it
displaces nothing and paints nothing on arrival, and a hover or focus that
happens first is recorded and previewed as soon as the module is there. The
WebVTT file is still fetched on first interaction and never at mount.

The package's `dist` gains files a consumer's bundler resolves on its own:
`thumbnails.js` (the preview), and, in the no-build `./browser` entry,
`react.js` (React, now shared between that entry and the preview) and
`assets/thumbnails.js`.
