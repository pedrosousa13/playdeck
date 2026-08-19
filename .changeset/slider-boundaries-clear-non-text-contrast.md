---
'@playdeck/react': patch
---

`theme.css` raises the default alphas of `--playdeck-color-track` and
`--playdeck-color-buffered` together, from `0.3` and `0.5` to `0.36` and `0.7`, so
every seek-slider boundary the theme paints clears the 3:1 floor WCAG 2.2 AA
1.4.11 puts under the visual boundary of a user-interface component (#190).
Composited over the `--playdeck-color-backdrop` default of `#000`, the unfilled
track moved from 2.46:1 to 3.13:1 and the loaded range moved from 2.14:1 to
3.18:1 against that track. Both stay white at an alpha: no hue, no opaque
colour, and no hairline or outline was added to the slider parts.

The two tokens had to move together. The track alone failed the reported check,
but raising only the track narrows the loaded-vs-unloaded boundary — itself a
1.4.11 concern, and already failing at 2.14:1 — to roughly 1.9:1, fixing the
reported defect by worsening an unreported one.

It lands as `patch`. Nothing about the documented surface changes: both values
are still read as `var(--name, default)` and are still never declared by this
file, so a token you set on the player or any ancestor is what applies and the
new defaults are never consulted. Only a consumer who mounts the theme and
overrides neither token sees a difference, and what they see is the correction.
The forced-colors branch, which maps these parts onto system colour keywords, is
untouched.

`packages/react/test/theme.test.ts` now composites the token defaults it parses
out of the shipped stylesheet, and asserts both boundaries against the 3:1 floor
plus the exact ratio of all six slider boundaries — so a default cannot move
without restating what it does. It is a computed check rather than an axe rule
on purpose: axe-core implements 1.4.3, which is text only, has no 1.4.11 rule at
all, and the composition the a11y suite scans never mounts this stylesheet, so
an axe run passes either side of this change and reports nothing.

Two boundaries are measured and deliberately not asserted. The thumb's
`--playdeck-color-accent` now reads 2.59:1 against the track (it was 3.29:1) and
1.23:1 against the buffered range (it was 1.53:1). Neither can reach 3:1 while
the accent stays `#3ea6ff`: at a relative luminance of 0.3552 it clears 3:1 only
against something at or below 0.0851, and the floor this change enforces puts
the track at or above 0.10 and the buffered range at or above 0.40. Against
opaque white — the brightest the buffered range could ever be — the accent still
measures 2.59:1. Raising either needs a decision about the accent token, which
is recorded on #190 and is not made here.
