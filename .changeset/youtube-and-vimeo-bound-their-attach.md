---
'@playdeck/provider-youtube': minor
'@playdeck/provider-vimeo': minor
---

YouTube and Vimeo now bound the wait for their embed to become ready. Neither
did: YouTube reached `ready` only from the iframe API's `onReady` callback and
Vimeo only after `player.ready()` resolved, and neither armed a timer for the
case where that callback or promise never arrives. A blocked embed therefore
parked the player in `loading` for ever with `error: null` — so neither
`ErrorDisplay` nor `ActivationButton` engaged, because both gate on
`activation === 'error'` — and on YouTube every `whenReady()` call added a
resolve function that never settled, while its own comment claimed it "never
hangs on an outcome".

The triggering condition is ordinary rather than exotic: a page CSP without
`frame-src www.youtube-nocookie.com` or `player.vimeo.com`, an extension or DNS
blocking the frame, a captive portal, or a vendor frame that loads but never
posts back.

Both now fail the attach after fifteen seconds with a `provider` error that is
`recoverable`, naming the embed rather than the API — the actionable cause is
almost always the consumer's own CSP. Fifteen seconds matches the Wistia
adapter, which already shipped exactly this backstop and states the reasoning:
it is a "that is never coming" bound rather than a performance budget, so a slow
connection is never reported as a failure.

The new deadlines are distinct from every timer that already existed and did not
cover this. YouTube's `API_READY_TIMEOUT_MS` bounds the iframe API _script_
initialising and its `PLAYBACK_CONFIRMATION_TIMEOUT_MS` bounds a play command;
Vimeo's `CHROMELESS_PROBE_TIMEOUT_MS` bounds the oEmbed probe alone. Both
packages export the new `PLAYER_READY_TIMEOUT_MS`.

Vimeo keeps declaring `commandsReady` at player construction rather than at
`player.ready()`. That was deliberate — the SDK queues calls it receives
beforehand, and waiting for `ready()` was one of the two hangs that closed an
earlier attempt — and it is not a substitute for bounding the wait.
