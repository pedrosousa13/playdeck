---
'@playdeck/react': minor
---

Read the button row's touch-target floor from `--playdeck-control-min-size`, not `--playdeck-control-size`

`controlTargetStyle`'s inline `minWidth`/`minHeight` and every button-shaped
part's `inline-size`/`block-size` class rule read the same token,
`--playdeck-control-size`. That let a consumer's own override of the token
shrink the floor along with the size, so the documented 44px minimum touch
target (Theme.mdx: "a smaller value is clamped up rather than obeyed") did
not hold — measured directly, `--playdeck-control-size: 2.25rem` on an
ancestor produced a 36px control, not a 44px one clamped up.

`controlTargetStyle` now reads `var(--playdeck-control-min-size, 2.75rem)`
instead, a token neither stylesheet declares on its own. The default is
unchanged: a bare consumer with no stylesheet loaded still gets a 44px
floor, and `--playdeck-control-size` alone can no longer undercut it.
`theme.css` and `docked.css` set the new token to `2.5rem` alongside
`--playdeck-control-size` in their own "below 48rem" query, so the phone
row-two fix (#598) that shrinks the button row to a 40px target is
unaffected — that query is the one place besides the desktop default that
moves the floor.
