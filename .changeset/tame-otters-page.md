---
'@playdeck/react': patch
---

Leave PageUp and PageDown to the page in global keyboard mode outside the player region

`Controls`' `global` shortcut layer handles `PageUp`/`PageDown` only where the
keydown's target sits inside the player boundary — `Player.Viewport`'s DOM
node where the region renders inside one, the region's own node otherwise.
Outside that boundary neither key is handled and neither call's default is
prevented, on any target: `<body>`, a plain scrollable element, or a widget
carrying a role such as `grid` or `tablist`. The rule follows the two keys
themselves rather than the actions bound to them, so a consumer who rebinds
either key to a different action gets the same in-region-only treatment.
Inside the boundary both keys seek ten seconds exactly as documented, and
scoped mode is unaffected.
