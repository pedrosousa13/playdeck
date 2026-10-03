---
'@playdeck/react': patch
---

Load the volume-request binding through a dynamic import `Root` resolves lazily

`Root` reaches `createVolumeRequest` (`volume-request.ts`) through a dynamic
`import()` (`volume-request-lazy.ts`) rather than from its own `useState`
initializer, resolved the first time `VolumeSlider`'s own subscription or the
`Controls` shortcut layer's volume keys actually ask for it. A page that
renders no volume-reading part never downloads the binding or its own
private copy of the coalescing chain, `optimistic-request-volume.ts` --
`SeekSlider` keeps its own, unrelated copy, `optimistic-request.ts`, which a
page rendering it downloads regardless of whether it also renders a
volume-reading part.

A volume request made before the import resolves is never lost: the facade
records it and shows it at once, then replays it through the real binding's
own command chain once the module arrives, so the control a viewer is
looking at and the command the player eventually receives always agree. A
chunk that fails to load drops that request rather than hold it forever, so
the control falls back to the player's own reported volume, and the next
gesture tries the import again. `PlayerContextValue.volumeRequest`'s shape
and timing contract are otherwise unchanged -- it is internal, so no public
API moves.

No new request before the first play, no change to server rendering or
hydration. The "Playdeck (no parts)" comparison row drops from 22.62 KB to
22.42 KB gzip.
