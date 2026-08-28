# DASH

Playdeck does not play DASH, and will not. A URL whose path ends `.mpd` is
recognised well enough to be refused by name — `detectSource` raises
`unsupported-format` and the message says Playdeck does not play DASH rather
than restating the list of accepted forms — but recognising the format is the
whole of the support. There is no DASH provider, no dash.js dependency, and no
plan for either.

Playdeck's streaming scope is one adaptive format, HLS, alongside progressive
MP4 and WebM. That is a boundary rather than a to-do list.

## Why this is out of scope

**HLS is in scope because the browser carries half of it, and no browser carries
DASH.** Safari and iOS play an `.m3u8` from a plain `<video src>`, which is why
`@playdeck/provider-hls` delegates to the native provider and why the README's
download table has a 35.2 KB row for HLS there — the adapter, and no engine at
all. Everywhere else hls.js is fetched lazily, and at 159.5 KB it is by a wide
margin the largest package Playdeck ships. So HLS costs an adapter on the
platforms that already speak it, and an engine only where they do not.

DASH has no equivalent row. No browser ships native DASH playback — as of
2026-08-28 none has, and none has announced it — so every consumer of a DASH
provider downloads an ABR engine, on every platform, with no path that avoids
it. This says nothing about how large that engine would be, and the point does
not need a number: what HLS has here is a configuration that costs an adapter
and nothing more, and DASH has no such configuration available to it at any
size. The argument that makes hls.js tolerable — that four of the five
providers never fetch it, and that Safari and iOS never fetch it either — has
no counterpart.

**A second ABR engine is a second capability-reporting story, not a second
import.** The honesty guarantee is that every capability answers with a reason,
and that every provider difference is measured against the real SDK rather than
inferred from its documentation. `packages/provider-hls` is what holding that
line costs for one engine: attachment, error recovery, a quality ladder that
follows hls.js's own level pruning, and text-track handling that reports the
difference between a build that can enumerate subtitles and one that can also
select them. The `provider-build` availability reason exists solely because
`hls.js/light` compiles controllers out and a consumer deserves to be told which
build they handed over.

A DASH provider inherits all of that as unanswered questions, and none of the
answers transfer. It also needs its own row in `docs/third-party-requests.md`,
which is where a consumer reads which origins each provider reaches. Note what
the comparison in #447 measured on 2026-08-24: vidstack 1.15.6 supports DASH by
fetching `dashjs@4.7.4` from `cdn.jsdelivr.net` at runtime rather than depending
on it. That is precisely the shape this repo refuses — a provider that quietly
adds a third-party origin to a page's CSP — so the cheap route to DASH is closed
here even before the cost is counted.

**DASH's distinguishing strength is DRM, and Playdeck has no DRM story of its
own.** Playdeck never calls EME. Where DRM works at all it works inside an
embed's own frame and is that embed's business — YouTube's `allow` list carries
`encrypted-media`, so a protected source plays there, while Vimeo's deliberately
omits it, so one does not, and `docs/third-party-requests.md` records both as
facts about those frames rather than as anything Playdeck decides per media. On
the paths Playdeck actually drives, EME is absent: there is no
`requestMediaKeySystemAccess` in this repository, no key-system capability, and
no vocabulary for reporting one. The HLS package documents EME as one of the
things `hls.js/light` compiles out and treats losing it as unremarkable, because
subtitles are the only half of that trade this adapter notices.

So the argument "DASH, because DRM" asks this library to carry a second
streaming stack for the sake of a feature it does not have and is not building.
Strip DRM out and what is left is adaptive bitrate over segmented media, which
is what HLS already does here.

**Converting is a real path, not a theoretical one.** DASH and HLS have
converged on CMAF, and the common packagers emit both manifests over the same
segments. For most media that would arrive at Playdeck as an `.mpd`, an `.m3u8`
describing the same files is a packaging option rather than a re-encode. That is
what makes the refusal an inconvenience rather than a wall, and it is why
`docs/provider-setup.md` answers the refusal by telling a consumer to convert.

## What this does not claim

It does not claim DASH support would be worthless. #447 measured the
alternatives on 2026-08-24 and two of the three carry it: vidstack 1.15.6 in
core, media-chrome 4.19.2 through its `dash-video-element` plugin. Only plyr
3.8.4 ships no streaming provider at all. This is one of the few axes where a
consumer comparing libraries would rule Playdeck out on a capability rather than
a preference, and nothing here disputes that. The position is that DASH is
outside this library's scope, not that it is outside everyone's — a consumer
whose pipeline emits DASH and cannot change it should use one of the two that
carry it, and refusing by name exists so they learn that in seconds rather than
after an afternoon of debugging a URL that was never wrong.

## What would reopen this

- **Playdeck growing an EME story.** If DRM ever becomes something this library
  reports on rather than something it silently lacks, the strongest reason for
  DASH stops being answered by "we do not do that either", and the question is
  worth asking again.
- **A browser shipping native DASH playback.** That would give DASH the cost
  shape HLS has on Safari — an adapter over something the platform already does
  — and the first reason above stops applying.
- **A concrete case where the media genuinely cannot be packaged as HLS.** Not a
  pipeline that has not been changed, but one that cannot be. Raise it as that,
  with the constraint named.

Two of three alternatives supporting DASH is not a reopening condition. That was
true when this was decided and was weighed then.

## Prior requests

- [#447](https://github.com/pedrosousa13/playdeck/issues/447) — "Playdeck does
  not play DASH, and `.mpd` is not recognised anywhere". Filed by the
  competitive comparison in #398, which measured the gap against three
  alternatives. It offered three responses and the maintainer took two of them
  on 2026-08-25: decline the format, and refuse it by name rather than letting
  it fall through to a generic detection failure. The refusal landed in
  `d723641`; this record is the other half.
