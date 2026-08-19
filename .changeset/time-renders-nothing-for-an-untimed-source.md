---
'@playdeck/react': patch
---

`Player.Time` renders nothing for `type="duration"` and `type="remaining"` on a
source with no duration (#248). It used to render a literal `0:00`, which a
viewer reads as a zero-length video rather than a live stream — and it did so on
exactly the sources where a running clock beside it makes the claim look
authoritative. `type="current"` is untouched: `currentTime` means the same thing
on a live source as on a VOD one.

Nothing is substituted for the text. `data-state="untimed"` was already on the
element and still is, so a consumer who wants a `LIVE` badge, an em dash or an
elapsed-time fallback composes it in their own layout off that attribute, or by
passing `children`, which still win over the rendered time. This is the line
`.out-of-scope/default-presentation-on-blocked-autoplay.md` draws: publish the
state, do not materialise a presentation inside someone else's design.

The `datetime` attribute is omitted in the same case rather than left at `PT0S`.
That value was the same zero-duration claim as the text, in the form a machine
reads, and it is the half of the defect a consumer could not have worked around
with `children`. An untimed `<time>` now carries neither a `datetime` nor a
parseable time, which is invalid by the letter of the element's rule — taken
deliberately, because the only conformant alternative is to state a duration
this source does not have, and absence over a zero is how this library already
reports the unmeasured (ADR-0002).

A source is untimed on the existing test — a `duration` that is not a finite
number — so both a `null` duration and the `Infinity` a live HLS stream
publishes are covered, and a genuine zero-second source still renders `0:00`.
