// The seek-preview sprite cue: a flavour of WebVTT that Vidstack, Media Chrome
// and Video.js all read the same way. Each cue's payload is an image URL, and
// that URL may carry a `#xywh=` media-fragment naming a rectangular region of
// a sprite sheet. `region` is published in sprite pixels — x, y, width,
// height — rather than as a CSS background-position, because the consumer
// (`SeekSlider`, in `@playdeck/react`) crops the sprite with a real `<img>`
// offset inside an `overflow: hidden` box: `background-image` is banned
// repo-wide, so nothing here may assume a CSS background is available to
// position.
export type ThumbnailRegion = {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
};

export type ThumbnailCue = {
  readonly startTime: number;
  readonly endTime: number;
  // The payload URL with any `#xywh=` fragment removed. A non-xywh fragment,
  // if the file happens to carry one, is left exactly as the cue wrote it —
  // this module only ever strips the one fragment it understands.
  readonly url: string;
  // `null` when the cue names no region at all, or names one this module
  // does not resolve to pixels (see `parseXywh` below).
  readonly region: ThumbnailRegion | null;
};

// Matches the WebVTT header line: `WEBVTT`, optionally followed by a
// space/tab and arbitrary trailing text (`WEBVTT - thumbnails`), which the
// spec permits and real files use to label the file. A leading BOM is
// stripped before this test runs, since the spec allows one and every other
// reader here does too.
const HEADER_LINE = /^WEBVTT([ \t].*)?$/;

// `HH:MM:SS.mmm` (hours are one or more digits, so a very long file is not
// truncated) and the short `MM:SS.mmm` form the spec allows when the media is
// under an hour. Both require exactly three millisecond digits, as the spec
// does.
const TIMESTAMP = /^(?:(\d+):)?(\d{2}):(\d{2}\.\d{3})$/;

// The timing line: two timestamps joined by `-->`, with anything after the
// second timestamp (cue settings like `line:0 align:start`) ignored — this
// module has no use for cue settings, only for where the sprite crop starts
// and ends.
const TIMING_LINE = /^(\S+)\s+-->\s+(\S+)(?:\s.*)?$/;

// The one fragment syntax this module resolves to a region: `#xywh=x,y,w,h`
// and the explicit `#xywh=pixel:x,y,w,h` spelling, both defined by the Media
// Fragments URI spec and both meaning "these four numbers are sprite
// pixels" — which is the only unit `ThumbnailRegion` can express, since
// nothing here knows the sprite image's natural size to turn a percentage
// into pixels. `#xywh=percent:...` therefore matches here too, so its numbers
// are recognised and its `#xywh=` fragment is still stripped from the
// published URL, but `parseXywh` reports no region for it rather than
// silently mis-scaling a percentage as if it were a pixel count.
//
// No sign on any of the four numbers: a sprite region has no meaningful
// negative offset or extent, so `#xywh=-5,-5,-160,-90` falls through to
// "not recognised" below, exactly like any other malformed fragment.
const XYWH_FRAGMENT =
  /^xywh=(?:(pixel|percent):)?(\d+(?:\.\d+)?),(\d+(?:\.\d+)?),(\d+(?:\.\d+)?),(\d+(?:\.\d+)?)$/i;

const parseTimestamp = (raw: string): number => {
  const match = TIMESTAMP.exec(raw);
  if (match === null) return Number.NaN;
  const [, hours, minutes, seconds] = match;
  return (
    (hours === undefined ? 0 : Number(hours)) * 3600 +
    Number(minutes) * 60 +
    Number(seconds)
  );
};

// Splits a payload URL into its published `url` and `region`. The fragment
// checked is whatever follows the URL's first `#` — a WebVTT payload line is
// a single URL, so a second `#` inside it is not a fragment delimiter this
// module has any business interpreting, and is left as part of the base URL.
const parseXywh = (
  payload: string
): { readonly url: string; readonly region: ThumbnailRegion | null } => {
  const hashIndex = payload.indexOf('#');
  if (hashIndex === -1) return { url: payload, region: null };

  const base = payload.slice(0, hashIndex);
  const fragment = payload.slice(hashIndex + 1);
  const match = XYWH_FRAGMENT.exec(fragment);
  // A fragment that isn't a recognised `xywh=` region (a different
  // media-fragment dimension, or malformed) is left attached to the URL
  // rather than guessed at — only a fragment this module can actually
  // interpret is stripped.
  if (match === null) return { url: payload, region: null };

  const [, unit, x, y, width, height] = match;
  return {
    url: base,
    region:
      unit === 'percent'
        ? null
        : {
            x: Number(x),
            y: Number(y),
            width: Number(width),
            height: Number(height)
          }
  };
};

// Splits the cue body (everything after the header line) into blocks
// separated by one or more blank lines. A line of only whitespace counts as
// blank here, more lenient than the spec's zero-length definition — real
// files routinely trail a space, and there is nothing for this module to
// gain by treating that as a structural error rather than a blank line.
const toBlocks = (lines: readonly string[]): readonly (readonly string[])[] => {
  const blocks: string[][] = [];
  let current: string[] = [];
  for (const line of lines) {
    if (line.trim() === '') {
      if (current.length > 0) blocks.push(current);
      current = [];
    } else {
      current.push(line);
    }
  }
  if (current.length > 0) blocks.push(current);
  return blocks;
};

// Parses one non-comment, non-style, non-region block into a cue, or `null`
// when the block does not resolve to one this module can publish.
//
// A block may open with an identifier line before its timing line (the cue
// id WebVTT allows for scripting/styling); this module has no use for cue
// ids, so every line before the first one containing `-->` is skipped
// rather than assigned meaning. A block with no `-->` line at all is not a
// cue this module recognises, and — like an unparsed timestamp or a missing
// payload — is dropped silently rather than treated as a document-level
// error: per-block leniency, not the header's all-or-nothing check, is what
// decides whether a given cue survives.
const parseCueBlock = (block: readonly string[]): ThumbnailCue | null => {
  const timingIndex = block.findIndex((line) => line.includes('-->'));
  if (timingIndex === -1) return null;

  const timingMatch = TIMING_LINE.exec(block[timingIndex] ?? '');
  if (timingMatch === null) return null;
  const [, startRaw, endRaw] = timingMatch;
  const startTime = parseTimestamp(startRaw ?? '');
  const endTime = parseTimestamp(endRaw ?? '');
  if (!Number.isFinite(startTime) || !Number.isFinite(endTime)) return null;
  if (endTime <= startTime) return null;

  const payloadLine = block
    .slice(timingIndex + 1)
    .find((line) => line.trim() !== '');
  if (payloadLine === undefined) return null;

  const { url, region } = parseXywh(payloadLine.trim());
  return { startTime, endTime, url, region };
};

// A cap on the cues `parseThumbnailCues` will publish, so a hostile or
// merely malformed WebVTT file cannot make this module hand the caller an
// arbitrarily large array. Sized well above any real sprite VTT: a 3-hour
// film at one cue per second is about 10,800 cues, and this is roughly ten
// times that. A file whose cue count would exceed it is treated exactly like
// a file that fails to parse -- no thumbnails, no throw -- since a consumer
// cannot act on a file this malformed any more usefully than on one that
// isn't WebVTT at all.
//
// Deliberately not exported: `./thumbnails` is a published subpath
// (`package.json`'s `exports`), built as its own bundle, so anything
// exported from this file -- unlike a plain internal module reached only
// through a package's main entry -- ships in `dist/thumbnails.js` and
// becomes part of the public API. This cap is an implementation detail, not
// a promise to consumers.
const THUMBNAIL_CUE_CAP = 100_000;

// Turns a WebVTT sprite-cue file into the published, ordered collection.
//
// A body whose first line is not `WEBVTT` (once a leading BOM is stripped)
// publishes no cues rather than throwing. This is a parser, not a validator:
// the issue this module serves asks for a notice when a *URL* is refused by
// the allowlist, not when a file fails to look like WebVTT — a consumer that
// pointed `thumbnails` at the wrong file, or at a server's HTML error page,
// gets the same "no thumbnails" result a consumer who never set the prop
// gets, with nothing here escalating that into an exception the caller has
// to guard against. A file past `THUMBNAIL_CUE_CAP` gets the same treatment:
// parsing stops the moment the cap is passed, rather than finishing the walk
// only to discard the result, and the file publishes no cues at all rather
// than the cues found before the cap.
export const parseThumbnailCues = (vtt: string): readonly ThumbnailCue[] => {
  const withoutBom = vtt.charCodeAt(0) === 0xfeff ? vtt.slice(1) : vtt;
  const lines = withoutBom.split(/\r\n|\r|\n/);
  const headerLine = lines[0] ?? '';
  if (!HEADER_LINE.test(headerLine)) return Object.freeze([]);

  const blocks = toBlocks(lines.slice(1));
  const cues: ThumbnailCue[] = [];
  for (const block of blocks) {
    const first = block[0] ?? '';
    // `NOTE`, `STYLE` and `REGION` blocks carry no cue and are skipped.
    // `REGION` here is WebVTT's own block keyword (navigation regions for
    // captions) — an unrelated, coincidental reuse of the word this module
    // also uses for `ThumbnailRegion`.
    if (
      /^NOTE([ \t]|$)/.test(first) ||
      first === 'STYLE' ||
      first === 'REGION'
    ) {
      continue;
    }
    const cue = parseCueBlock(block);
    if (cue !== null) {
      cues.push(cue);
      if (cues.length > THUMBNAIL_CUE_CAP) return Object.freeze([]);
    }
  }

  return Object.freeze(
    cues
      .sort((left, right) => left.startTime - right.startTime)
      .map((cue) => Object.freeze(cue))
  );
};

// Per-array cache of the running maximum `endTime` up to and including each
// cue, in the cues' own `startTime`-sorted order -- what makes
// `thumbnailCueAt` below a genuine binary search despite `endTime` not
// itself being sorted (see that function's own comment for why the running
// maximum is enough). Built once per distinct `cues` array and reused by
// identity through a `WeakMap`: the caller (`useThumbnailCues`,
// `@playdeck/react`) holds one frozen array per fetched file and calls
// `thumbnailCueAt` against that same reference on every `pointermove`, so an
// unmoving thumbnails track pays the one-time `O(n)` build once rather than
// on every lookup.
const maxEndCache = new WeakMap<readonly ThumbnailCue[], readonly number[]>();

const maxEndUpTo = (cues: readonly ThumbnailCue[]): readonly number[] => {
  const cached = maxEndCache.get(cues);
  if (cached !== undefined) return cached;
  const maxEnd: number[] = [];
  let running = Number.NEGATIVE_INFINITY;
  for (const cue of cues) {
    running = Math.max(running, cue.endTime);
    maxEnd.push(running);
  }
  maxEndCache.set(cues, maxEnd);
  return maxEnd;
};

// A binary search over `cues` (sorted ascending by `startTime`) returning
// exactly what the linear `cues.find((cue) => time >= cue.startTime && time
// < cue.endTime)` this replaces would return -- the first, lowest-index cue
// whose half-open span contains `time`, including when cues share a
// `startTime` or overlap outright.
//
// `endTime` is not itself sorted, so a plain binary search on `endTime`
// cannot be correct in general -- but `maxEndUpTo`'s running maximum is
// sorted (non-decreasing, by construction), and the smallest index where it
// first exceeds `time` is provably the answer: every earlier index has a
// running maximum at or below `time`, and a running maximum bounds every
// value that fed it, so every cue up to and including that index also has
// `endTime` at or below `time` -- none of them is the cue `find` was
// looking for. The running maximum only crosses `time` at the index it does
// because that cue's own `endTime` is what pushes it over, since everything
// before was already accounted for and insufficient. That index is then
// discarded (`null`) if its own `startTime` is still after `time`:
// `startTime` genuinely is sorted ascending, so once one cue starts after
// `time`, every cue from there on does too, and no cue anywhere in the array
// can contain it.
export const thumbnailCueAt = (
  cues: readonly ThumbnailCue[],
  time: number
): ThumbnailCue | null => {
  const maxEnd = maxEndUpTo(cues);
  let low = 0;
  let high = cues.length;
  while (low < high) {
    const mid = (low + high) >>> 1;
    if (maxEnd[mid] > time) high = mid;
    else low = mid + 1;
  }
  const cue = cues[low];
  return cue !== undefined && cue.startTime <= time ? cue : null;
};
