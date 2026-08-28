---
'@playdeck/react': minor
---

The icons now have a props type a consumer can import, `IconProps` (#478).

**What a consumer got before.** The icons are public components — they reach the
entry through a re-export of the icons module — but their props alias was
declared without the `export` keyword. So a wrapper around one had to restate
`SVGProps<SVGSVGElement>` from memory, while elsewhere in the package an
exported component shipped a type to import. The README's own list of props
types carved the icons out as the exception that needed none.

**One shared type, not one per icon.** The icons accept the same props, and a
name each is a difference a reader has to check for and never finds. This is
the package's one departure from a props type per component, and it is the
honest description of what is there.

The type is additive: nothing an icon accepts changes, and no export is
removed.
