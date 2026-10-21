---
'@playdeck/react': patch
---

Under `loading="eager"`, a player whose `Player.Viewport` has no layout box at all (`display: none`, for a player hidden at some breakpoint) holds there on hydration: no autoplay attempt, no provider load. Once the viewport gets a layout box — a resize across a breakpoint, say — the player continues exactly as an `eager` player that was visible from the start. The check is `getClientRects().length === 0`, which catches `display: none` but not `visibility: hidden` or `content-visibility: hidden`; both of those still generate a box. The server cannot know about CSS either way: a `video` file source's own request already left with the HTML parser before any of this runs, hidden or not. For a player that may be hidden at some breakpoint, `loading="viewport"`, or no `priority`, is the better fit than `eager`.
