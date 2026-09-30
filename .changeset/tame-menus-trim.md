---
'@playdeck/react': patch
---

Remove a dead `captions-menu` selector from both shipped stylesheets

`theme.css` and `docked.css` each carried three or four rules keyed to
`[data-playdeck-part='settings-menu'], [data-playdeck-part='captions-menu']`
(the popover geometry, the phone bottom-sheet, and the forced-colors and dark
overrides). No primitive ever renders a `captions-menu` part: `CaptionsMenu`
is a preset assembly over `SettingsMenu`/`SettingsMenuContent`, which emit
`settings-menu-root` and `settings-menu` — the same parts a standalone
`SettingsMenu` renders. The `captions-menu` branch was inert CSS in both
files, and it misled a reader into thinking a distinct part existed.

Both stylesheets now key those rules to `settings-menu` alone. Nothing a
consumer can observe changes: the selector's other branch already carried
every one of these rules' declarations, and `CaptionsMenu` was always styled
through `settings-menu`, never through the dead name.
