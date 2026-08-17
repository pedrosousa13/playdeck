---
'@reely/provider-youtube': minor
---

The YouTube provider now builds the embed iframe itself and hands the finished
element to the iframe API, instead of appending a `<div>` for the API to
replace with an iframe of its own. The API's documented alternative path adopts
a frame that already exists, so the attributes on that frame — the
`referrerpolicy="strict-origin-when-cross-origin"` this change is for among
them — are set here, before the element enters the document. That ordering is
the whole point: the `Referer` header leaves with the frame's first request, and
an attribute written after the frame has loaded changes nothing about a request
already sent. The Vimeo embed has declared the same policy since SIDEPRO-220;
this brings the second embed provider onto it (#221).

**What this does not do, stated plainly.** It does not narrow the `Referer`
header, because that header was already narrow. `www-widgetapi.js` — the script
`iframe_api` loads, read at player build `b0d2d49a` and confirmed against a real
player in a browser — sets `referrerPolicy="strict-origin-when-cross-origin"` on
the iframe it builds, alongside `frameBorder`, `allowfullscreen`, `allow` and
`title`. So a Reely YouTube embed was already sending only the page's origin in
that header. What changes is who guarantees it: Google serves that script
unversioned and mutable, so the guarantee was theirs to withdraw on their
schedule, and it is now this repo's to keep.

**What it does narrow is the embed url.** When the API composes that url it
appends `forigin=<the embedding page's full URL>`, plus `aoriginsup`, plus
`gporigin` and `widget_referrer` where a referrer exists. The page's path and
query therefore reached YouTube in the query string whatever the referrer policy
said — a `referrerpolicy` was never going to stop that, which is the part the
issue behind this change had not established. Reely's own url carries the video,
`enablejsapi=1` and the player vars this adapter has always set, and none of
those parameters. That is a real narrowing and also a behavioural change on
Google's side of the frame that nothing here can test: whatever those parameters
are for, this embed no longer reports them.

Everything else about the embed is preserved deliberately rather than by
accident. The `host` allowlist is untouched and now decides the origin of the
url the iframe carries, falling back to `https://www.youtube-nocookie.com` for
anything unrecognised exactly as before. Every player var still travels —
`autoplay`, `controls`, the `loop`-plus-`playlist` pairing, `start`,
`playsinline`, `rel` and the declared embedding `origin` — as query parameters
rather than as constructor options, because the API reads neither `videoId` nor
`playerVars` when the element it is given is already an iframe. The `allow` list
is the API's own, restated verbatim: `accelerometer`, `autoplay`,
`clipboard-write`, `encrypted-media`, `gyroscope`, `picture-in-picture` and
`web-share`, so this frame is granted neither more nor less than the API's was.
Narrowing it is a separate decision with its own capability consequences and is
not folded in here. `allowfullscreen`, the `title`, and the `100%` width and
height are the API's too; `frameBorder="0"` becomes an inline `border: 0`, which
is how the Vimeo embed spells the same thing.

`YouTubeProviderOptions` is unchanged — this introduces no option, and the
referrer policy is not consumer-configurable, exactly as it is not for Vimeo.
One exported type changes, and only a caller who injects their own
`loadIframeApi` can notice: **`YouTubePlayerConstructor` takes an
`HTMLIFrameElement`** rather than an `HTMLElement`, because that is what the
adapter now hands it. Constructor parameters are checked contravariantly, so an
injected fake typed against the wider element type still satisfies it.

`YouTubePlayerOptions` keeps every field it declared. The adapter now sets only
`events` — `host`, `videoId`, `width`, `height` and `playerVars` are read by the
API on the `<div>` path and ignored on this one — but they remain optional
members of a public type, so an existing fake that names them still compiles. A
fake that used them to build its own iframe should read the `src` of the iframe
it is handed instead, which is where the whole embed is described now.

`minor` rather than `patch`: every package is still at `0.0.0`, and under 0.x
this repo sends breaking changes on `minor`.

This is verified against a real player, not only against a stand-in —
`e2e/youtube-real.spec.ts` now asserts the attribute on the attached frame, and
that spec is the manually-run `REELY_REAL_PROVIDERS=1` suite rather than a CI
one. Wistia gets no code change and can get none: its frame is written into a
vendor element's shadow root, so the only remedy there is a page-level
`Referrer-Policy` response header on the embedding page, which is the consuming
application's call. `docs/third-party-requests.md` now carries the referrer
account for all three embed providers, that remedy included.
