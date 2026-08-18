---
'@playdeck/react': patch
---

`SettingsMenuContent` now defaults its content root to `tabIndex={0}`. Bound
the menu's height — which any real player must, once a quality ladder and a
rate list are both present — and it becomes a genuinely scrollable region;
every menu item carries `tabIndex={-1}` for roving focus, so there was no
tabbable descendant either, and axe reported `scrollable-region-focusable`
(impact serious, WCAG 2.1.1) with the lower entries reachable only by arrowing
until focus pushed the scroll. Nothing in the primitive's type or behaviour
flagged the requirement, so every consumer who bounded the menu shipped the
violation until they rediscovered the fix. `Player.CaptionsMenu`, a preset over
the same content primitive, was affected identically and is covered by the same
default.

A consumer-supplied `tabIndex`, `-1` among them, still wins, matching
`Player.Controls`' existing `tabIndex ?? 0`. Nothing else moves: opening the
menu still focuses the first item so the root is never the landing spot,
Escape still closes and returns focus to the trigger, Arrow/Home/End still move
among items, Tab still closes and lets focus leave, and the items keep
`tabIndex={-1}`, so no per-item stop is added. The content root itself is a
tabbable node while the menu is open — that is the whole point — but the Tab
order a user actually traverses is unchanged: a closed menu renders nothing at
all, and Tab from inside an open one closes it before focus can reach the root.

A tabbable root is also a click target, so it can hold focus with no item
current — clicking the menu's padding does it. From there ArrowDown moves to
the first item and ArrowUp to the last, rather than wrapping from a
nonexistent current item onto the second-to-last one.

It lands as `patch`, not `minor`: this is a behaviour correction on a prop the
consumer can still set to anything, including back to the previous effective
value. Nothing documented is taken away — unlike the `SeekSlider`
`aria-disabled` change, which claimed ownership of an attribute the `inputProps`
hatch used to pass through, `tabIndex` stays fully the consumer's to control.
