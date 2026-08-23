---
'@playdeck/core': minor
---

`detectSource` now reads three URL forms it used to turn down, each of them a
form a provider hands a consumer directly (#379):

- **`https://vimeo.com/<id>/<hash>`** — the share link Vimeo hands out for an
  unlisted video, and the form copied out of Vimeo's own UI.
- **`https://youtube.com/live/<id>`** — the canonical URL for a live broadcast.
- **`https://youtube-nocookie.com/embed/<id>`**, and the `www.` spelling — the
  privacy-preserving host.

None of the three was refused by the shared allowlist, so nothing unsafe was
being kept out and nothing unsafe is being let in. They were refused by shape,
and the refusals were safe and wrong: the same unlisted Vimeo video was already
accepted two other ways (`?h=<hash>`, and the `player.vimeo.com` path), so the
library supported the case and simply did not recognise the URL the provider
gives you.

**The Vimeo hash reaches the source, and that is the point.** A form that
detected but dropped it would build a player that cannot load the unlisted
video and would report no error at all — worse than the refusal it replaces.
The canonical host reads the hash from the same trailing segment the
`player.vimeo.com` path already read, so the three forms of one unlisted video
now resolve to one identical `VimeoSource`. Where a query hash and a path hash
both arrive, `?h=` still wins.

**The no-cookie host needs nothing downstream, and gets nothing.** A
`YouTubeSource` is a video id and carries no host, so a source URL cannot ask
for an embed origin — only `providerOptions.youtube.host` can. It does not need
to: `@playdeck/provider-youtube` already requests
`https://www.youtube-nocookie.com` whenever no `host` is given, so a consumer
who chose that host for privacy is served from the host they chose. Accepting
it in detection cannot hand them the cookie-bearing origin.

**Two consequences worth reading before upgrading**, both of them widenings and
neither of them a form that previously worked changing:

- The no-cookie host joined the **full hosts**, so it reads every full-host
  shape — `/watch?v=`, `/embed/`, `/live/` and `/shorts/` — not `/embed/`
  alone. Membership of that list is what a host has; a shape allowed on one
  full host and refused on another would be a new rule, not a smaller change.
  A URL in any of those shapes resolves to the same video id it would on
  `youtube.com`, and loads from the same default origin.
- `https://vimeo.com/<id>/<trailing-segment>` is now read as an unlisted hash
  whenever that segment is `[A-Za-z0-9]+`, because that **is** the accepted
  form — a hash is not distinguishable from any other alphanumeric segment, on
  this host or on `player.vimeo.com`, where it has always been read this way.
  A URL of that shape that was not a share link resolves to a video id and a
  hash Vimeo will not recognise, where before it was refused outright.

Each widening is bounded to one extra path segment. A trailing slash, an empty
hash, a doubled slash and a third segment stay refused on both Vimeo hosts;
`/live/` reads one id segment and reads it on the full hosts only, exactly as
`/embed/` and `/shorts/` do. One refusal changed its **reason** without changing
its answer: a bad path on the no-cookie host now reads as _not readable_ rather
than _will not play_, because the host is recognised now and the path is what
fails — the same way `https://www.youtube.com/<id>` already read.

**Why `minor`.** This is an intentional behaviour change, so the level has to be
argued rather than assumed. What moved is one direction only: the set of strings
`detectSource` accepts grew, and nothing left it. No type, signature or field
changes, no reason a consumer branches on is retired, and every URL that
resolved before this resolves to the same source after it — the sweep behind
this change checked that rather than assuming it. So no consumer upgrading can
find a URL that stopped working; they can only find one that started. `patch`
would understate a public function answering for inputs it did not answer for
before, which is the surface growing. `major` would claim there is something to
do before upgrading, and there is nothing: the one thing a consumer might be
surprised by is the second consequence above, and that is a refusal becoming an
acceptance, not an acceptance changing its answer.

`@playdeck/react` is not bumped, and takes only the dependency patch every
dependent gets. `Root`'s `source` prop is where most consumers will meet this
widening, but it hands the string straight to `detectSource` — neither the prop
type, the detection call, nor the notice published for a refusal moves here.

`docs/provider-setup.md` listed all three as refused and now lists them as
accepted, alongside the boundaries above.
