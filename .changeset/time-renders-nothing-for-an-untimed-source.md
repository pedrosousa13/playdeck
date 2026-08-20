---
'@playdeck/react': minor
---

`Player.Time` renders nothing for `type="duration"` and `type="remaining"` on a
source with no duration (#248). It used to render a literal `0:00`, which a
viewer reads as a zero-length video rather than a live stream — and it did so
beside a `type="current"` instance counting up, which is what makes the zero
look authoritative rather than absent. `type="current"` is untouched:
`currentTime` means the same thing on a live source as on a VOD one.

**In that state the element is a `<span>`, not an emptied `<time>`.** There is
no time to mark up, so it is not a `<time>`: one carrying neither a `datetime`
nor parseable time-string content is invalid, and the `PT0S` that would make it
conformant is the same zero-duration claim the text has just stopped making —
the half of the defect `children` could never have worked around, because the
library owns that attribute. Every hook survives the swap:
`data-playdeck-part="time"`, `data-state="untimed"`, `data-time-type` and
`data-provider` are all still there, and your props and `children` render as
before. Two things do move with the tag — a selector written
`time[data-playdeck-part="time"]` stops matching (the documented hook is
`data-playdeck-part`, not the element type), and a `ref` receives the `<span>`.

Because the element is no longer fixed, **`TimeProps['ref']` is now
`Ref<HTMLElement>`** rather than `Ref<HTMLTimeElement>`. TypeScript could not
have caught the mismatch on its own: `HTMLSpanElement` declares no member
`HTMLElement` does not, so `HTMLTimeElement` is structurally assignable to it
and a consumer holding `useRef<HTMLTimeElement>(null)` read
`ref.current?.dateTime` as `string` while getting `undefined` on any live
source. The declared surface has to be honest about what it hands back, which is
the same reasoning #356 applied to `Player.Root`'s ref. No consumer code breaks
— `useRef<HTMLTimeElement>(null)` and `(el: HTMLTimeElement | null) => void`
both still assign — and the only thing lost is `.dateTime` autocomplete off the
ref, which is exactly the member that was never guaranteed.

A `dateTime` prop no longer reaches the DOM on an untimed source. The `<time>`
always overrode one by ordering, but the `<span>` wrote no `datetime` of its
own, so a consumer's passed straight through — republishing, in the form a
machine parses, the zero-duration claim this change exists to remove. The
library owns the attribute in both states now.

One consequence worth planning for: `duration` is `null` until metadata arrives
on nearly every source, so a `duration` or `remaining` instance normally starts
as a `<span>` and is **replaced** by a `<time>` when metadata lands rather than
re-rendering in place — a CSS transition, focus, or a `MutationObserver` a
consumer has attached to that node resets at that moment.

Nothing is substituted for the text, and nothing new is exported to substitute
it with. A consumer who wants a `LIVE` badge, an em dash or an elapsed-time
fallback composes it off `data-state="untimed"` in their own layout, or passes
`children`, which still outrank the rendered time. That is the line
`.out-of-scope/default-presentation-on-blocked-autoplay.md` draws for a refused
autoplay, and it applies unchanged here: publish the state, do not materialise a
presentation inside someone else's design. `Contract.mdx` documents the state,
the empty text and the element.

A source is untimed where `duration` is not a finite number, so both a `null`
duration and the `Infinity` a live HLS stream publishes are covered. A genuine
zero-second source is a measurement rather than a missing one: still timed,
still a `<time>`, still `0:00`.

It lands as `minor` rather than `patch`: what the component puts on screen
changed, the element type and `datetime` attribute a released version handed out
are different now, and `TimeProps['ref']` is declared wider than it was.
