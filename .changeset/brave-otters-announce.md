---
'@playdeck/react': patch
---

Give `LiveIndicator` a default accessible name that carries the action

`LiveIndicator`'s default `aria-label` was "Live" in every state, so a
screen-reader user heard the same name whether or not pressing the part
would do anything -- the distinction between `data-state="at-edge"` and
`data-state="behind-edge"` reached a sighted viewer through the attribute
and reached assistive technology not at all.

The default is now "Go to live" only where pressing the part would act:
`capabilities.liveEdge` seekable and `data-state="behind-edge"`. Every other
state -- at the edge, or `liveEdge` unavailable -- keeps "Live". The visible
text stays "Live" throughout; "Go to live" contains it, satisfying WCAG 2.5.3
_Label in Name_. A consumer-supplied `aria-label` still wins in every state,
unchanged. No `aria-live` is added, and nothing is announced on a state
change by itself.
