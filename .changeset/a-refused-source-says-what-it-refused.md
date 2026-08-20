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

**Will not play** (`unsupported-string`):

> Playdeck will not play the player source "…". An accepted source URL is
> http(s) or scheme-less, carries no control character at either end, and is
> either a YouTube, Vimeo or Wistia URL or a path ending .mp4, .webm or .m3u8.

This is the one reason that cannot name a cause, so it states the requirement
rather than guessing which half of it failed. It covers a scheme the allowlist
refuses, an invisible C0 control at either end of an otherwise playable URL, and
a URL that simply matched nothing — and for `clip.avi` there is no host to blame
at all, while for a `.mp4` URL with a stray control character the host is
irrelevant. Any sentence naming the scheme or the host would be wrong for two of
the three.

**Not a source object** (`invalid-source`):

> The player source … is not a source object Playdeck accepts.

Each quotes the rejected source, truncated to 120 code points — by code point
and not by code unit, so the cut cannot split a surrogate pair and leave a
replacement character in a message quoting the consumer's own value. There is no
injection risk in the quoting: `ErrorDisplay` renders the message as a React
text child, which escapes it. The bound is about layout rather than safety — the
message is one paragraph over the player, and a long query string would push a
retry button off a small viewport — and 120 keeps every URL form the new
document lists whole, with the scheme, host and path that identify the mistake
all inside it. A non-string source is quoted as JSON.

`recoverable: false` is unchanged (#331): a retry re-reads the same `source`
prop and the same rules refuse it again, so no control offers one.

`'Unable to load the player provider.'` becomes:

> Unable to load the &lt;provider&gt; provider. Playdeck cannot say why: the
> rejection it caught is on this error's cause. See Playdeck's
> docs/provider-setup.md for what to check.

The provider is knowable from the resolved source, so it is named. The reason is
not: a dynamic import the network never delivered, a CSP that refused the chunk,
a missing media mount and an adapter factory that threw all arrive as one
rejection, and the message says so rather than guessing. `cause` still carries
that rejection — but `ErrorDisplay` renders `error.message` and nothing else, so
`cause` alone would be a dead end for the person looking at the player. The
document is the step both audiences can take, and its provider-load section
gives an ordered list to check, forwarding to the CSP origins list rather than
duplicating it.

Every message points at **[Provider setup](../docs/provider-setup.md)**, new in
this release, which lists the source values each provider accepts and refuses —
derived from `detectSource` and checked by running it, not by reading a
provider's documentation — along with each provider's `providerOptions` and a
working player per provider. The per-provider examples deliberately pass no
`providerOptions` at all: `youtube.host` moves the embed off the
privacy-enhanced `youtube-nocookie.com` default and `vimeo.suppressSeoMetadata`
acts page-wide, and neither is a decision a starting example should make for a
copy-paster. The root README's quick start names the YouTube and Vimeo URL forms
directly, so neither needs the reference document to get a source playing.

`CONTEXT.md` gains a **Refused source** term and qualifies **Notice**. A
`source` the shared allowlist refuses is a consumer-supplied URL prop, so
Notice's unqualified claim that such a refusal "names the refused surface and
never the value" no longer held once this change started quoting the value. The
new term draws the line on why the two differ: a source is one prop with one
value, so naming the value is naming what to fix, while a **Refused surface** can
be refused by several instances at once and has no single value to name.

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
