# Policing the address a media URL points at

Playdeck does not refuse a media URL because of the address behind it. Loopback,
link-local and the private ranges all pass, and so does a hostname that resolves
to any of them. The source allowlist decides **schemes** — `http:`, `https:`, and
`blob:` for a `video` source — and has no opinion about hosts or addresses.

## Why this is out of scope

Three reasons. Each is sufficient on its own.

**Playdeck never fetches a consumer-supplied URL.** The library makes exactly one
request of its own initiative: Vimeo's oEmbed endpoint, a hardcoded
`https://vimeo.com/api/oembed.json` carrying a video id already validated as
digits, and only when a consumer opts into chromeless playback. Every other load
is issued by the browser from markup Playdeck renders — `<source src>`,
`<video poster>`, `<track src>`, `<img src>`, `<iframe src>` — or by hls.js
fetching its own manifest and segments in the page.

That is what makes the SSRF framing the wrong shape. Server-side request forgery
is a server issuing requests to addresses it can reach and the attacker cannot.
Here the request comes from the end user's browser, on the end user's network. A
source pointed at `169.254.169.254` reaches that user's own link-local address,
not a cloud metadata service — the metadata case only exists where the player is
running _inside_ a cloud instance, in a headless browser doing SSR, screenshots
or thumbnails. That is a real deployment, but one where network egress is the
operator's policy to set and enforce, not a player library's to guess at.

**The browser already enforces most of it.** On an HTTPS page — which any
deployment where this matters will be — mixed-content blocking refuses `http:`
subresources to the private ranges outright, before Playdeck could have an opinion.
Loopback is the deliberate exception, since browsers treat it as potentially
trustworthy, which leaves `http://127.0.0.1:<port>/` as the one address that
still loads. What that buys an attacker is a local port probe by load-success
timing, and Private Network Access is progressively closing even that.

**A string-level control can only ever be partial.** A browser library cannot
resolve DNS, so inspecting the URL catches literal addresses and nothing else.
`http://10.0.0.5/clip.mp4` would be refused while `http://internal.corp.example/clip.mp4`
resolving to the same host sails through. Shipping that advertises an address
policy Playdeck cannot actually enforce, and a consumer who believes Playdeck screens
addresses is worse off than one who knows it does not.

## Where the boundary actually is

Content Security Policy, which `docs/third-party-requests.md` already documents
per provider — `connect-src` for the hls.js engine's manifest and segment
fetches, `media-src` for the native engine and `<source>`, `img-src` for posters
and artwork. A consumer who needs addresses policed sets a CSP, and that control
binds every request the page makes rather than only the ones routed through
Playdeck's source parsing.

Observability is handled separately and is not part of this rejection:
[#223](https://github.com/pedrosousa13/playdeck/issues/223) gives the consumer a
signal when an `http:` URL reaches the sink, which is the proportionate answer
for a client-side library — report what was handed over, do not silently
override it.

## What would reopen this

- **Playdeck growing a non-browser fetch path.** If any code path ever requests a
  consumer-supplied URL from a server or a Node context, the SSRF analysis above
  stops applying to it and that path needs its own answer.
- **A supported headless or server-side rendering mode**, where Playdeck knowingly
  runs inside infrastructure whose metadata endpoint is reachable.
- **Browsers changing the loopback exemption**, or mixed-content behaviour, in a
  way that alters which of these addresses actually load.

Each of those is a change in what Playdeck does, not a re-argument of the same
request — raise it as that.

## Prior requests

- [#246](https://github.com/pedrosousa13/playdeck/issues/246) — Private, loopback
  and link-local media URLs are permitted, so a source can reach the cloud
  metadata service.

Related but distinct:
[#219](https://github.com/pedrosousa13/playdeck/issues/219) settled the scheme
allowlist and deliberately scoped itself to schemes, splitting the address
question out to #246 rather than answering it.
