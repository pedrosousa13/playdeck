---
'@playdeck/core': patch
'@playdeck/react': patch
'@playdeck/provider-native': patch
'@playdeck/provider-hls': patch
'@playdeck/provider-vimeo': patch
'@playdeck/provider-wistia': patch
'@playdeck/provider-youtube': patch
'@playdeck/docs': patch
---

Each package's README, and every page `@playdeck/docs` publishes from it, holds no em dash (U+2014): a colon, a comma, parentheses or a full stop carries the same sentence instead. `scripts/docs-package.mjs --check` refuses to publish a page that holds one, naming the file and line.
