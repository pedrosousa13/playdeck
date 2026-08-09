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

const isYouTubeVideoId = (value: unknown): value is string =>
  isNonEmptyString(value) && /^[A-Za-z0-9_-]+$/.test(value);

const isVimeoVideoId = (value: unknown): value is string =>
  isNonEmptyString(value) && /^\d+$/.test(value);

const isVimeoHash = (value: unknown): value is string =>
  isNonEmptyString(value) && /^[A-Za-z0-9]+$/.test(value);

const isWistiaMediaId = (value: unknown): value is string =>
  isNonEmptyString(value) && /^[A-Za-z0-9]+$/.test(value);

// The WHATWG URL parser strips U+0009, U+000A and U+000D before parsing, so a
// scheme split by one of them is not the scheme read here: `java<TAB>script:`
// yields no scheme at all, and the parser then resolves `javascript:`. A
// well-formed URL carries none of the three, so any occurrence is rejected
// outright rather than stripped, which keeps the value that plays identical to
// the value that was validated (#219).
const parserStrippedWhitespace = /[\t\n\r]/;

const schemeOf = (url: string): string | undefined =>
  url.match(/^([a-z][a-z\d+.-]*):/i)?.[1]?.toLowerCase();

/**
 * Whether the library will carry a source URL to a provider. The one such
 * decision in the library, and it turns on two things: the URL must be
 * well-formed, and its scheme must be allowed for the source it belongs to.
 *
 * A URL carrying a raw tab, line feed or carriage return is refused as
 * malformed, whatever its apparent scheme, because the URL parser strips those
 * three before parsing and would read a different scheme than the one checked
 * here -- `java<TAB>script:` names no scheme at all yet loads as `javascript:`.
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

  const scheme = schemeOf(url);
  if (scheme === undefined) return true;
  if (scheme === 'http' || scheme === 'https') return true;
  return scheme === 'blob' && type === 'video';
};

// A network-path reference resolves against `https:`, and that resolution is
// what a resolved source carries -- the caller's `//host/...` form is never
// written through, whether it arrived as a string or inside an explicit source
// object (#219).
const resolveNetworkPath = (url: string): string =>
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

const isYouTubeHost = (hostname: string): boolean =>
  hostname === 'youtube.com' ||
  hostname === 'www.youtube.com' ||
  hostname === 'm.youtube.com' ||
  hostname === 'music.youtube.com' ||
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

const sourceFromYouTubeUrl = (url: URL): YouTubeSource | undefined => {
  if (!isYouTubeHost(url.hostname)) return undefined;

  const isShortUrl =
    url.hostname === 'youtu.be' || url.hostname === 'www.youtu.be';
  const watchVideoIds = url.searchParams.getAll('v');
  const shortUrlMatch = /^\/([A-Za-z0-9_-]+)$/.exec(url.pathname);
  const embeddedVideoMatch = /^\/(?:embed|shorts)\/([A-Za-z0-9_-]+)$/.exec(
    url.pathname
  );
  const videoId = isShortUrl
    ? shortUrlMatch?.[1]
    : url.pathname === '/watch'
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
  const canonicalMatch = /^\/(\d+)$/.exec(url.pathname);
  const videoId = isPlayerUrl ? playerMatch?.[1] : canonicalMatch?.[1];
  const pathHash = isPlayerUrl ? playerMatch?.[2] : undefined;
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
