---
'@playdeck/react': minor
---

Add `loadThreshold` to `Player.Root`, alongside `loadMargin`. Under
`loading: 'viewport'` it sets the fraction of the player's box that must be on
screen before the provider attaches — an `IntersectionObserver` threshold from
`0` to `1` — where until now the activation observer took no threshold at all
and always attached at the first visible pixel. Defaults to `0`, so every
existing consumer keeps that behaviour unchanged.

A box taller or wider than the scroll container it moves through can never reach
a threshold near `1`: no amount of scrolling puts 100% of it on screen at once.
Rather than
leave that configuration dormant forever with no playback and no error, such a
box activates at the first visible pixel instead, the same fallback the
default already is for everything else.
