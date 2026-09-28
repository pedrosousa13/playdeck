---
'@playdeck/react': patch
---

Refuse a supplied detect result that claims a built-in source type

A provider registration keyed by any name other than one of the five
built-in kinds could still have its `detect` return an object whose `type`
named a built-in kind (for example `'hls'`). That result was accepted as
the registration's own resolved source and routed straight to the matching
built-in branch, which builds the adapter from it directly and skips every
check that branch's own explicit-source validation applies -- engine and
host validation, video-id format checks, and network-path rewriting. The
existing guard only refused a registration whose own key named a built-in
kind; it never inspected the `type` a `detect` result claimed, and it read
that result's own live object rather than a copy of it, so a `type`
implemented as a getter could answer safely while this check ran and
answer with a built-in kind's own name once resolution had already moved
on.

A `detect` result is now copied into a plain value this package controls
before anything reads it, the same way an explicit source object already
was. A result whose `type` names a built-in kind, or whose shape this
package cannot fully account for (a `Map`, a `Set`, a `bigint`, a symbol
key, a class instance), is treated exactly like a declined `detect`:
resolution moves on to the next registration, or falls through to
built-in detection, which still gets its own chance -- and its own
validation -- at the same input.
