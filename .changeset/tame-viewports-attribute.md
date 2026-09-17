---
'@playdeck/react': patch
---

Attribute an engine's own viewport resume to autoplay, not a takeover

`use-activation.ts`'s ownership tracker read a `play` event's origin off
`event.origin` alone: `'autoplay'` kept the viewport's ownership, any other
origin dropped it to `'none'`. On WebKit, which manages viewport playback of
muted autoplaying video itself, a re-entry resume can arrive as a play
Playdeck never issued -- no pending origin for `PlayerController` to confirm
-- so it resolved as `'provider'` and ownership dropped. From that point a
`loading: 'viewport'` player never auto-paused again on WebKit, the first
time it scrolled back into view (#695).

A `'provider'` play now keeps ownership too, under one condition: ownership
already reads `'auto-paused'`, which only this hook's own exit pause ever
sets. That is an engine resuming exactly the playback it paused, not a
takeover, and it holds regardless of which engine or code path left the
pending origin unconfirmed. A genuine takeover is unaffected: a viewer's or a
caller's play is confirmed through a pending origin and arrives as `'user'`
or `'api'`, never falling back to `'provider'`; and outside `'auto-paused'`,
an unconfirmed `'provider'` play still drops ownership exactly as before.
