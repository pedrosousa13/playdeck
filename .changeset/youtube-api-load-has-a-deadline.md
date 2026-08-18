---
'@playdeck/provider-youtube': minor
---

The YouTube iframe API load now settles within a bounded time in every case,
and can be started again after it fails (#220).

The loader settled its promise on exactly two events: the injected script's
`error` listener, and `window.onYouTubeIframeAPIReady` firing. Neither covers a
response that arrives 200 OK but is not the API — a captive portal, an
inspecting proxy, a region block serving HTML, a truncated body. The browser
fires `load` for all of those, not `error`, so the ready callback never ran and
the promise never settled. The memo holding it is module-global and was cleared
only on the `error` path, so `retry()` awaited the same permanently pending
promise: one bad response stranded every YouTube player on the page for the
document's lifetime. Adopting a `script[src]` another consumer had already
injected reached the same state by a second route — an element that has already
failed will fire no further `error`.

Every attempt is now under a `API_READY_TIMEOUT_MS` deadline, exported and
holding 15 seconds — the same number as the Wistia provider's ready timeout, and
the same kind of backstop rather than a performance budget. An attempt that
expires rejects with a message naming a script that loaded without
initializing, clears the memo, and puts back whatever `onYouTubeIframeAPIReady`
was on the window before it, so a late API cannot settle a discarded attempt.
An adopted script element is put under the same deadline as one the loader
creates. The next call — a fresh `loadYouTubeIframeApi()`, or the adapter's
`retry` command — then starts a genuinely new attempt and can succeed if the
network has recovered.

A script element the loader did not create is still left in the document when
its deadline expires, unchanged from how the `error` path already behaved: the
loader does not remove a DOM node it did not add. It is now also left alone when
the attempt that created it has already been superseded — by a reset, or by a
failure before it — because a later attempt may have adopted that same element
and be waiting on it. Either way the next attempt adopts it again under its own
deadline, so the outcome is a bounded rejection rather than a hang.

`resetYouTubeIframeApiLoader` is exported alongside, discarding the memo the way
`resetWistiaPlayerLoader` and `resetVimeoSdkLoader` already do for their
loaders — for tests that need a clean load, not for app code.

`minor`, because the package gains public module exports. Under 0.x this repo
sends a package that grows its export surface on `minor` — `@playdeck/core` took
`minor` for gaining `deriveLiveState` while the providers that merely consumed
it took `patch` — and `API_READY_TIMEOUT_MS` and `resetYouTubeIframeApiLoader`
are two such exports. The behaviour change rides along and is not itself
breaking: it turns a hang into a rejection, and a caller that already handles
the existing `error`-path rejection handles this one too.
