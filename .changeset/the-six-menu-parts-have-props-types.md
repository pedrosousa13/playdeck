---
'@playdeck/react': minor
---

`SettingsMenuProps`, `SettingsMenuTriggerProps`, `SettingsMenuContentProps`,
`MenuItemProps`, `MenuRadioGroupProps` and `MenuRadioItemProps` are now declared
and exported from the package entry (#438). Every other composed primitive in
the package already shipped one; these six did not, and not because the export
was forgotten — they took their props inline and anonymously, so there was no
name to export. A consumer importing `MenuItemProps` got `TS2305`, and the
README's own claim that every part has a matching props type was false for these
six — and for the icons, whose shared props type is likewise declared without
being exported.

It was false where it costs the most. The package ships no playback-rate or
quality menu, and the README sends a consumer to these parts to compose one, so
a wrapper around them is expected consumer code — and a wrapper needs a name for
what it accepts. `ComponentProps<typeof Player.MenuItem>` worked and still does,
but it is a workaround for a missing export rather than the surface the rest of
the package presents.

**Naming and exporting only.** Each type is the annotation the part already
carried, moved above it and given a name: `SettingsMenu`, `SettingsMenuTrigger`
and `SettingsMenuContent` are their element's `ComponentPropsWithRef`
unchanged, and `MenuItem`, `MenuRadioGroup` and `MenuRadioItem` keep the same
intersections — `onSelect`, `value` with `onValueChange`, and `value` — with the
same optionality. Not one of the six gained a prop, lost one, or changed what it
does with any of them, and the rendered output is byte-identical.

`minor` rather than `patch` because the published API gained six members. The
README's claim was made true rather than corrected downwards, which is what the
issue asked for: the parts are presented as composition primitives, and a
composition primitive whose props cannot be named is hard to build on. The same
sentence now also says what the icons take, since those are SVG components with
no props type of their own to import.
