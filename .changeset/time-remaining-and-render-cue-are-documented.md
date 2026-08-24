---
'@playdeck/react': patch
---

`Time`'s `remaining` variant and `Captions`' `renderCue` are documented in the
package README (#442). Both ship in the type declarations, and both were covered
only by the Storybook workbench — `Overview/Contract` and `Overview/Captions` —
which is published but is not what arrives in the tarball. A consumer reading
the README a package manager put in front of them found neither prop, and the
next place to look was a `.d.ts`.

`remaining` is a standard player affordance, and a consumer who concludes it is
absent reimplements it as `duration - currentTime` — which gets the untimed case
this component already handles wrong. The README now states all three `type`
values, that `remaining` carries a leading minus for as long as any remainder is
left, and what happens where there is no duration to measure against:
`data-state="untimed"` marks all three types, `current` included, because it
describes the source rather than the instance, while the element differs —
`duration` and `remaining` become a `<span>` holding only the children given to
them, and `current` stays a `<time>` because it still has an elapsed time to
show. Pairing that state with `data-time-type` is called out as the way to place
a live badge, since the state alone also matches the running `current`.

`renderCue` was named in `Overview/Captions` and nowhere else. Its signature,
the four-field `TextCue` a cue is stripped to before it reaches consumer code,
and the fact that supplying it drops the default styling from each cue's own box
— while the overlay positioning them keeps its own — are now in the README
beside the caption prose. That `Player.Captions` renders nothing
unless the provider hands caption rendering over is stated with it — a consumer
passing `renderCue` and seeing no cues is otherwise left guessing.

Documentation only. No behaviour changed, and no declaration moved.
