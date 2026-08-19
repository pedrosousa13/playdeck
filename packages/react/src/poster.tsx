import {
  isValidElement,
  useContext,
  useEffect,
  useRef,
  useState,
  type ComponentPropsWithRef,
  type CSSProperties,
  type ImgHTMLAttributes,
  type ReactElement
} from 'react';
import { permittedUrl } from './permitted-url.js';
import { PlayerContext, usePosterState } from './player-context.js';

export type PosterProps = ComponentPropsWithRef<'div'>;

export type ResponsivePoster = {
  readonly src: string;
  readonly srcSet?: string;
  readonly sizes?: string;
  readonly width?: number | string;
  readonly height?: number | string;
  readonly loading?: ImgHTMLAttributes<HTMLImageElement>['loading'];
  readonly fetchPriority?: ImgHTMLAttributes<HTMLImageElement>['fetchPriority'];
  readonly decoding?: ImgHTMLAttributes<HTMLImageElement>['decoding'];
  readonly objectFit?: CSSProperties['objectFit'];
  readonly objectPosition?: CSSProperties['objectPosition'];
};

export type PosterInput = string | ResponsivePoster | ReactElement;

export type NormalizedPoster =
  | { readonly type: 'image'; readonly props: ResponsivePoster }
  | { readonly type: 'custom'; readonly element: ReactElement };

export type PosterImageProps = Omit<
  ImgHTMLAttributes<HTMLImageElement>,
  keyof ResponsivePoster
> &
  Partial<ResponsivePoster>;

export const normalizePoster = (input: PosterInput): NormalizedPoster => {
  if (typeof input === 'string') {
    return { type: 'image', props: { src: input } };
  }
  if (isValidElement(input)) {
    return { type: 'custom', element: input };
  }
  return { type: 'image', props: { ...input } };
};

const posterOverlayStyle: CSSProperties = {
  position: 'absolute',
  inset: 0,
  width: '100%',
  height: '100%',
  zIndex: 10,
  pointerEvents: 'none',
  transform: 'none'
};

export const Poster = ({ children, style, ...safeRest }: PosterProps) => {
  const posterState = usePosterState();

  return (
    <div
      {...safeRest}
      aria-hidden="true"
      data-playdeck-part="poster"
      data-state={posterState}
      style={{
        ...posterOverlayStyle,
        ...style,
        // After `...style`, alone: derived from `posterState`, so a static
        // consumer value would pin the poster open for every source rather
        // than override a layout choice.
        visibility: posterState === 'hidden' ? 'hidden' : 'visible'
      }}
    >
      {children}
    </div>
  );
};

type PosterImageState = 'idle' | 'loading' | 'loaded' | 'error';

const posterRequestKey = ({ src, srcSet, sizes }: PosterImageProps): string =>
  `${src ?? ''}\u0000${srcSet ?? ''}\u0000${sizes ?? ''}`;

const initialPosterImageState = (
  src?: string,
  srcSet?: string
): PosterImageState => (src || srcSet ? 'loading' : 'idle');

// `srcSet` is a comma-separated list of `url [descriptor]` candidates. This
// splits on the comma rather than running a full HTML srcset parser, so a
// candidate URL containing a literal comma splits into two halves that are
// then validated independently -- `"/a,b.jpg 1x"` splits into `/a` and
// `b.jpg 1x`, both scheme-less, both permitted, and both are written into the
// output as two wrong candidates. No scheme escalation is possible this way:
// a dangerous scheme surviving the split still fails its own check on
// whichever half carries it. This is list grammar, not URL policy -- the
// candidate is corrupted by the split, not dropped by it (#236).
//
// Each trimmed candidate -- its URL and any trailing descriptor together --
// is passed to `permittedUrl` (`permitted-url.ts`), this package's one
// check-then-resolve helper against the shared allowlist, as one string
// rather than split apart first. `resolveNetworkPath` only ever rewrites a
// leading `//`, so it leaves a trailing descriptor untouched, and a
// descriptor's own leading space is not a scheme delimiter, so it cannot
// forge one. Splitting the candidate first to isolate "the URL" would
// instead search for the first whitespace character to find that split
// point -- and a raw tab is whitespace, so `java<TAB>script:alert(1) 1x`
// would truncate to the harmless-looking `java` before ever reaching the
// scheme check, silently defeating it (#219, #236). Validating the whole
// candidate closes that gap: the embedded tab is still there for
// `isPermittedSourceUrl`'s own check to catch.
//
// Each surviving candidate's own text is still exactly what was validated --
// that property matters and holds here same as everywhere else the shared
// allowlist gates a write. What is not byte-identical is the list itself:
// survivors are rejoined with `', '` below, so the emitted `srcSet` is a
// reconstructed string whose separators may differ from the consumer's own
// (unlike, say, the Wistia poster check, which writes its one value
// untouched).
//
// An empty result is `undefined`, not `''` -- an empty string is
// truthy-adjacent enough to be a trap.
//
// `refused` rides along rather than being recomputed by a second pass over the
// list: the split is this function's own grammar (see above), and a caller
// re-deriving "was anything dropped" would have to repeat it and could then
// disagree with it. It is one flag for the whole list, not one per candidate --
// the notice slot holds one notice, and an operator with a poisoned `srcSet`
// has the same one field to go and clean either way (#330).
const permittedPosterSrcSet = (
  srcSet: string | undefined
): { readonly value: string | undefined; readonly refused: boolean } => {
  if (srcSet === undefined) return { value: undefined, refused: false };
  const candidates = srcSet
    .split(',')
    .map((candidate) => candidate.trim())
    .filter((candidate) => candidate.length > 0);
  const survivors = candidates.flatMap((candidate) => {
    const resolved = permittedUrl(candidate);
    return resolved !== undefined ? [resolved] : [];
  });
  return {
    value: survivors.length > 0 ? survivors.join(', ') : undefined,
    refused: survivors.length < candidates.length
  };
};

const posterImageStyle: CSSProperties = {
  display: 'block',
  width: '100%',
  height: '100%'
};

export const PosterImage = ({
  src: srcProp,
  srcSet: srcSetProp,
  sizes,
  width,
  height,
  loading,
  fetchPriority,
  decoding,
  objectFit,
  objectPosition,
  onLoad,
  onError,
  style,
  ...safeRest
}: PosterImageProps) => {
  // Filtered before `posterRequestKey` and `initialPosterImageState`, which
  // derive request identity and the initial state from `src`/`srcSet`
  // truthiness -- a rejected pair filtered after them would land in
  // `loading` and never resolve. Filtering first makes "a poster given only
  // rejected values settles in idle" fall out of the existing state machine
  // (#236). `permittedUrl` passes `undefined` for `isPermittedSourceUrl`'s
  // `type` internally, which is what refuses `blob:` here too -- a bare
  // poster string never carries a `type: 'video'`.
  const src = permittedUrl(srcProp);
  const { refused: srcSetRefused, value: srcSet } =
    permittedPosterSrcSet(srcSetProp);
  const srcRefused = srcProp !== undefined && src === undefined;
  // Read straight off the context rather than through `usePlayer()`, which
  // throws outside `Player.Root`. `PosterImage` is usable on its own -- it
  // needs no player state to render an <img> -- and #330 is a detection fix,
  // so it must not turn a standalone poster into a thrown error. Outside a
  // root there is no controller to report to and the refusal stands silently,
  // exactly as it did before this change.
  const controller = useContext(PlayerContext)?.controller;
  // In an effect, not in render: `reportRefusedUrl` writes controller state and
  // wakes its subscribers, which a render pass may not do. The controller holds
  // only the first report, so re-running this is inert (#330).
  useEffect(() => {
    if (!controller) return;
    if (srcRefused) controller.reportRefusedUrl('poster src');
    if (srcSetRefused) controller.reportRefusedUrl('poster srcSet');
  }, [controller, srcRefused, srcSetRefused]);
  const requestKey = posterRequestKey({ src, srcSet, sizes });
  const state = useRef<{
    key: string;
    state: PosterImageState;
  }>({
    key: requestKey,
    state: initialPosterImageState(src, srcSet)
  });
  const [, rerender] = useState(0);
  /* eslint-disable react-hooks/refs -- The request signature must reset visible state during this render. */
  if (state.current.key !== requestKey) {
    state.current = {
      key: requestKey,
      state: initialPosterImageState(src, srcSet)
    };
  }
  const posterImageState = state.current.state;
  /* eslint-enable react-hooks/refs */

  const updateState = (nextState: PosterImageState) => {
    if (state.current.key !== requestKey) return;
    state.current = { key: requestKey, state: nextState };
    rerender((value) => value + 1);
  };

  // Cached images can finish loading before React attaches onLoad/onError, so
  // those events never fire and `data-state` would stay 'loading' forever.
  // On mount and whenever the request changes, resolve an already-complete
  // image from its `complete`/`naturalWidth` (broken images are complete with
  // zero natural width).
  const imageRef = useRef<HTMLImageElement>(null);
  useEffect(() => {
    if (state.current.state !== 'loading') return;
    const image = imageRef.current;
    if (!image || !image.complete) return;
    updateState(image.naturalWidth > 0 ? 'loaded' : 'error');
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on requestKey; updateState reads the current ref snapshot.
  }, [requestKey]);

  /* eslint-disable react-hooks/refs -- posterImageState is the synchronous keyed-state snapshot above. */
  return (
    <img
      {...safeRest}
      alt=""
      data-playdeck-part="poster-image"
      ref={imageRef}
      data-state={posterImageState}
      decoding={decoding}
      fetchPriority={fetchPriority}
      height={height}
      loading={loading}
      onError={(event) => {
        updateState('error');
        onError?.(event);
      }}
      onLoad={(event) => {
        updateState('loaded');
        onLoad?.(event);
      }}
      sizes={sizes}
      src={src}
      srcSet={srcSet}
      style={{
        ...posterImageStyle,
        ...style,
        // Three rungs, stated rather than implied by spread order: the
        // explicit prop is more specific than the generic `style` bag and
        // wins it, and `style` in turn beats the theming-variable default.
        objectFit: (objectFit ??
          style?.objectFit ??
          'var(--playdeck-poster-fit, cover)') as CSSProperties['objectFit'],
        objectPosition:
          objectPosition ??
          style?.objectPosition ??
          'var(--playdeck-poster-position, center)'
      }}
      width={width}
    />
  );
  /* eslint-enable react-hooks/refs */
};
