import type {
  HlsSource,
  ResolvedPlayerSource,
  SourceDetectionFailure,
  SourceDetectionFailureReason,
  SourceDetectionResult,
  VideoFileSource,
  VimeoSource,
  WistiaSource,
  YouTubeSource
} from './types.js';

const explicitObjectGuidance =
  'Pass an explicit source object with a supported type and the required fields.';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === 'string' && value.trim().length > 0;

export const isYouTubeVideoId = (value: unknown): value is string =>
  isNonEmptyString(value) && /^[A-Za-z0-9_-]+$/.test(value);

export const isVimeoVideoId = (value: unknown): value is string =>
  isNonEmptyString(value) && /^\d+$/.test(value);

export const isVimeoHash = (value: unknown): value is string =>
  isNonEmptyString(value) && /^[A-Za-z0-9]+$/.test(value);

export const isWistiaMediaId = (value: unknown): value is string =>
  isNonEmptyString(value) && /^[A-Za-z0-9]+$/.test(value);

// The WHATWG URL parser strips U+0009, U+000A and U+000D anywhere in a URL
// before parsing, so a scheme split by one of them is not the scheme read
// here: `java<TAB>script:` yields no scheme at all, and the parser then
// resolves `javascript:`. A well-formed URL carries none of the three, so any
// occurrence is rejected outright rather than stripped, which keeps the value
// that plays identical to the value that was validated (#219).
const parserStrippedWhitespace = /[\t\n\r]/;

// Those three are what the parser strips anywhere; it also strips leading and
// trailing C0 controls (U+0000 to U+001F) and spaces, which the scheme read
// below is anchored past just the same: ` javascript:` names no scheme here
// and the parser then resolves `javascript:` (#326). Refused at either edge
// for the reason above rather than trimmed, so the whole set the parser
// pre-processes is a value this library never carries.
// An empty string needs no guard of its own: `charCodeAt` returns `NaN` there
// and every comparison against it is false.
const hasParserStrippedEdge = (url: string): boolean =>
  url.charCodeAt(0) <= 0x20 || url.charCodeAt(url.length - 1) <= 0x20;

const schemeOf = (url: string): string | undefined =>
  url.match(/^([a-z][a-z\d+.-]*):/i)?.[1]?.toLowerCase();

/**
 * Whether the library will carry a source URL to a provider. The one such
 * decision in the library, and it turns on two things: the URL must be
 * well-formed, and its scheme must be allowed for the source it belongs to.
 *
 * A URL the parser would strip characters off before parsing is refused,
 * whatever its apparent scheme, because the value it parses is not the value
 * checked here. That is a raw tab, line feed or carriage return anywhere --
 * `java<TAB>script:` names no scheme at all yet loads as `javascript:` -- and
 * a C0 control (U+0000 to U+001F) or a space at either end, which the parser
 * strips as well: ` javascript:` likewise names no scheme here and loads as
 * `javascript:`.
 *
 * Of the schemes, `http:`, `https:` and the scheme-less forms --
 * protocol-relative, root-relative and relative paths -- are permitted for
 * every source. `blob:` is permitted only for a `video` source, which is how a
 * consumer hands over an in-page object such as a `MediaSource` or a picked
 * `File`; an `hls` source refuses it because its manifest loader fetches the
 * URL itself. Everything else is refused.
 *
 * Pass the `type` of the {@link ResolvedPlayerSource} the URL belongs to, or
 * `undefined` for a bare string the player has not yet resolved to a type.
 */
export const isPermittedSourceUrl = (
  url: string,
  type: ResolvedPlayerSource['type'] | undefined
): boolean => {
  if (parserStrippedWhitespace.test(url)) return false;
  if (hasParserStrippedEdge(url)) return false;

  const scheme = schemeOf(url);
  if (scheme === undefined) return true;
  if (scheme === 'http' || scheme === 'https') return true;
  return scheme === 'blob' && type === 'video';
};

/**
 * Normalises a protocol-relative URL (`//host/...`) to the `https:` form it
 * resolves against, and returns every other value unchanged.
 *
 * A network-path reference resolves against `https:`, and that resolution is
 * what a resolved source carries -- the caller's `//host/...` form is never
 * written through, whether it arrived as a string or inside an explicit source
 * object (#219). Exported so a caller that runs `isPermittedSourceUrl` itself
 * can apply the same substitution to the value it writes.
 */
export const resolveNetworkPath = (url: string): string =>
  url.startsWith('//') ? `https:${url}` : url;

const failure = (
  input: unknown,
  reason: SourceDetectionFailureReason
): SourceDetectionFailure => ({
  status: 'failure',
  input,
  reason,
  guidance: explicitObjectGuidance
});

const sourceFromFileExtension = (
  input: string
): VideoFileSource | HlsSource | undefined => {
  const path = input.split(/[?#]/, 1)[0] ?? '';
  if (/\.mp4$/i.test(path)) {
    return { type: 'video', sources: [{ src: input, mimeType: 'video/mp4' }] };
  }
  if (/\.webm$/i.test(path)) {
    return { type: 'video', sources: [{ src: input, mimeType: 'video/webm' }] };
  }
  if (/\.m3u8$/i.test(path)) return { type: 'hls', src: input };
  return undefined;
};

// The no-cookie host is here in both spellings, as every other host in this
// list with a `www.` form is. It joins the full hosts rather than the short
// ones, which is what gives it the `/embed/` path and the other full-host
// shapes (#379). Detection carries no host and needs none: a `YouTubeSource`
// is an id, and the provider already requests the no-cookie origin whenever no
// `host` option is given (`packages/provider-youtube/src/index.ts`'s
// `DEFAULT_HOST`).
const isYouTubeHost = (hostname: string): boolean =>
  hostname === 'youtube.com' ||
  hostname === 'www.youtube.com' ||
  hostname === 'm.youtube.com' ||
  hostname === 'music.youtube.com' ||
  hostname === 'youtube-nocookie.com' ||
  hostname === 'www.youtube-nocookie.com' ||
  hostname === 'youtu.be' ||
  hostname === 'www.youtu.be';

const isVimeoHost = (hostname: string): boolean =>
  hostname === 'vimeo.com' ||
  hostname === 'www.vimeo.com' ||
  hostname === 'player.vimeo.com';

// The account subdomain is per-customer and cannot be enumerated, so this
// matches the registrable suffix instead of a fixed host list.
const isWistiaHost = (hostname: string): boolean =>
  hostname === 'wistia.com' ||
  hostname === 'wistia.net' ||
  hostname.endsWith('.wistia.com') ||
  hostname.endsWith('.wistia.net');

// `live` sits in this list rather than in a pattern of its own: it is the
// canonical URL for a live broadcast and reads `/<path>/<id>` exactly as the
// other two do, so it is one more spelling of a shape already here (#379).
const embeddedVideoPaths = ['embed', 'live', 'shorts'] as const;

// The `/watch` path is the full-host keyword that carries its id in the query
// rather than the path, which is why it is named here and matched on its own
// below rather than joining the alternation.
const watchPath = 'watch';

// `/playlist?list=<id>` is a real full-host path, and the only recognised one
// this detector reads no video out of: a playlist is not a video id, so a full
// host already refuses it and naming it here changes nothing there. It is named
// for the short hosts' sake. Without it `https://youtu.be/playlist?list=<id>`
// detects as the video id `playlist` -- the same silent failure `watch` had,
// and the reason the keyword set is membership of the full hosts' paths rather
// than of the subset that happens to have a reading shape (#395).
const playlistPath = 'playlist';

// Every path keyword the full hosts recognise, spelled once each. The pieces
// above are each read where they are matched -- `embeddedVideoPaths` by the
// `embeddedVideoPattern` alternation, `watchPath` by the `/watch` comparison --
// and this list joins them, `playlistPath` included, for its single reader: the
// short-host rejection below, which refuses all five. A path added to the full
// hosts is therefore excluded from the short hosts by the same edit that adds
// it. Two hand-kept lists would let a new path be read as an id on `youtu.be`,
// which is exactly the bug this closes (#395).
const fullHostPaths: readonly string[] = [
  watchPath,
  playlistPath,
  ...embeddedVideoPaths
];

// Built from the list above so the alternation cannot drift from it. What it
// produces today is written out here so the pattern can be read at a glance,
// but the construction is the authority and this line is illustrative:
//
//   /^\/(?:embed|live|shorts)\/([A-Za-z0-9_-]+)$/
//
// One segment after the keyword and nothing more; the full-host bound is the
// `isShortUrl` ternary below, which never reads this match on a short host. The
// interpolated values are `as const` string literals with no regex
// metacharacter among them, so the construction cannot change the pattern's
// meaning, and no flag is set, so there is no `lastIndex` carried between calls.
const embeddedVideoPattern = new RegExp(
  `^/(?:${embeddedVideoPaths.join('|')})/([A-Za-z0-9_-]+)$`
);

const sourceFromYouTubeUrl = (url: URL): YouTubeSource | undefined => {
  if (!isYouTubeHost(url.hostname)) return undefined;

  const isShortUrl =
    url.hostname === 'youtu.be' || url.hostname === 'www.youtu.be';
  const watchVideoIds = url.searchParams.getAll('v');
  const shortUrlMatch = /^\/([A-Za-z0-9_-]+)$/.exec(url.pathname);
  const embeddedVideoMatch = embeddedVideoPattern.exec(url.pathname);
  // A short-host path is one segment and that segment is the id, so a full-host
  // path keyword arriving there is a URL that combined the two forms rather
  // than an id at all. `https://youtu.be/watch?v=<id>` used to detect, with the
  // video id `watch`: the segment is a valid id *shape*, so the `v` parameter
  // carrying the real id was never consulted and the consumer got a player that
  // failed at YouTube with no Playdeck error at all -- worse than a refusal,
  // which at least names the value it turned down (#395). Refused rather than
  // interpreted: reading `v=` here would teach a URL form YouTube does not
  // serve and commit this library to supporting it.
  //
  // Case-insensitive, unlike the `/watch` comparison below, because the two
  // fail differently rather than because the rule differs: `/Watch` on a full
  // host refuses loudly already, while on a short host it *succeeds*, with an
  // id no video answers to, which is the silent failure this rejection exists
  // to remove. It stays an exact comparison of the whole segment, so it cannot
  // reach an id: the segment matched `[A-Za-z0-9_-]+`, which is ASCII, so
  // lowercasing preserves its length, and no segment of a length other than a
  // keyword's four to eight characters can equal one however it is cased.
  // `watchAgain1`, `rewatching1` and `watch-later` are ordinary ids and read.
  const shortUrlSegment = shortUrlMatch?.[1];
  const shortUrlVideoId =
    shortUrlSegment !== undefined &&
    fullHostPaths.includes(shortUrlSegment.toLowerCase())
      ? undefined
      : shortUrlSegment;
  const videoId = isShortUrl
    ? shortUrlVideoId
    : url.pathname === `/${watchPath}`
      ? watchVideoIds.length === 1
        ? watchVideoIds[0]
        : undefined
      : embeddedVideoMatch?.[1];

  return isYouTubeVideoId(videoId) ? { type: 'youtube', videoId } : undefined;
};

const sourceFromVimeoUrl = (url: URL): VimeoSource | undefined => {
  if (!isVimeoHost(url.hostname)) return undefined;

  const isPlayerUrl = url.hostname === 'player.vimeo.com';
  const playerMatch = /^\/video\/(\d+)(?:\/([A-Za-z0-9]+))?$/.exec(
    url.pathname
  );
  // The canonical host reads the same optional trailing hash segment the
  // player path above does, because `https://vimeo.com/<id>/<hash>` is the
  // share link Vimeo hands out for an unlisted video (#379). Both patterns feed
  // one `pathMatch`, so the hash reaches the returned source: a form that
  // detected it and dropped it would build a player that cannot load the video
  // and report nothing. The hash is an optional *group*, not an optional slash:
  // `/<id>/` and `/<id>//<hash>` stay unmatched, as does a third segment.
  const canonicalMatch = /^\/(\d+)(?:\/([A-Za-z0-9]+))?$/.exec(url.pathname);
  const pathMatch = isPlayerUrl ? playerMatch : canonicalMatch;
  const videoId = pathMatch?.[1];
  const pathHash = pathMatch?.[2];
  const queryHashes = url.searchParams.getAll('h');
  const queryHash = queryHashes.length === 1 ? queryHashes[0] : undefined;

  if (!isVimeoVideoId(videoId)) return undefined;
  if (
    queryHashes.length > 1 ||
    (queryHashes.length === 1 && !isVimeoHash(queryHash))
  ) {
    return undefined;
  }
  // No check on `pathHash`: the path pattern above already captures it as
  // `[A-Za-z0-9]+`, so validating it again is a branch nothing can reach --
  // confirmed by removing it and watching no test die (#101).

  const hash = queryHash ?? pathHash;
  return { type: 'vimeo', videoId, ...(hash ? { hash } : {}) };
};

const sourceFromWistiaUrl = (url: URL): WistiaSource | undefined => {
  if (!isWistiaHost(url.hostname)) return undefined;

  const embedIframeMatch = /^\/embed\/iframe\/([A-Za-z0-9]+)$/.exec(
    url.pathname
  );
  const embedMediaMatch = /^\/embed\/medias\/([A-Za-z0-9]+)$/.exec(
    url.pathname
  );
  const mediaPageMatch = /^\/medias\/([A-Za-z0-9]+)$/.exec(url.pathname);
  const mediaId =
    embedIframeMatch?.[1] ?? embedMediaMatch?.[1] ?? mediaPageMatch?.[1];

  return isWistiaMediaId(mediaId) ? { type: 'wistia', mediaId } : undefined;
};

const sourceFromExplicitObject = (
  input: Record<string, unknown>
): ResolvedPlayerSource | undefined => {
  if (input.type === 'video') {
    if (!Array.isArray(input.sources) || input.sources.length === 0)
      return undefined;
    if (
      !input.sources.every(
        (source) =>
          isRecord(source) &&
          isNonEmptyString(source.src) &&
          isNonEmptyString(source.mimeType) &&
          isPermittedSourceUrl(source.src, 'video')
      )
    ) {
      return undefined;
    }
    const validated = input as VideoFileSource;
    return {
      ...validated,
      sources: validated.sources.map((source) => ({
        ...source,
        src: resolveNetworkPath(source.src)
      }))
    };
  }

  if (input.type === 'hls') {
    if (!isNonEmptyString(input.src)) return undefined;
    if (!isPermittedSourceUrl(input.src, 'hls')) return undefined;
    if (
      input.engine !== undefined &&
      input.engine !== 'auto' &&
      input.engine !== 'native' &&
      input.engine !== 'hls.js'
    ) {
      return undefined;
    }
    const validated = input as HlsSource;
    return { ...validated, src: resolveNetworkPath(validated.src) };
  }

  if (input.type === 'youtube') {
    return isYouTubeVideoId(input.videoId)
      ? (input as YouTubeSource)
      : undefined;
  }

  if (input.type === 'vimeo') {
    if (!isVimeoVideoId(input.videoId)) return undefined;
    if (input.hash !== undefined && !isVimeoHash(input.hash)) return undefined;
    return input as VimeoSource;
  }

  if (input.type === 'wistia') {
    return isWistiaMediaId(input.mediaId) ? (input as WistiaSource) : undefined;
  }

  return undefined;
};

export const detectSource = (input: unknown): SourceDetectionResult => {
  if (typeof input === 'string') {
    if (
      !isNonEmptyString(input) ||
      input !== input.trim() ||
      parserStrippedWhitespace.test(input)
    ) {
      return failure(input, 'malformed-string');
    }

    if (/%(?![\da-f]{2})/i.test(input)) {
      return failure(input, 'malformed-string');
    }

    if (!isPermittedSourceUrl(input, undefined)) {
      return failure(input, 'unsupported-string');
    }

    const isNetworkPath = input.startsWith('//');
    if (isNetworkPath && !/^\/\/[^/]/.test(input)) {
      return failure(input, 'malformed-string');
    }

    const scheme = schemeOf(input);
    const normalizedInput = resolveNetworkPath(input);
    const urlInput = isNetworkPath || scheme ? normalizedInput : undefined;
    // Only `http:` and `https:` reach here with a scheme, because
    // `isPermittedSourceUrl` above refuses every other scheme for a bare
    // string -- `blob:` included, since no `type` is resolved yet. Both are
    // special schemes that must name an authority, so `https:/host/clip.mp4`
    // and `https:clip.mp4` are malformed rather than unsupported. This is not a
    // rule about permitted schemes generally: `blob:` is permitted for a
    // `video` source and has no authority, so admitting any further scheme to
    // the string case means revisiting this guard first.
    if (scheme && !input.slice(scheme.length + 1).startsWith('//')) {
      return failure(input, 'malformed-string');
    }

    let url: URL | undefined;
    if (urlInput) {
      try {
        url = new URL(urlInput);
      } catch {
        return failure(input, 'malformed-string');
      }
    }

    if (url) {
      if (isYouTubeHost(url.hostname)) {
        const source = sourceFromYouTubeUrl(url);
        return source
          ? { status: 'success', input, source }
          : failure(input, 'malformed-string');
      }
      if (isVimeoHost(url.hostname)) {
        const source = sourceFromVimeoUrl(url);
        return source
          ? { status: 'success', input, source }
          : failure(input, 'malformed-string');
      }
      if (isWistiaHost(url.hostname)) {
        const source = sourceFromWistiaUrl(url);
        if (source) return { status: 'success', input, source };
        // Unlike YouTube and Vimeo, Wistia serves media files on its own hosts
        // -- `.m3u8` manifests under `/embed/medias/` and `.mp4` under
        // `/deliveries/` are its documented way to play without its player. So
        // a Wistia URL that is not an embed shape falls through to the file
        // extension before the recognised-host rule fails it outright.
        const fileSource = sourceFromFileExtension(normalizedInput);
        if (fileSource) return { status: 'success', input, source: fileSource };
        return failure(input, 'malformed-string');
      }
    }

    const fileSource = sourceFromFileExtension(normalizedInput);
    if (fileSource) return { status: 'success', input, source: fileSource };

    return failure(input, 'unsupported-string');
  }

  if (isRecord(input)) {
    const source = sourceFromExplicitObject(input);
    // `source` may be a normalised copy, so `input` reports the caller's own
    // object rather than the copy -- a result's `input` is what was passed.
    if (source) {
      return {
        status: 'success',
        input: input as ResolvedPlayerSource,
        source
      };
    }
  }

  return failure(input, 'invalid-source');
};
