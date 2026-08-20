---
'@playdeck/react': minor
---

A refused `source` now says which failure occurred and quotes the value it
turned down, and a provider that fails to load names itself.

`detectSource` distinguishes three failure reasons internally —
`malformed-string`, `unsupported-string`, `invalid-source` — and all three
published the one sentence "The player source is not supported.", which named
neither the failure nor the value. `ErrorDisplay` renders `error.message` and
nothing else, so that sentence was the entire surface a consumer had: a
mistyped Vimeo URL, a `javascript:` URL the shared allowlist refused, and a
source object with a bad id were indistinguishable, and nothing said which URL
forms are accepted. Each reason now reads differently:

**Not readable** (`malformed-string`):

> Playdeck could not read a video from the player source "…" — it is either not
> a well-formed URL, or a provider URL in a form Playdeck does not read.

That reason genuinely covers both, so the sentence says both: a string that
broke a shared rule, and a recognised provider host in an unrecognised path
shape, are one reason inside the detector.

**No provider** (`unsupported-string`):

> Playdeck has no provider for the player source "…" — its scheme or its host is
> not one Playdeck plays.

**Not a source object** (`invalid-source`):

> The player source … is not a source object Playdeck accepts.

Each quotes the rejected source, truncated to 120 characters. There is no
injection risk in that: `ErrorDisplay` renders the message as a React text
child, which escapes it. The bound is about layout rather than safety — the
message is one paragraph over the player, and a long query string would push a
retry button off a small viewport — and 120 keeps every URL form the new
document lists whole, with the scheme, host and path that identify the mistake
all inside it. A non-string source is quoted as JSON.

`recoverable: false` is unchanged (#331): a retry re-reads the same `source`
prop and the same rules refuse it again, so no control offers one.

`'Unable to load the player provider.'` becomes:

> Unable to load the &lt;provider&gt; provider. Playdeck cannot say why — the
> failure it caught is on this error's cause.

The provider is knowable from the resolved
source, so it is named. The reason is not: a dynamic import the network never
delivered, a CSP that refused the chunk, a missing media mount and an adapter
factory that threw all arrive as one rejection, and the message says so rather
than guessing. The rejection itself still rides on `cause`, as before.

Each message points at **[Provider setup](../docs/provider-setup.md)**, new in
this release, which lists the source values each provider accepts and refuses —
derived from `detectSource` rather than from a provider's own documentation —
along with each provider's `providerOptions` and a working player per provider.
The root README's quick start names the YouTube and Vimeo URL forms directly, so
neither needs the reference document to get a source playing.

One internal consequence worth naming, because it changes when a message is
republished: the three loading strategies now depend on the refusal message
rather than on the source's `status`. Every refusal collapses to one activation
key, so replacing one refused source with another moved nothing those effects
watched, and the message would otherwise have kept naming a value the consumer
had already corrected.

It lands as `minor` rather than `patch` for the reason
`interaction-loading-reports-a-refused-source` gives: no API changed, but a
released behaviour did, and a consumer asserting on either message string has to
update. Both are prose intended for a person to read, not a stable identifier —
branch on `error.category` and `error.recoverable`, which are unchanged.
