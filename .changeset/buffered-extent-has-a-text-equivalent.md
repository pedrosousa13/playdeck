---
'@reely/react': patch
---

`SeekSlider` now states its buffered extent as text. The buffered geometry is
drawn by CSS-positioned `[data-reely-part='seek-buffered-range']` elements under
an `aria-hidden` wrapper, so how much of the media had loaded was readable off
the screen and nowhere else: `aria-valuetext` carries the playhead position
only, and nothing in the DOM carried the rest (WCAG 2.2 AA 1.3.1). A visually
hidden `[data-reely-part='seek-buffered-description']` now sits beside the
geometry, referenced by the range control's `aria-describedby`, and reads
`45% loaded`.

The share is measured against the seek window rather than against media time, so
a live DVR window that starts past zero reports the part of _that_ window which
has loaded. Several buffered ranges produce one description, not one per range:
their union is counted, so a gap in front of the playhead reduces the share
instead of being papered over by a "loaded through" time the playhead cannot
reach without waiting. Where there is no seek window, no buffered range at all,
or nothing left of one after it is clamped to the window — a live DVR buffer
that has slid off the back — no description is rendered and no share is claimed:
an absent measurement rather than a `0%` that reads as measured. A share that
does render will not round into a claim it cannot back either. It reads `100%`
only for a wholly covered window, and otherwise stays between `1%` and `99%`, so
a sliver does not round away to nothing and a near-complete buffer does not
round up to done.

It is not a live region and never announces on its own: `buffered` moves many
times a second during playback. The geometry stays `aria-hidden`. Consumers keep
their own `aria-describedby` through `inputProps`: the library's id is appended
to it rather than replacing it.
