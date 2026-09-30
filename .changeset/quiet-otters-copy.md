---
'@playdeck/react': patch
---

Copy a supplied provider's explicit source object before validating or dispatching it, instead of trusting the caller's own object

`detectSourceWithProviders`'s explicit-object branch used to return a
consumer's own source object unchanged once its strings cleared the shared
allowlist -- the same live object the walk had just read was also what
`sourceKey` serialised and what a supplied kind's own `load` factory
received. That let a hostile or `JSON.parse`-derived object cause four
distinct problems: an acyclic object thousands of levels deep overflowed the
stack inside `Root`'s own render; a getter could answer the allowlist walk
with a permitted URL and the factory with a `javascript:` one on a second
read; a string inside a `Map`, a `Set`, behind a symbol key, or on a
non-enumerable property was never checked at all; and a `bigint`, or a
`toJSON` that throws, passed detection and then threw out of `sourceKey`'s
`JSON.stringify` during render.

The explicit-object branch now copies the caller's object into a plain
structure this package builds itself before any validation runs.
`copySuppliedSourceValue` reads each own, enumerable, string-keyed value
exactly once, checking it against the shared allowlist right there for a
string, at a nesting depth capped by `MAX_SUPPLIED_SOURCE_DEPTH` (32, well
past any legitimate source shape). Only plain objects, arrays, strings,
finite numbers, booleans, `null` and `undefined` are admitted -- a `Map`, a
`Set`, a `bigint`, a function, a class instance, a symbol-keyed property, a
`javascript:`/`data:` string, or nesting past the cap refuses the whole
source as `invalid-source`, never a throw, the same outcome a refused URL
already produces. A non-enumerable own property is silently left out of the
copy rather than refusing the source, since the copy never carrying it
closes the same hole a symbol key opens. The copy -- not the caller's object
-- is what a resolved source's `input`/`source` pair carries on to
`sourceKey` and to a supplied kind's `load` factory.

A cycle (an object reachable from itself) is refused outright, in constant
time, by an ancestor check -- it does not rely on the depth cap at all. A
diamond (the same nested object reached through two sibling branches, which
is not a cycle) is copied independently for each branch rather than reused
from one shared copy: a copy that only told a cycle apart from a diamond by
depth, with no further guard, cost time exponential in a diamond's depth
rather than linear in the number of distinct objects, hanging render on a
shape well within the depth cap. Memoising a diamond's shared object into one
copy fixes that recursion, but was not the fix landed here -- `sourceKey`
calls `JSON.stringify` on a resolved source during every render, and
`JSON.stringify` does not deduplicate a shared reference either, so a
memoised copy would still expand exponentially one call downstream, inside
`sourceKey`, rather than during detection. The actual fix is
`MAX_SUPPLIED_SOURCE_NODES` (10,000): every value the copy visits, valid or
not, counts against this one shared budget, so a small diamond -- copied
twice, at twice its own cost -- comfortably fits, while a diamond chain deep
enough to double at every level spends the whole budget within a small,
fixed number of levels and is refused, promptly, before either the copy or
any later walk over it could expand exponentially.

`everyStringPermitted` itself, and the cycle/diamond handling of a
registration's own `detect` return, are unchanged: that path gets no copy
step and still needs its own `WeakSet`-based cycle guard, and is not called a
second time over the finished copy -- doing so would walk the same object
twice with no memory of the first walk.

A related, pre-existing defect surfaced once a diamond-shaped source could
finally be refused rather than hang or be wrongly accepted: `use-activation.ts`'s
`echoSource`, which quotes a refused source in the error message any
consumer sees, called `JSON.stringify` on the caller's raw, still fully
shared, object to build that quote -- so refusing a large diamond raised
`RangeError: Invalid array length` while truncating the resulting,
exponentially long string. `echoSource` now bounds its own `JSON.stringify`
call with a node-counting replacer, the same technique
`copySuppliedSourceValue`'s budget uses, so building a refusal message is
bounded regardless of what was refused.

The copy is also now throw-safe. None of its checks can rule out, ahead of
time, a value whose own shape makes _reading_ it throw rather than merely
making the read value invalid: an ordinary data property can declare a
throwing getter, and a `Proxy` can make any of `copySuppliedSourceValue`'s
own reads (`value[key]`, `Object.keys`, `Object.getOwnPropertySymbols`,
`Object.getPrototypeOf`) throw from its own trap. `copySuppliedSourceObject`
now wraps the whole recursive copy in one `try`/`catch`, converting any such
throw into the same `invalid-source` refusal a `Map` or a `bigint` already
gets, rather than retrying an individual read -- which would read the
offending value a second time, exactly the getter hazard this package's own
single-read rule exists to close.

`docs/provider-setup.md`'s "Explicit source objects" section now states the
copy's constraints. `scripts/compare-libraries.mjs`'s Playdeck row ceilings
move for the added bytes, following the same procedure #752 used, raised
only where a row's own measurement actually breached its ceiling.
