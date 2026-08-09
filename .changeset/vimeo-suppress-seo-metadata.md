---
'@reely/provider-vimeo': patch
'@reely/react': patch
---

`VimeoProviderOptions` gains `suppressSeoMetadata`, an opt-in switch that stops
the Vimeo SDK sending the embedding page's full URL — path and query included —
to the embed frame.

`@vimeo/player` installs a `window` `message` listener at module scope. When a
frame whose src matches its embed pattern completes the readiness handshake, the
listener answers it with `appendVideoMetadata` carrying `window.location.href`.
The url Reely builds matches that pattern, so Reely's own embed is the frame it
resolves. The `referrerpolicy="strict-origin-when-cross-origin"` set on that
iframe does not prevent this — that narrows the iframe's own request header, and
this is a message sent afterwards — and neither does `dnt=1`. So any app
carrying an identifier, a search term or a session-adjacent value in a path
segment or query string was sending it to the embed on every Vimeo attach, with
default options. Reproduced in a real browser by `e2e/vimeo-seo-metadata.spec.ts`
rather than read off the bundle.

With `suppressSeoMetadata: true`, Reely sets the SDK's own guard global before
the dynamic import, so the listener is never installed. Reachable from
`Player.Root` as `providerOptions={{ vimeo: { suppressSeoMetadata: true } }}`.
Two consequences it is opt-in because of, both documented in
`packages/provider-vimeo/README.md` and `docs/third-party-requests.md`:

- **The suppression is page-wide, not per-embed.** The SDK's guard is a `window`
  global, so it silences the handshake for every Vimeo embed on the page,
  including embeds Reely did not create. That blast radius is the consumer's to
  accept, not the library's to decide.
- **It takes effect on the first Vimeo attach, for the life of the page.** The
  SDK module is imported once and cached, and reads the guard while it
  evaluates, so a later attach cannot retroactively suppress anything. This is
  the vendor's design; nothing here re-imports or resets the cached module to
  pretend otherwise.

A page that has already set that global keeps its own value, in either
direction — Reely writes it only when it is not already set, and never writes it
at all with the option off or absent.

**Nothing changes by default.** With the option absent or `false`, Reely writes
nothing to the global and the handshake happens exactly as it did before. So
both packages land as `patch`: an added optional option that defaults to off
breaks nothing, and `@reely/react` moves only because
`PlayerProviderOptions.vimeo` now carries the key.

**A documentation correction rides along.** `packages/provider-vimeo/README.md`
and `docs/third-party-requests.md` both still said Vimeo has no
`PlayerProviderOptions` key and that `customControls` cannot be reached from
`Player.Root`. That stopped being true when the `vimeo` bag landed in #170, and
`provider-loaders.ts` has forwarded it since. Both documents now say so. No
behaviour changed with them — if you read either page and concluded the oEmbed
probe could never fire through the React path, re-read the `customControls`
note.
