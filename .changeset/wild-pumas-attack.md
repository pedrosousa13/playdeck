---
'@playdeck/react': patch
---

Stop a bundler pruning `import '@playdeck/react/theme.css'`

`sideEffects` listed `./esm-only.cjs` and nothing else. An array is exhaustive:
every other shipped file, `theme.css` among them, was declared side-effect-free.
A bare stylesheet import binds nothing, so with no side effect left to preserve
a bundler is entitled to drop it, and the consumer gets an unstyled player in
their production build with no error at build time and none at runtime. The dev
server does not tree-shake, so it looks correct there.

The array now also carries `*.css`.
