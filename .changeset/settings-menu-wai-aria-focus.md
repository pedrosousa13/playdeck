---
'@playdeck/react': patch
---

Match the WAI-ARIA menu button pattern for ArrowUp and a removed focused item

`SettingsMenuTrigger`'s ArrowUp opens the menu with focus on the last item,
matching the WAI-ARIA menu button pattern; ArrowDown, click, Enter and Space
focus the first item.

If the item holding focus is removed from an open menu's roving-focus list —
`QualityMenu` or `AudioTrackMenu` re-rendering with a shorter list while one
of their rungs or tracks is focused — focus follows the WAI-ARIA APG
rearrangeable-listbox precedent: it moves to the item now occupying that
index, or the new last item if the removed item was last, or the menu closes
and returns focus to the trigger if none remain. Escape, the arrow keys,
Home and End keep operating the menu in every case; focus that has moved
elsewhere on purpose — to the menu's own root, or to an element outside the
menu while it stays open — is left alone.
