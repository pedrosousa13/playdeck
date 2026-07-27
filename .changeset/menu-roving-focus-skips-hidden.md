---
'@reely/react': patch
---

`SettingsMenu`'s roving focus now skips menu items hidden with `display: none`.
A consumer hiding an entry with CSS — a container query that folds a control
into the menu at one width and back out at another — left the element in the
DOM and in the focus ring, so `.focus()` silently did nothing: wrapping from the
first item landed on the hidden entry, which made ArrowUp at the top of the menu
and `End` dead keys. The visibility test is on the item itself, not its
ancestors, because `checkVisibility()` is newer than the declared support floor.
