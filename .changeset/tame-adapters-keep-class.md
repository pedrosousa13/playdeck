---
'@playdeck/react': patch
---

Keep a class-based or frozen supplied adapter's methods on the queued-play path

A supplied provider's factory can return a class instance, or one guarded
with `Object.freeze`, and `ProviderAdapter` is structural, so nothing
forbids either. Queuing a play before loading finishes
(`loading="interaction"`, or a retry through `activateFromInteraction`) used
to hand the controller a copy built with `{ ...adapter, load: ... }`. A
spread copies only an object's own enumerable properties, and a class
declares its methods on its prototype, so the copy silently lost every
method but the replacement `load`. The controller's first call on a newly
attached provider is `subscribe`, not `attach`, so the missing method broke
there first: activation went straight to `error` and the provider never
attached at all. `loading="eager"`, which never queues a play, passed the
adapter through unchanged and was unaffected.

The copy is now a `Proxy` whose target is an empty object rather than the
adapter itself. Every property but `load` reads through to the real
adapter, binding a function value to it before handing it back. That fixes
both shapes: a class instance, because a method reading a `#private` field
checks the exact instance that declared it rather than what is reachable
through its prototype -- a same-named method rebuilt on a plain copy, or
reattached with `Object.create(adapter)`, still throws on that read; and a
frozen adapter, because a `Proxy` targeting an object whose own properties
are non-configurable and non-writable must return each one's exact value
back, which neither a `load` override nor a bound method ever is.
