---
'@playdeck/react': minor
---

`Player.Root` gains an opt-in `priority` prop, off by default, for the player above the fold.

Set it and the player treats `loading`, `preload` and the poster together as one intent instead of three props set by hand. An omitted `loading` resolves to `'eager'`; an explicit `loading` other than `'eager'` is a configuration error instead, reported the same way the other activation conflicts are, rather than silently overridden. An omitted `preload` resolves to `'auto'`; an explicit `preload` always wins either way. The default poster `Player.Poster` renders from `Root`'s own `poster` prop gets `fetchPriority: 'high'` and `loading: 'eager'`, unless the poster already sets either field itself, and `Root` calls React 19's `preload()` for that same poster during render, so the server HTML carries a `<link rel="preload">` for it ahead of any script, for a poster URL the shared allowlist permits.

Off by default, server-render output is unchanged.
