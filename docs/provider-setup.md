# Provider setup

Which source values each provider accepts, what each provider's own options are,
and a working player per provider. These are `detectSource`'s rules, not a
provider's own documentation, because a form a provider publishes is not a form
this library reads. The refused forms are named alongside the accepted ones: a
setup guide that lists a form the detector turns down is worse than one that
lists fewer. Every claim here was checked by running the detector, not by
reading it.

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

These run before any host is looked at, and they refuse a string outright.

| Rule                                                                                                                                                                                     |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Non-empty, and equal to its own `trim()` — a leading or trailing space is refused rather than trimmed. No raw tab, line feed or carriage return anywhere.                                |
| No space and no C0 control character (U+0000 to U+001F) at either end. These are what the URL parser would strip before parsing, so the value that plays would not be the value checked. |
| No `%` that is not followed by two hex digits.                                                                                                                                           |
| Scheme must be `http:` or `https:`, or absent. Everything else — `javascript:`, `data:`, `file:`, and `blob:` too — is refused for a string.                                             |
| A scheme must be followed by `//`: `https:clip.mp4` and `https:/host/clip.mp4` are refused.                                                                                              |
| A protocol-relative `//host/…` must have a non-`/` after the two slashes.                                                                                                                |
| The URL must parse.                                                                                                                                                                      |

The two whitespace rules overlap but are not the same rule, and they do not
report the same way. A trailing **space** is caught by the `trim()` comparison
and reads as _not readable_; a trailing **control character** is invisible, gets
past that comparison, and reads as _will not play_ — see
[What a refusal reads like](#what-a-refusal-reads-like). If a URL that looks
correct is refused, an invisible character copied in with it is the first thing
to check.

Scheme-less forms are accepted for every provider: protocol-relative
(`//host/clip.mp4`), root-relative (`/clip.mp4`) and relative (`clip.mp4`). A
protocol-relative URL is resolved against `https:` and it is the resolved value
that is carried forward, never the `//host/…` the caller wrote.

`blob:` is refused for a string because no source type has been resolved yet. It
is accepted inside an explicit `{ type: 'video' }` object, and only there — see
[Explicit source objects](#explicit-source-objects).

## YouTube

Eight hosts, and the path shapes differ between two groups of them:

- the **short hosts** — `youtu.be` and `www.youtu.be`;
- the **full hosts** — `youtube.com`, `www.youtube.com`, `m.youtube.com`,
  `music.youtube.com`, `youtube-nocookie.com` and `www.youtube-nocookie.com`.

A video id is `[A-Za-z0-9_-]+`. Accepted path shapes:

| Form                                   | Host        |
| -------------------------------------- | ----------- |
| `https://www.youtube.com/watch?v=<id>` | full hosts  |
| `https://www.youtube.com/embed/<id>`   | full hosts  |
| `https://www.youtube.com/live/<id>`    | full hosts  |
| `https://www.youtube.com/shorts/<id>`  | full hosts  |
| `https://youtu.be/<id>`                | short hosts |

`/live/` is the canonical URL for a live broadcast. The privacy-preserving
`youtube-nocookie.com` is a full host like any other, so
`https://www.youtube-nocookie.com/embed/<id>` — the form that host actually
serves — is read, and so are the other full-host shapes on it.

Non-obvious, and accepted: any other query parameter is ignored, so
`…/watch?v=<id>&t=42&list=<playlist>` resolves to that video — the timestamp and
the playlist are dropped rather than refusing the URL. Use `Root`'s `startTime`
prop for an offset.

Non-obvious, and accepted: on a short host the whole path segment is the id, so
a segment that fits `[A-Za-z0-9_-]+` is read as one unless it is a full-host
path keyword — those five are refused, and are the next entry below. Everything
else resolves, so `watchAgain1`, `rewatching1` and `watch-later` are ordinary
ids and resolve as themselves.

Refused, because the shape is not one of the five above:

- `https://www.youtube.com/<id>` — a bare id path is read on the short hosts
  only.
- `https://youtu.be/watch?v=<id>` — a short host with a **full-host path
  keyword** as its only segment: `watch`, `embed`, `live`, `shorts` or
  `playlist`, in any case. This one combines the two forms and is the likeliest
  to be written by hand. It used to resolve, to the video id `watch` rather than
  to `<id>`, and then fail at YouTube rather than here; it is refused now, so
  the refusal names the URL and the `v` parameter is never mistaken for
  something this form reads. On a short host, pass only
  `https://youtu.be/<id>`.
- `https://youtu.be/embed/<id>`, `https://www.youtu.be/shorts/<id>`,
  `https://youtu.be/live/<id>` — `/embed/`, `/live/` and `/shorts/` are read on
  the full hosts only, and this holds for both short hosts.
- `https://www.youtube.com/live/<id>/<anything>` — each of the three path
  shapes reads one segment after it and nothing more.
- `/playlist?list=…`, `/@handle` — no shape reads them.
- `https://www.youtube.com/watch?v=<a>&v=<b>` — two `v` parameters are
  ambiguous, so it fails here rather than in the provider.

`providerOptions.youtube` accepts `host` and `loadIframeApi`. `host` moves the
embed off the privacy-enhanced `https://www.youtube-nocookie.com` default, which
is a privacy trade to make deliberately; only `https://www.youtube.com` and that
default are honoured, and any other value falls back rather than throwing. A
source URL never chooses that origin — a detected YouTube source is a video id
and nothing else — so a `youtube-nocookie.com` source URL is not a second way to
set `host`. It does not need to be: the default embed origin already _is_ the
no-cookie one, so a source copied from that host loads from that host unless
`host` moves it.
`loadIframeApi` supplies the iframe API yourself instead of fetching
`https://www.youtube.com/iframe_api`. See
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
    // every provider (ADR-0004), never keys in a provider's option bag.
    controls={false}
    // No `providerOptions`: every YouTube default is the one to start from. The
    // embed loads from youtube-nocookie.com unless you move it, and moving it
    // is a decision to make deliberately, not to inherit from an example.
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

Hosts: `vimeo.com`, `www.vimeo.com`, `player.vimeo.com`.

A video id is digits only and a privacy hash is `[A-Za-z0-9]+`. Accepted path
shapes:

| Form                                         | Host                         |
| -------------------------------------------- | ---------------------------- |
| `https://vimeo.com/<id>`                     | `vimeo.com`, `www.vimeo.com` |
| `https://vimeo.com/<id>/<hash>`              | `vimeo.com`, `www.vimeo.com` |
| `https://player.vimeo.com/video/<id>`        | `player.vimeo.com`           |
| `https://player.vimeo.com/video/<id>/<hash>` | `player.vimeo.com`           |
| any of the above with `?h=<hash>`            | either                       |

`https://vimeo.com/<id>/<hash>` is the share link Vimeo hands out for an
unlisted video — what you copy out of Vimeo's own UI. An unlisted video's hash
reaches the embed whichever way it arrives. Where both arrive, the `?h=` query
hash wins over the path hash.

Non-obvious, and a trap: the **whole segment after the id is taken as the
hash**, whatever it says. A real Vimeo page such as
`https://vimeo.com/<id>/likes` or `https://vimeo.com/<id>/settings` therefore
resolves — to that video with the hash `likes` or `settings` — and the embed
fails at Vimeo rather than here. A hash is not distinguishable from any other
alphanumeric segment, on this host or on `player.vimeo.com`, where it has always
read this way. Pass `https://vimeo.com/<id>` for a public video.

Refused:

- `https://vimeo.com/<id>/`, `https://vimeo.com/<id>//<hash>`,
  `https://vimeo.com/<id>/<hash>/<anything>` — the hash is a whole segment of
  `[A-Za-z0-9]`, so an empty one, a doubled slash and a third segment all miss
  the shape above.
- `https://vimeo.com/channels/<channel>/<id>`,
  `https://vimeo.com/groups/<group>/videos/<id>`,
  `https://vimeo.com/ondemand/<slug>` — none is `/<id>`.
- `?h=<a>&h=<b>` — two hashes are ambiguous.
- `?h=` holding anything outside `[A-Za-z0-9]`.

`providerOptions.vimeo` accepts `dnt`, `customControls` and
`suppressSeoMetadata`. `dnt` asks Vimeo not to track the session and is on
unless you turn it off. `customControls: true` is what makes Playdeck probe
whether the account behind the video is on a tier that allows chromeless
playback — without it no probe request is made at all, so no viewer is disclosed
to Vimeo before anyone has asked for the capability. `suppressSeoMetadata` stops
the SDK sending the embedding page's own URL to the embed; it is page-wide
rather than per-player, so switching it on silences that handshake for every
Vimeo embed on the page, including ones Playdeck did not create. All three are
documented in full in [`@playdeck/provider-vimeo`](../packages/provider-vimeo).

<!-- example:provider-setup-vimeo -->

```tsx
import * as Player from '@playdeck/react';

// A Vimeo source is a URL in the `source` prop, the same as every other
// provider. `?h=` carries the privacy hash of an unlisted video, which
// `detectSource` keeps and hands to the embed.
export const VimeoClip = () => (
  <Player.Root
    controls={false}
    // No `providerOptions`: `dnt` is already on by default, and
    // `suppressSeoMetadata` silences the SDK handshake for every Vimeo embed on
    // the page, not just this one. That blast radius is a decision to make
    // deliberately, not to inherit from an example.
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
be enumerated. A media id is `[A-Za-z0-9]+`, and the accepted paths are
`/medias/<id>`, `/embed/medias/<id>` and `/embed/iframe/<id>`. Wistia is the one
host set where a non-embed path is not refused outright: it serves media files
itself, so a Wistia URL that is not an embed shape is read by file extension
before failing. `providerOptions.wistia` accepts `controls`, `dnt`,
`playerColor`, `swatch`, `poster` and `transparentLetterbox`.

**Native files and HLS.** These have no host list at all — the extension of the
path decides, on any host and on relative paths too. The extension is read from
the path before the first `?` or `#`, so a query string does not hide it, and
the match is case-insensitive.

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
extensions — is refused. There is no fall-back provider that tries it anyway, so
`clip.avi` and `https://example.com/clip.avi` are both refused on the extension:
in the first there is no host to blame at all.

## Explicit source objects

An object skips host and path detection and names its provider itself. The same
validation runs, and the same shared allowlist runs over every `src` it carries,
so `javascript:` and `data:` cannot reach a provider by taking this path.

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

**Will not play** — the reason that cannot name a single cause, so it states the
requirement instead. It covers a scheme the allowlist refuses, a control
character at either end, and a URL that simply matched nothing:

> Playdeck will not play the player source "…". An accepted source URL is
> http(s) or scheme-less, carries no control character at either end, and is
> either a YouTube, Vimeo or Wistia URL or a path ending .mp4, .webm or .m3u8.

**Not a source object** — a value that is not a string and does not validate as
one of the objects above:

> The player source … is not a source object Playdeck accepts.

None of the three is recoverable: a retry re-reads the same `source` prop and
the same rules refuse it again, so no control offers one. Fix the value.

### When the provider fails to load

A player that fails _after_ the source resolved reports something else:

> Unable to load the &lt;provider&gt; provider. Playdeck cannot say why: the
> rejection it caught is on this error's cause. See
> https://github.com/pedrosousa13/playdeck/blob/main/docs/provider-setup.md for
> what to check.

The provider is named because the resolved source knows it. The reason is not,
and is not guessable: a dynamic import the network never delivered, a
Content-Security-Policy that refused the chunk, and an adapter factory that
threw all arrive as one rejection. What to check, in the order that resolves
this most often:

1. **The page's Content-Security-Policy.** An embed provider needs its origins
   allowed, and a policy that blocks them fails the load with nothing else to
   see. [Third-party requests and CSP](third-party-requests.md) lists every
   origin each provider reaches and the directive it falls under.
2. **The chunk actually arriving.** Each provider is a dynamic `import()`, so an
   offline network, a stale deploy or an asset host returning HTML for a missing
   chunk all land here. The browser's network panel says which.
3. **`error.cause`.** The rejection itself is carried there for a consumer
   reading the error object — `usePlayerState((state) => state.error)`, or the
   `children` render prop on `Player.ErrorDisplay`. It is not rendered by
   `ErrorDisplay`'s default output, which draws the message and nothing else.

Unlike a refused source, this one **is** recoverable: `ErrorDisplay` offers a
retry and `ActivationButton` arms, because a load that failed on the network can
succeed on a second attempt.
