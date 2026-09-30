---
'@playdeck/react': patch
---

Stop `Controls`' focus-restoration effect from re-stealing focus after the user has left the player

`Controls` restores focus to itself when a capability-gated control (seek,
volume, fullscreen, or picture-in-picture) unmounts while it held focus, so
keyboard users do not lose their place. It could also fire after the user
had already, legitimately, left the player -- a click on non-focusable
page content, or the window itself losing focus -- calling `.focus()` on
the region and scrolling the page to it even though focus was correctly on
`<body>`.

`Controls` now tells a real abandonment apart from a control actually
being removed, regardless of how, or whether, the browser blurred the
control that lost focus, and the restore call passes `preventScroll: true`
so a legitimate restore never scrolls the page either.
