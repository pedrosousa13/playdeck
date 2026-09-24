import { useEffect, useRef, useState } from 'react';
import type { PlayerController } from '@playdeck/core';
import {
  parseThumbnailCues,
  thumbnailCueAt,
  type ThumbnailCue,
  type ThumbnailRegion
} from '@playdeck/core/thumbnails';

// This module is `SeekSlider`'s thumbnail preview, whole: the cue fetch, the
// cue lookup, the crop geometry and the `thumbnail` part's own JSX. It is
// also the only module in this package that `transport-controls.tsx` reaches
// through a dynamic `import()` rather than a static one, and the two facts
// are the same fact -- a consumer who never sets `thumbnails` never
// downloads any of it (#727).
//
// What that costs the module, and is the one rule to keep when adding to it:
// **it imports no module of this package that the eager graph also imports.**
// A bundler assigns a module to a chunk by which entry points can reach it,
// so a module this chunk and `index.tsx` both import belongs to neither and
// is hoisted into a third chunk that every consumer loads eagerly, whether or
// not they set the prop.
//
// The rule is about this package's own modules, deliberately. React is
// imported here and by `index.tsx` both, and that is fine in the `.` build,
// where `react` is `external` (`vite.config.ts`) and a consumer's own bundler
// decides where it lands. It is not free in the `./browser` build, which
// bundles React: there Rollup does factor it into a chunk this module and the
// entry share, which is why that entry now loads four scripts rather than
// three (`vite.browser.config.ts`'s `REACT_MODULE`, and the `react.js` row in
// `scripts/bundle-budgets.mjs`). That trade was taken knowingly -- one more
// request at the same waterfall depth for fewer eager bytes overall -- and it
// is the reason to keep the rule to first-party modules rather than state it
// absolutely. A type-only import costs nothing either way, being erased. Measured on the "Playdeck (control bar)" comparison row while
// #727 was being built: importing `permittedUrl` and `useRefusedUrlReport`
// from their own modules hoisted `player-context.ts` out of the entry chunk
// and put the row 0.10 KB ABOVE where it started, with the feature removed.
//
// That is also why the parser comes from `@playdeck/core/thumbnails` rather
// than `@playdeck/core`: the same rule, across a package boundary. The eager
// graph imports `@playdeck/core` for plenty of other things, so a parser
// sharing a module with `detectSource` is emitted wherever `detectSource` is.
//
// The two things this module would otherwise import arrive another way: the
// allowlist as a prop (`permittedUrl`, still `permitted-url.ts`'s own single
// implementation -- only the reference travels), and the refusal
// registration written out below against `controller` directly.

// The fetch's own deadline, in the same shape and order of magnitude as the
// other two fetches this library makes on its own initiative --
// `OEMBED_REQUEST_TIMEOUT_MS` (`packages/provider-vimeo/src/oembed-availability.ts`)
// and `POSTER_PROBE_TIMEOUT_MS` (`packages/provider-wistia/src/poster-availability.ts`).
// A WebVTT host that is malicious or merely compromised must not be able to
// hold this fetch open indefinitely.
export const THUMBNAILS_FETCH_TIMEOUT_MS = 4000;

// A cap on the bytes this module will read out of the fetched body.
// `Content-Length` is not trustworthy on its own -- a response can omit it,
// or understate it -- so the body is read through a counting stream reader
// (`readCappedBody`, below) rather than `response.text()`, and abandoned the
// moment the running count passes this. Sized well above any real sprite
// VTT: `@playdeck/core/thumbnails`'s own cue cap is roughly ten times the
// ~10,800 cues a 3-hour film produces at one cue per second, and a real
// cue's own timing-plus-payload lines run to well under 100 bytes, so this
// leaves comparable headroom measured in bytes.
export const THUMBNAILS_FETCH_BYTE_CAP = 10_000_000;

// Reads a fetched thumbnails body through a counting stream reader rather
// than `response.text()`, so a response whose `Content-Length` is absent,
// understated or simply not trusted still cannot make this module hold an
// arbitrarily large string. Reading stops -- and the stream is cancelled --
// the moment the running byte count passes `THUMBNAILS_FETCH_BYTE_CAP`, and
// this resolves to `undefined`: the same result a refused (`!response.ok`)
// response already produces below, so a body over the cap yields no
// thumbnails rather than a parse of a truncated file.
const readCappedBody = async (
  response: Response
): Promise<string | undefined> => {
  const body = response.body;
  if (body === null) return undefined;
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let text = '';
  let bytesRead = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    bytesRead += value.byteLength;
    if (bytesRead > THUMBNAILS_FETCH_BYTE_CAP) {
      await reader.cancel();
      return undefined;
    }
    text += decoder.decode(value, { stream: true });
  }
  // Flushes whatever trailing bytes `{ stream: true }` held back waiting for
  // a continuation that never came -- a response cut off mid multi-byte
  // sequence, whether by a truncating host or an ordinary network fault.
  // Without this, those bytes are silently dropped rather than resolving to
  // the U+FFFD replacement character a final decode produces for them.
  text += decoder.decode();
  return text;
};

const EMPTY_CUES: readonly ThumbnailCue[] = Object.freeze([]);

type CuesState = {
  readonly url: string | undefined;
  readonly cues: readonly ThumbnailCue[];
  // Whether a fetch for `url` has already started (or finished), so a later
  // render that is still armed does not start a second one.
  readonly armed: boolean;
};

const initialState: CuesState = Object.freeze({
  url: undefined,
  cues: EMPTY_CUES,
  armed: false
});

// Loads and parses the WebVTT file `SeekSlider`'s `thumbnails` prop names,
// lazily: nothing is fetched until `armed` is true, which `ThumbnailPreview`
// below passes once a pointer has been over the slider or its input has held
// keyboard focus -- never at mount, so a consumer who sets the prop but
// whose viewer never hovers or tabs to the control never costs a network
// request. `armed` going false again (the pointer left, the input blurred)
// does not undo that: the fetch is kept, and its cues with it, so moving the
// pointer on and off the slider is one request rather than one per pass.
//
// One fetch per resolved `url`: a changed `url` invalidates whatever was in
// flight or already parsed for the old one -- its cues are dropped and the
// next interaction re-arms and re-fetches for the new one. The in-flight
// request is aborted on unmount too, on the same path a `url` change already
// takes.
//
// A response that fails to fetch, or parses to no cues, settles on the same
// empty result an unset `thumbnails` prop produces. This module is not the
// allowlist: `SeekSlider` resolves `url` through `permittedUrl` before it
// ever reaches here (and a refused one never mounts this component at all),
// so a fetch failure or an empty parse here is a malformed or unreachable
// file, not a refused one, and stays silent the same way
// `parseThumbnailCues` itself does (see its own header comment).
export const useThumbnailCues = (
  url: string | undefined,
  armed: boolean
): readonly ThumbnailCue[] => {
  // Holds the resolved cues alongside the `url` they belong to, and whether a
  // fetch for that `url` has already started -- a plain ref, not state,
  // because it is reset synchronously below rather than through an effect
  // (see the comment there for why), and read into a render-time local
  // (`cues`) for everything downstream to use like ordinary state.
  const stateRef = useRef<CuesState>(initialState);
  const abortRef = useRef<AbortController | null>(null);
  // Its setter's only job is forcing a re-render once the fetch resolves and
  // mutates `stateRef` from outside render -- the same pairing `PosterImage`
  // uses for its own ref-backed state (`poster.tsx`).
  const [, rerender] = useState(0);

  /* eslint-disable react-hooks/refs -- A changed `url` must reset the exposed
     cues during THIS render, not after one commits: `useSeekPreview`'s own
     preview release (`transport-controls.tsx`) and `PosterImage`'s request-key
     reset are the precedent for adjusting a ref this way instead of through an
     effect, which is what a synchronous `setState` in an effect body would be
     doing here regardless (`react-hooks/set-state-in-effect`). A render
     React discards costs nothing: the next attempt recomputes the same reset
     from the same committed props. */
  if (stateRef.current.url !== url) {
    abortRef.current?.abort();
    abortRef.current = null;
    stateRef.current = { url, cues: EMPTY_CUES, armed: false };
  }
  const cues = stateRef.current.cues;
  /* eslint-enable react-hooks/refs */

  // Abort whatever is in flight when this instance unmounts. The
  // `url`-changed case above already aborts synchronously during render, so
  // this covers only the case that reset cannot -- the component going away
  // entirely.
  useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  useEffect(() => {
    if (!armed || url === undefined || stateRef.current.armed) return;
    stateRef.current = { ...stateRef.current, armed: true };
    const controller = new AbortController();
    abortRef.current = controller;
    // Set only by the deadline's own callback below, never by an unmount's
    // or a url change's abort -- what lets `.catch()` tell the three apart:
    // those two must stay silent, and this one must not.
    let deadlineExpired = false;
    // The deadline: aborts the same signal a url change or unmount already
    // aborts, so a host that never answers cannot hold this open forever.
    const timer = setTimeout(() => {
      deadlineExpired = true;
      controller.abort();
    }, THUMBNAILS_FETCH_TIMEOUT_MS);
    // Publishes `cues` for `url`, unless a later `url` change has already
    // moved this instance on to a different fetch this result must not
    // overwrite. Shared by the two branches below that both resolve to a
    // published result: a valid (or empty) parse, and -- now -- a deadline
    // that expired before either arrived.
    const publishCues = (cues: readonly ThumbnailCue[]): void => {
      if (stateRef.current.url !== url) return;
      stateRef.current = { url, cues, armed: true };
      rerender((value) => value + 1);
    };
    fetch(url, {
      signal: controller.signal,
      // Unlike the Vimeo oEmbed fetch (`provider-vimeo/src/oembed-availability.ts`),
      // no domain-restriction check anywhere reads this request's referrer, and
      // a consumer's own sprite host has no reason to learn what page embedded
      // it -- so this drops the referrer entirely rather than narrowing it to
      // the origin the way that fetch does.
      referrerPolicy: 'no-referrer'
    })
      .then((response) => (response.ok ? readCappedBody(response) : undefined))
      .then((text) => {
        // Stale if aborted before a response arrived to read at all -- a
        // narrow race between the fetch settling and this callback running.
        if (controller.signal.aborted) return;
        publishCues(text === undefined ? EMPTY_CUES : parseThumbnailCues(text));
      })
      .catch(() => {
        // A network failure is silent, same as a fetch that resolves but
        // fails: no thumbnails, no notice. An abort from unmount or a url
        // change stays silent the same way -- the instance is gone, or has
        // already moved on to a different fetch neither should touch. Only
        // the deadline is treated like the unparseable-file result above:
        // reported the way that path already reports, via the same
        // `publishCues`.
        if (deadlineExpired) publishCues(EMPTY_CUES);
      })
      .finally(() => {
        // Runs on every path above, including ordinary success -- not only
        // the three aborts -- so the timer never outlives the fetch it
        // guards.
        clearTimeout(timer);
      });
  }, [armed, url]);

  /* eslint-disable react-hooks/refs -- `cues` is the synchronous snapshot
     taken above, read out of the ref in the same pass that may have just
     reset it; what is returned is the value, not the ref. Same allowance the
     reset above takes, and the same one this hook's previous shape took for
     the pair it used to return. */
  return cues;
  /* eslint-enable react-hooks/refs */
};

// The `thumbnail` part's CSS `left`, as a percentage of `SeekSlider`'s own
// wrapper -- the same box `previewedTime`'s pointer fraction is already
// measured against -- clamped so the part, centred on `left` by the caller's
// `translateX(-50%)`, never sits partly outside that box near either end of
// the track (`Player.Viewport` sets `overflow: hidden` in
// viewport-media.tsx, which would otherwise clip it). Constraining `left` to
// `[halfWidth, 100% - halfWidth]` keeps the whole box inside: CSS `clamp()`
// resolves identically for the pointer path and the keyboard-focus path,
// needs no `getBoundingClientRect` call, and can't go stale on resize the
// way a JS-measured clamp could.
//
// Only possible when `regionWidth` is known, i.e. the cue names a region --
// that is the only source of the box's pixel width (the part also uses it,
// unclamped, for its own `width` style). A region-less cue's box sizes to
// its natural image width, unknown until the image loads, so it is left
// unclamped. If the slider is narrower than the thumbnail, `clamp()`'s min
// exceeds its max and, per spec, resolves to the min -- the preview
// overflows to the right rather than centring, an accepted degenerate case
// rather than something worth code of its own.
//
// A pure function, not inlined into the JSX: `packages/react/test`'s DOM
// environment (happy-dom) rejects `clamp()`/`min()` as invalid CSS outright
// -- `el.style.left = 'clamp(...)'` is silently dropped, leaving whatever
// the element held before -- so a rendered `style.left` can never be
// asserted on for this value. Exporting the computation lets it be tested as
// a plain string instead.
export const thumbnailLeftStyle = (
  previewedTime: number | null,
  min: number,
  span: number,
  regionWidth: number | undefined
): string => {
  if (previewedTime === null) return '0%';
  const pct = ((previewedTime - min) / span) * 100;
  if (regionWidth === undefined) return `${pct}%`;
  const halfWidth = regionWidth / 2;
  return `clamp(${halfWidth}px, ${pct}%, calc(100% - ${halfWidth}px))`;
};

export type ThumbnailPreviewProps = {
  readonly controller: PlayerController;
  // The slider's own geometry, already computed by `SeekSlider` for the
  // track it renders: the seek window's start and extent, the input's
  // current value, and whether there is a window at all.
  readonly hasWindow: boolean;
  readonly min: number;
  readonly span: number;
  readonly value: number;
  // The interaction, as `SeekSlider` records it: the pointer's x within the
  // slider's wrapper as a fraction of its width (`null` while no pointer is
  // over it), and whether the input holds focus. Raw inputs rather than a
  // resolved preview, so that everything this feature decides -- which of
  // the two axes wins, what that resolves to in seconds, whether it is
  // previewable at all -- is decided here, in the chunk a consumer only
  // downloads when they asked for the feature.
  readonly pointerFraction: number | null;
  readonly inputFocused: boolean;
  // The allowlisted `thumbnails` URL. Already resolved by `SeekSlider`,
  // which withholds a refused one by not rendering this component.
  readonly url: string;
  // `permitted-url.ts`'s `permittedUrl`, handed down rather than imported --
  // see this module's header for why it imports nothing the eager graph
  // does. A cue's own image URL goes through the same allowlist every other
  // consumer-supplied URL in this package does.
  readonly permittedUrl: (url: string | undefined) => string | undefined;
};

// The `thumbnail` part, and everything behind it.
//
// Mounted whenever `thumbnails` resolves to a permitted URL, whether or not
// a preview is showing right now -- like `Poster`, so a theme can transition
// between `data-state`s instead of the part popping in and out of the DOM on
// every hover start and stop. Decorative geometry, exactly like
// `seek-buffered`: `aria-hidden`, and never a live region, because a hovered
// preview would otherwise announce on every pointer move.
export const ThumbnailPreview = ({
  controller,
  hasWindow,
  inputFocused,
  min,
  permittedUrl,
  pointerFraction,
  span,
  url,
  value
}: ThumbnailPreviewProps) => {
  const cues = useThumbnailCues(url, pointerFraction !== null || inputFocused);

  // The time the part previews: the pointer's position while it is over the
  // wrapper, else the input's own current `value` while it holds focus, else
  // no preview at all. `null` whenever there is no seek window to place a
  // preview in. A pointer active at the same time as focus wins.
  const previewedTime = !hasWindow
    ? null
    : pointerFraction !== null
      ? min + pointerFraction * span
      : inputFocused
        ? value
        : null;
  const activeCue =
    previewedTime === null ? null : thumbnailCueAt(cues, previewedTime);
  // The active cue's image, through the same allowlist as `thumbnails`
  // itself. A refusal here reports the `'thumbnails cue image'` surface and
  // drops only this cue -- the next preview resolves its own cue independently.
  const cueImageUrl =
    activeCue === null ? undefined : permittedUrl(activeCue.url);
  const cueImageRefused = activeCue !== null && cueImageUrl === undefined;
  // The standing refusal, registered exactly the way `useRefusedUrlReport`
  // (`player-context.ts`) registers every other one: per instance, from an
  // effect rather than from render because `reportRefusedUrl` writes
  // controller state, and disposed when the refusal stops holding or this
  // component unmounts. Written out rather than imported for this module's
  // own header reason -- importing that module here would hoist the player
  // contexts into a chunk the eager graph loads either way.
  useEffect(() => {
    if (!cueImageRefused) return;
    return controller.reportRefusedUrl('thumbnails cue image');
  }, [controller, cueImageRefused]);
  // What the part actually has to show, or `null` for every reason it might
  // not: no active preview, no cue at that time, or that cue's own image
  // refused. `region: null` (from `ThumbnailCue`'s own contract) means "the
  // whole image", not "nothing to show" -- that distinction is `image`
  // itself being `null`.
  const image: {
    readonly region: ThumbnailRegion | null;
    readonly url: string;
  } | null =
    activeCue === null || cueImageUrl === undefined
      ? null
      : { region: activeCue.region, url: cueImageUrl };

  return (
    <div
      aria-hidden="true"
      data-playdeck-part="thumbnail"
      data-state={image === null ? 'hidden' : 'visible'}
      style={{
        position: 'absolute',
        bottom: '100%',
        left: thumbnailLeftStyle(
          previewedTime,
          min,
          span,
          image?.region?.width
        ),
        transform: 'translateX(-50%)',
        overflow: 'hidden',
        visibility: image === null ? 'hidden' : 'visible',
        width: image?.region?.width,
        height: image?.region?.height
      }}
    >
      {image === null ? null : (
        <img
          alt=""
          // Same reasoning as the fetch this cue's url came through, above in
          // this file: the sprite host has no reason to learn the page, and no
          // domain-restriction check needs the origin the way Vimeo's does.
          referrerPolicy="no-referrer"
          src={image.url}
          style={
            image.region
              ? {
                  position: 'absolute',
                  left: -image.region.x,
                  top: -image.region.y
                }
              : undefined
          }
        />
      )}
    </div>
  );
};
