# Provider setup

Which source values each provider accepts, what each provider's own options are,
and a working player per provider. Read against
`packages/core/src/source-detection.ts` — the detector itself, not a provider's
own documentation — because a form a provider publishes is not a form this
library reads. Every accepted form below is cited to the line that accepts it,
and the refused ones are named too: a setup guide that lists a form the detector
turns down is worse than one that lists fewer.

Nothing here is an install step. `@playdeck/react` depends on all five provider
packages and imports each one dynamically, so a YouTube or Vimeo source needs no
extra package, no registration and no configuration — only a source value
`detectSource` recognises. When it does not recognise one, the player publishes
the refusal naming the value it turned down; see [What a refusal
reads like](#what-a-refusal-reads-like).

## The `source` prop

`Player.Root`'s `source` takes what `detectSource` takes: a URL string, or an
explicit source object. A string is resolved to a provider by its host and path;
an object names its provider itself. Both are validated, and a value that fails
never reaches a provider.

`controls`, `loop`, `startTime` and `endTime` are Playdeck's own props on `Root`
and work the same on every provider ([ADR-0004](adr/0004-cross-provider-options-live-on-root.md)).
Everything one provider alone has goes in `providerOptions`, keyed by provider.

## Shared rules for a source string

These run before any host is looked at, and they refuse a string outright
(`source-detection.ts:276-321`).

| Rule                                                                                                                                                      | Line   |
| --------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| Non-empty, and equal to its own `trim()` — a leading or trailing space is refused rather than trimmed. No raw tab, line feed or carriage return anywhere. | `:279` |
| No `%` that is not followed by two hex digits.                                                                                                            | `:286` |
| Scheme must be `http:` or `https:`, or absent. Everything else — `javascript:`, `data:`, `file:`, and `blob:` too — is refused for a string.              | `:290` |
| A scheme must be followed by `//`: `https:clip.mp4` and `https:/host/clip.mp4` are refused.                                                               | `:310` |
| A protocol-relative `//host/…` must have a non-`/` after the two slashes.                                                                                 | `:294` |
| The URL must parse.                                                                                                                                       | `:314` |

Scheme-less forms are accepted for every provider: protocol-relative
(`//host/clip.mp4`), root-relative (`/clip.mp4`) and relative (`clip.mp4`). A
protocol-relative URL is resolved against `https:` and it is the resolved value
that is carried forward, never the `//host/…` the caller wrote
(`:300`, `resolveNetworkPath`).

`blob:` is refused for a string because no source type has been resolved yet. It
is accepted inside an explicit `{ type: 'video' }` object, and only there — see
[Explicit source objects](#explicit-source-objects).

## YouTube

Hosts (`:129-135`): `youtube.com`, `www.youtube.com`, `m.youtube.com`,
`music.youtube.com`, `youtu.be`, `www.youtu.be`.

A video id is `[A-Za-z0-9_-]+` (`:22`). Accepted path shapes (`:150-169`):

| Form                                   | Host                    | Line   |
| -------------------------------------- | ----------------------- | ------ |
| `https://www.youtube.com/watch?v=<id>` | any host but `youtu.be` | `:162` |
| `https://www.youtube.com/embed/<id>`   | any host but `youtu.be` | `:157` |
| `https://www.youtube.com/shorts/<id>`  | any host but `youtu.be` | `:157` |
| `https://youtu.be/<id>`                | `youtu.be` only         | `:156` |

Non-obvious, and accepted: any other query parameter is ignored, so
`…/watch?v=<id>&t=42&list=<playlist>` resolves to that video — the timestamp and
the playlist are dropped rather than refusing the URL. Use `Root`'s `startTime`
prop for an offset.

Refused — the first five because the shape is not one of the four above, the
last because the host is not one of the six:

- `https://www.youtube.com/<id>` — a bare id path is read on `youtu.be` only.
- `https://youtu.be/embed/<id>` — `/embed/` and `/shorts/` are read on the full
  hosts only.
- `https://www.youtube.com/live/<id>`, `/playlist?list=…`, `/@handle` — no
  shape reads them.
- `https://www.youtube.com/watch?v=<a>&v=<b>` — two `v` parameters are
  ambiguous, so it fails here rather than in the provider (`:162`).
- `https://www.youtube-nocookie.com/embed/<id>` — that host is where the embed
  is _served_, chosen by the `host` option below. It is not a source host.

`providerOptions.youtube` accepts `host` and `loadIframeApi`
(`packages/react/src/provider-loaders.ts`, `PlayerProviderOptions`). `host`
moves the embed off the privacy-enhanced `https://www.youtube-nocookie.com`
default; only `https://www.youtube.com` and that default are honoured, and any
other value falls back rather than throwing. `loadIframeApi` supplies the iframe
API yourself instead of fetching `https://www.youtube.com/iframe_api`. See
[Third-party requests and CSP](third-party-requests.md) for what a page's CSP
has to allow, and [`@playdeck/provider-youtube`](../packages/provider-youtube)
for what the adapter reports.

<!-- example:provider-setup-youtube -->

```tsx
import * as Player from '@playdeck/react';

// A YouTube source is a URL in the `source` prop and nothing else: nothing to
// install, nothing to register. `detectSource` reads the video id out of the
// `v` parameter, and `@playdeck/react` imports the YouTube provider once it has.
export const YouTubeClip = () => (
  <Player.Root
    // `controls`, `loop`, `startTime` and `endTime` are Playdeck's own props on
    // every provider (ADR-0004), never keys in the bag below.
    controls={false}
    // Everything YouTube alone has lives here. `host` moves the embed off the
    // privacy-enhanced youtube-nocookie.com default; only the two origins
    // YouTube serves the embed from are honoured.
    providerOptions={{ youtube: { host: 'https://www.youtube.com' } }}
    source="https://www.youtube.com/watch?v=dQw4w9WgXcQ"
  >
    <Player.Viewport>
      <Player.Media />
      <Player.Controls>
        <Player.PlayButton />
        <Player.SeekSlider />
        <Player.Time type="current" />
        <Player.FullscreenButton />
      </Player.Controls>
      {/* A source YouTube's own URL forms do not cover is refused by
          `detectSource`, and the refusal names the URL it turned down. */}
      <Player.ErrorDisplay />
    </Player.Viewport>
  </Player.Root>
);
```

<!-- /example -->

## Vimeo

Hosts (`:137-140`): `vimeo.com`, `www.vimeo.com`, `player.vimeo.com`.

A video id is digits only (`:26`) and a privacy hash is `[A-Za-z0-9]+` (`:29`).
Accepted path shapes (`:171-197`):

| Form                                         | Host                         | Line   |
| -------------------------------------------- | ---------------------------- | ------ |
| `https://vimeo.com/<id>`                     | `vimeo.com`, `www.vimeo.com` | `:178` |
| `https://player.vimeo.com/video/<id>`        | `player.vimeo.com`           | `:175` |
| `https://player.vimeo.com/video/<id>/<hash>` | `player.vimeo.com`           | `:175` |
| any of the above with `?h=<hash>`            | either                       | `:181` |

An unlisted video's hash reaches the embed whichever way it arrives. Where both
arrive, the `?h=` query hash wins over the path hash (`:195`).

Refused:

- `https://vimeo.com/<id>/<hash>` — the share link Vimeo hands out for an
  unlisted video. On `vimeo.com` only `/<id>` is read, so pass the hash as
  `https://vimeo.com/<id>?h=<hash>` or use the `player.vimeo.com` form.
- `https://vimeo.com/channels/<channel>/<id>`,
  `https://vimeo.com/groups/<group>/videos/<id>`,
  `https://vimeo.com/ondemand/<slug>` — none is `/<id>`.
- `?h=<a>&h=<b>` — two hashes are ambiguous (`:186`).
- `?h=` holding anything outside `[A-Za-z0-9]` (`:187`).

`providerOptions.vimeo` accepts `dnt`, `customControls` and
`suppressSeoMetadata`. `dnt` asks Vimeo not to track the session and is on
unless you turn it off. `customControls: true` is what makes Playdeck probe
whether the account behind the video is on a tier that allows chromeless
playback — without it no probe request is made at all. `suppressSeoMetadata`
stops the SDK sending the embedding page's own URL to the embed, and is
page-wide rather than per-player. All three are documented in full in
[`@playdeck/provider-vimeo`](../packages/provider-vimeo).

<!-- example:provider-setup-vimeo -->

```tsx
import * as Player from '@playdeck/react';

// A Vimeo source is a URL in the `source` prop, the same as every other
// provider. `?h=` carries the privacy hash of an unlisted video, which
// `detectSource` keeps and hands to the embed.
export const VimeoClip = () => (
  <Player.Root
    controls={false}
    // Everything Vimeo alone has lives here. `dnt` asks Vimeo not to track the
    // session; `suppressSeoMetadata` stops the SDK sending the page's own URL
    // to the embed, and is page-wide rather than per-player.
    providerOptions={{ vimeo: { dnt: true, suppressSeoMetadata: true } }}
    source="https://vimeo.com/76979871?h=8272103f6e"
  >
    <Player.Viewport>
      <Player.Media />
      <Player.Controls>
        <Player.PlayButton />
        <Player.SeekSlider />
        <Player.Time type="current" />
        <Player.FullscreenButton />
      </Player.Controls>
      {/* Vimeo has more URL forms than Playdeck reads. A form it does not read
          is refused by `detectSource`, and the refusal names the URL. */}
      <Player.ErrorDisplay />
    </Player.Viewport>
  </Player.Root>
);
```

<!-- /example -->

## The other three providers

Covered here as well, because the detector treats all five the same way.

**Wistia.** Hosts are `wistia.com`, `wistia.net` and any subdomain of either —
matched on the suffix, because the account subdomain is per-customer and cannot
be enumerated (`:144-148`). A media id is `[A-Za-z0-9]+` (`:32`), and the
accepted paths are `/medias/<id>`, `/embed/medias/<id>` and
`/embed/iframe/<id>` (`:202-210`). Wistia is the one host set where a
non-embed path is not refused outright: it serves media files itself, so a
Wistia URL that is not an embed shape is read by file extension before failing
(`:336-347`). `providerOptions.wistia` accepts `controls`, `dnt`,
`playerColor`, `swatch`, `poster` and `transparentLetterbox`.

**Native files and HLS.** These have no host list at all — the extension of the
path decides, on any host and on relative paths too (`:115-127`, `:350`). The
extension is read from the path before the first `?` or `#`, so a query string
does not hide it, and the match is case-insensitive.

| Extension | Resolves to                                         |
| --------- | --------------------------------------------------- |
| `.mp4`    | `{ type: 'video', sources: [{ …, 'video/mp4' }] }`  |
| `.webm`   | `{ type: 'video', sources: [{ …, 'video/webm' }] }` |
| `.m3u8`   | `{ type: 'hls', src }`                              |

Neither takes a `providerOptions` key: everything either provider reads is one
of `Root`'s own props (`controls`, `loop`, `startTime`, `endTime`). An HLS
engine is chosen per browser, and is pinned through an explicit source object
rather than through options — see below.

Any other URL — a host no provider claims and a path with none of those three
extensions — is refused. There is no fall-back provider that tries it anyway.

## Explicit source objects

An object skips host and path detection and names its provider itself. The same
validation runs, and the same shared allowlist runs over every `src` it carries,
so `javascript:` and `data:` cannot reach a provider by taking this path
(`:215-274`).

| Object                                               | Validated on                                                                  |
| ---------------------------------------------------- | ----------------------------------------------------------------------------- |
| `{ type: 'youtube', videoId }`                       | `videoId` matches `[A-Za-z0-9_-]+`                                            |
| `{ type: 'vimeo', videoId, hash? }`                  | `videoId` is digits; `hash`, if given, matches `[A-Za-z0-9]+`                 |
| `{ type: 'wistia', mediaId }`                        | `mediaId` matches `[A-Za-z0-9]+`                                              |
| `{ type: 'hls', src, engine? }`                      | `src` non-empty and allowed; `engine` is `auto`, `native` or `hls.js`         |
| `{ type: 'video', sources: [{ src, mimeType }, …] }` | at least one entry, each with a non-empty `src` and `mimeType`, `src` allowed |

`{ type: 'video' }` is the one place a `blob:` URL is accepted, which is how an
in-page object — a `MediaSource`, a picked `File` — is handed over. An `hls`
source refuses `blob:` because its manifest loader fetches the URL itself.

Anything else — a missing field, an id in the wrong shape, a value that is
neither a string nor an object — is refused as `invalid-source`.

## What a refusal reads like

A refused source is published on `PlayerState.error` and rendered by
`Player.ErrorDisplay`. The message names which of the three failures occurred
and quotes the value that was rejected, truncated to 120 characters:

**Not readable** — a string that broke one of the shared rules, or a recognised
provider host in a path shape not listed above:

> Playdeck could not read a video from the player source "…" — it is either not
> a well-formed URL, or a provider URL in a form Playdeck does not read.

**No provider** — a well-formed URL whose scheme the allowlist refuses, or whose
host no provider claims and whose path carries none of the three extensions:

> Playdeck has no provider for the player source "…" — its scheme or its host is
> not one Playdeck plays.

**Not a source object** — a value that is not a string and does not validate as
one of the objects above:

> The player source … is not a source object Playdeck accepts.

None of the three is recoverable: a retry re-reads the same `source` prop and
the same rules refuse it again, so no control offers one. Fix the value.

A player that fails _after_ the source resolved reports something else —
`Unable to load the <provider> provider.` — which names the provider being
loaded and says the reason is not knowable from there. The rejection that caused
it is carried on the error's `cause`. A dynamic import the network never
delivered, a Content-Security-Policy that refused the chunk and an adapter that
threw all arrive the same way, so the message does not guess between them.
