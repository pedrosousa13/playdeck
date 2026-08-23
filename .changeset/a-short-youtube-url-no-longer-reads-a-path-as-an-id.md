---
'@playdeck/core': minor
---

`detectSource` now refuses a **short-host YouTube URL whose only path segment is
a full-host path keyword** — `watch`, `embed`, `live`, `shorts` or `playlist`,
in any case — instead of reading that segment as the video id (#395).

`https://youtu.be/watch?v=dQw4w9WgXcQ` used to detect, and to detect as
`{ type: 'youtube', videoId: 'watch' }`. On a short host the whole first path
segment is the id, and `watch` is a valid id _shape_, so the `v` parameter
carrying the real id was never consulted. It is a plausible URL to write by
hand: a consumer who knows `youtube.com/watch?v=<id>` works, and knows
`youtu.be` is the short domain, may combine them.

**The failure it removes is a silent one.** Detection reported success, so the
player loaded the YouTube provider, asked for a video called `watch`, and failed
at YouTube with no Playdeck error at all. The refusal is the same
`malformed-string` every other unreadable provider URL gets — no new reason and
no new message — so the consumer meets the named, actionable error that quotes
the value it turned down, rather than a player that never plays.

**Refused, not interpreted.** Reading `v=` when the segment is `watch` would
have made the URL work, and would have taught a form YouTube does not serve and
committed this library to supporting it. A URL this library invents is a URL it
then owns.

**The keyword set is derived, not duplicated.** The five keywords are named once
each in `source-detection.ts`, and the list this rejection reads is assembled
from those names rather than written out a second time. A path added to the full
hosts is therefore excluded from the short hosts by the same edit that adds it —
without that, `/live/` (added in the previous release) would have been readable
as the id `live` on `youtu.be`, which is the same bug in a new spelling.
`playlist` is in the set for the short hosts' sake: a full host reads no video
out of `/playlist?list=<id>` and so refuses it already, and naming it as a
keyword closes the short-host hole without changing the full hosts at all.

**Case-insensitive on the short hosts, and only there.** The full-host `/watch`
comparison stays exact, because the two hosts fail differently: `/Watch` on a
full host is refused loudly, while on a short host it _succeeded_, with an id no
video answers to. Folding case cannot cost a legitimate id — the comparison is
still an exact one against the whole segment, the segment is `[A-Za-z0-9_-]+`
and so is ASCII, which lowercases without changing length, and the keywords are
four to eight characters against YouTube's eleven-character ids.

**What still detects.** `https://youtu.be/<id>` is untouched for every id that
is not one of the five keywords. The rejection keys on the keyword set alone and
never on length or plausibility, so `watchAgain1`, `rewatching1`, `watch-later`
and the single-character `w` all resolve to themselves — this library constrains
an id to `[A-Za-z0-9_-]+` and does not enforce YouTube's own length.

**Why `minor`.** This narrows what `detectSource` accepts, which is the opposite
direction to the previous release's widening, and a narrowing has to answer for
what it takes away. It takes away nothing that worked. Every form that changed
resolved to the keyword itself as the video id — `watch`, `playlist`, `ShOrTs`
and the like — and no YouTube video answers to any of them, so each one built a
player that could not play. A sweep of 347 URL forms through the built package,
before and after, moved 108 rows and no others: the five keywords in eighteen
case spellings, on both short hosts, with a `v` query, with a `list` query and
with none, every one of them accepted → refused. Every other form — the full
hosts' five accepted shapes, the three forms the previous release added, Vimeo,
Wistia, and the file and manifest shapes — resolved exactly as before.

`major` would ask a consumer to do something before upgrading and would take
this package to `1.0.0`, neither of which is meant: at `0.x` the `minor` slot is
where an intentional behaviour change belongs. `patch` would hide a public
function answering differently for an input it already answered for. A consumer
who was passing one of these URLs will now see a refused-source error where they
previously saw a stuck player, and the fix is the one the error already points
at: pass `https://youtu.be/<id>`, or the full-host `watch?v=` form.

`@playdeck/react` is not bumped and takes only the dependency patch every
dependent gets. `Root`'s `source` prop hands the string straight to
`detectSource`, and neither the prop type, the detection call, nor the error
published for a refusal moves here.

`docs/provider-setup.md` documented this form as "a trap" a reader had to avoid
and now lists it among the refused shapes.
