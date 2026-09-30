---
'@playdeck/react': patch
---

Resolve a `providers` registration only by its own property, never an inherited one

Both registry lookups indexed the `providers` map directly: `detectSourceWithProviders`'s
explicit-object branch, and `loadProvider`'s supplied-kind branch. With `providers` set to
anything at all — `{}` included — a source of `{ type: 'toString' }` (or `constructor`,
`valueOf`, `hasOwnProperty`, `__proto__`) resolved the inherited `Object.prototype` member,
which is truthy: detection reported `status: 'success'` and passed the object on as the
resolved source, and dispatch then failed with a swallowed provider error instead of the
`invalid-source` refusal a consumer was owed.

A `type` now counts as a supplied registration only when it is an own property of the
`providers` map, through one shared `Object.hasOwn` lookup both sites call. A `type`
matching no own property is refused exactly as an unregistered name already was. The same
lookup also gates `loadProvider`'s own `providerOptions[source.type]` read, so an inherited
member cannot stand in for an option bag nobody supplied either.
