// `Root`'s `warmUp` prop reads both halves of this module: which `preconnect`
// origins to render for a detected source, and which provider chunk to start
// importing ahead of activation. Neither is derived from a consumer-supplied
// URL -- both are keyed by the resolved source's own `type`, the discriminant
// `detectSourceWithProviders` (`provider-loaders.ts`) already settles before
// either of these is ever consulted, so a source on a look-alike host
// (`youtube.com.evil.example`, `notyoutube.com`) never reaches either list: it
// fails detection outright, the same way it does today, and resolves to no
// `type` this module recognises.

// The fixed, hard-coded allowlist of hint origins every source of that kind
// reaches at attach time regardless of consumer options, taken from
// `docs/third-party-requests.md`'s per-provider table: the script and embed
// hosts. Wistia's poster still shares a host already in this list (`fast.
// wistia.com`, the same host `player.js` is fetched from), so it carries no
// separate poster entry below -- unlike YouTube's and Vimeo's, which name a
// CDN host neither provider otherwise reaches. HLS and native media have no
// fixed third-party origin at attach time -- the manifest or media host is
// the consumer's own, never Playdeck's -- so neither kind carries an entry
// here.
const PRECONNECT_ORIGINS_BY_PROVIDER: Readonly<
  Record<string, readonly string[]>
> = {
  youtube: ['https://www.youtube.com', 'https://www.youtube-nocookie.com'],
  vimeo: ['https://player.vimeo.com'],
  wistia: [
    'https://fast.wistia.net',
    'https://fast.wistia.com',
    'https://embed.wistia.com',
    'https://embed-ssl.wistia.com',
    'https://embed-fastly.wistia.com'
  ]
};

// The still `poster="provider"` resolves to is a further opt-in on top of
// `warmUp` itself -- `Root`'s own `poster` prop -- so the CDN host it comes
// from is hinted only when that opt-in is also set, never unconditionally
// the way the origins above are. Per `docs/third-party-requests.md`: YouTube's
// still is `i.ytimg.com`, derived from the video id alone and fetched by
// `Player.Poster`'s own `<img>`; Vimeo's is `i.vimeocdn.com`, read off the
// `customControls` probe's oEmbed response. Neither host appears above for
// that reason -- they are not reached merely because a source of that kind
// was detected, only because the still was asked for.
const PRECONNECT_POSTER_ORIGINS_BY_PROVIDER: Readonly<
  Record<string, readonly string[]>
> = {
  youtube: ['https://i.ytimg.com'],
  vimeo: ['https://i.vimeocdn.com']
};

// `resolvesProviderPoster` is `Root`'s own `poster === 'provider'`, read by
// the caller -- this module has no opinion on `Root`'s props beyond the
// provider `type` and this one boolean, both handed in rather than read off
// a prop bag here. No entry for a given `type` -- `hls`, `video`, or a
// supplied kind this module has never heard of -- reads as no hints, the
// same empty answer a source that failed detection altogether gets, in
// either list.
export const preconnectOriginsFor = (
  type: string,
  resolvesProviderPoster: boolean
): readonly string[] => {
  const base = PRECONNECT_ORIGINS_BY_PROVIDER[type] ?? [];
  if (!resolvesProviderPoster) return base;
  const poster = PRECONNECT_POSTER_ORIGINS_BY_PROVIDER[type] ?? [];
  return poster.length === 0 ? base : [...base, ...poster];
};

// Starts the same dynamic import `loadProvider` (`provider-loaders.ts`) would
// make once activation actually attaches, ahead of that attach, so the
// module is already resolving -- or resolved -- by the time a real load asks
// for it. Each `import()` target is a literal, the same constraint
// `loadProvider`'s own five branches are already written under, so a
// bundler can still split every provider into its own chunk; this mirrors
// that dispatch rather than sharing it, since nothing here needs the adapter
// `loadProvider` builds from the module, only the module itself in cache.
//
// A supplied kind's own chunk is reached through a `providers` registration's
// own `load()`, not a static specifier this function could name, so an
// `undefined` or unrecognised `type` -- including every supplied kind -- warms
// nothing.
export const warmProviderChunk = (type: string | undefined): void => {
  if (type === 'hls') {
    void import('@playdeck/provider-hls');
  } else if (type === 'video') {
    void import('@playdeck/provider-native');
  } else if (type === 'youtube') {
    void import('@playdeck/provider-youtube');
  } else if (type === 'vimeo') {
    void import('@playdeck/provider-vimeo');
  } else if (type === 'wistia') {
    void import('@playdeck/provider-wistia');
  }
};
