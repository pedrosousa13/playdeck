---
'@playdeck/core': minor
'@playdeck/react': patch
---

`Player.Poster` now stays over the frame when a play **command** is refused, not
only when an autoplay attempt is (#244). The `loadeddata` first-frame writer
added for #242 gates on the configured autoplay mode, so under `autoplay={false}`
it had no mode to read and the gate was inert: a `play()` the browser rejected
with `NotAllowedError` — from `handle.current?.play()`, from a `PlayButton`
press, or from any `usePlayerActions` consumer — left the media paused on the
frame it had just decoded, uncovered, with nothing on screen reporting the
refusal. That is the defect #242 fixed, arriving through a command instead of
through autoplay. Nothing about a refusal itself changed: it is still reported to
the caller that issued it and to nobody else, `playback` stays `paused`,
`autoplay` stays `idle`, and no error is set.

The race is covered with it. A `loadeddata` can land while the `play()` promise
is still in flight, and a promise in flight is a refusal not yet told — hide the
poster on the decode and the rejection that follows has no way to put the cover
back. An unsettled attempt therefore defers exactly as a settled refusal does.

`PlayerController` gains one method, `hasUnconfirmedPlayAttempt()`, and that is
the whole addition to `@playdeck/core`'s public API. It answers whether a play
command was issued against the media attached now and playback never reached
`playing` — refused, faulted, or still in flight — for whatever issued it: the
API, a user gesture, or autoplay's own attempt. The record is dropped the moment
a provider patch confirms playback, so a viewer who pauses does not re-arm it,
and it is scoped to the provider generation, so attaching a provider ends it and
the first frame of freshly attached media goes back to hiding the poster unaided.

It is a method on the controller rather than a field on `PlayerState` on purpose.
A refused command is a fact about the command, not about the player, and the one
thing that needs it is the React layer's first-frame poster writer; publishing an
attempt record to every consumer and every subscriber would be a permanent
addition to the state snapshot made to change what exactly one internal reader
does. `Player.Root` cannot count the calls itself either — `PlayButton` and every
`usePlayerActions` consumer reach `play` straight from the player context and
never through that component.

`@playdeck/core` takes `minor` for the new public member and `@playdeck/react`
takes `patch`: the React change is a defect fix behind an unchanged surface, the
same level #242's own fix took, and no React prop, part or published state moved.
