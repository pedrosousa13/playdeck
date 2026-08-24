---
'@playdeck/provider-native': minor
---

The native provider no longer republishes an empty `buffered` over a non-empty one.
It published that field from four places — the media-state snapshot, reached by the
attach snapshot, `canplay` and `loadedmetadata`, and `progress` — each putting
whatever `media.buffered` read at that instant on the wire, unconditionally. An
empty `TimeRanges` therefore erased ranges the player had already been told about
(#405).

**An empty reading is ambiguous and the element cannot disambiguate it.** No ranges
means one of two things — "nothing is buffered" and "not telling you" — and WebKit
means the second. Its buffered window for the ~1s tracer clip is transient: it opens
while the element parses and closes again when parsing finishes, with the data
plainly still there. Measured in situ under
[#401](https://github.com/pedrosousa13/playdeck/issues/401), 2 of 13 loads:

```
run 6:  1942 progress   elBuf=[[0,0.357423974]] rs=2 ns=2 dom=1   <- window open, range rendered
        2598 progress   elBuf=[]                rs=4 ns=1 dom=1   <- onProgress republishes []
        2600 canplay    elBuf=[]                rs=4 ns=1 dom=0   <- range gone from the DOM
```

A buffered indicator that had rendered correctly disappeared, and
`PlayerState.buffered` reported less than the player had already been told.

**What ships: within one source, an empty reading is _unknown_ rather than _none_.**
The adapter records the ranges it last put on the wire and withholds the `buffered`
key when the reading is empty and that record is not — the key is absent from the
patch rather than present and empty, which `#applyPatch` resolves by retaining what
it already holds. Withheld and not ignored outright, and scoped to one source with an
explicit reset point, because eviction is real: on another engine an empty reading
genuinely can mean none.

**`PlayerState.buffered`'s meaning moves with it,** and that is the substance of this
change rather than a side effect. It is no longer a faithful instantaneous mirror of
the media element — it is the last thing the provider was willing to vouch for. The
term is written down in `CONTEXT.md` as **Buffered window**.

**`emptied` is the one reset point inside an attachment.** It fires from the media
load algorithm, which empties the element's buffer as it runs, so there the ranges
are gone rather than merely unreported and the retained value goes with them. Silent
when the record was already empty: `load()` calls `media.load()`, so every ordinary
load fires this, and a patch restating a value that never moved is the empty patch
this adapter refuses everywhere else. A source change needs no code at all — it
builds a new provider over state rebuilt from `createInitialPlayerState()`, so the
record is fresh by construction.

**A seek is deliberately not a reset point.** Clearing on "a seek outside the known
buffered range" was the proposed third rule, and it was measured before being wired:
chromium, firefox and webkit, three runs each, a 600 s clip served through a
range-honouring server throttled to 250 KiB/s so only ~4% of it was ever buffered.
`buffered` never read empty after any seek on any engine. The old ranges were
retained verbatim — the leading range's `end` was bit-for-bit identical before and
after — with a new disjoint range added at the target, and seeking back into the
retained range was served with **zero HTTP traffic** on firefox and webkit and
without a re-fetch on chromium. The retained ranges were not merely reported, they
were still true, so that rule would have discarded real data. It is not implemented.

**What did not change.** `seekable` is published on every `progress` exactly as
before — only `buffered` carries the ambiguity. A non-empty reading is published
whenever it arrives, unchanged or not: the record suppresses the empty-over-non-empty
case and nothing else. A DVR window that slides, dropping ranges off its start, is
non-empty at every step and is published like any other reading.

**This does not fix
[#401](https://github.com/pedrosousa13/playdeck/issues/401),** and the buffered
indicator's WebKit exclusion stays closed. This accounts for 2 of 13 measured loads;
in the other 6 failing loads `buffered` was never populated at any observable instant,
which no adapter change can help.

It lands as `minor` rather than `patch` for the reason `native-duration-no-longer-latches`
did: no API moved, but published state did, and a consumer asserting on the provider
stream sees a patch shape that was not there before — one from `emptied`, and one from
`progress` that carries `seekable` without `buffered`.
