import { isPermittedSourceUrl, resolveNetworkPath } from '@reely/core';
import {
  isValidElement,
  useEffect,
  useRef,
  useState,
  type ComponentPropsWithRef,
  type CSSProperties,
  type ImgHTMLAttributes,
  type ReactElement
} from 'react';
import { usePosterState } from './player-context.js';

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
      data-reely-part="poster"
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

// A rejected `src` is treated exactly as an absent one -- no request, no
// `loading` state -- rather than as an error (#236). `type: undefined` because
// a bare poster string, unlike an explicit source object, never carries a
// `type: 'video'`, so `blob:` is refused here too.
const permittedPosterSrc = (src: string | undefined): string | undefined =>
  src !== undefined && isPermittedSourceUrl(src, undefined)
    ? resolveNetworkPath(src)
    : undefined;

// `srcSet` is a comma-separated list of `url [descriptor]` candidates. This
// splits on the comma rather than running a full HTML srcset parser, so a
// candidate URL containing a literal comma splits wrongly and is dropped.
// That is fail-closed and acceptable (#236). Each surviving candidate keeps
// its descriptor and position; only its URL is resolved, exactly as at
// `permittedPosterSrc`. An empty result is `undefined`, not `''` -- an empty
// string is truthy-adjacent enough to be a trap.
const permittedPosterSrcSet = (
  srcSet: string | undefined
): string | undefined => {
  if (srcSet === undefined) return undefined;
  const survivors = srcSet
    .split(',')
    .map((candidate) => candidate.trim())
    .filter((candidate) => candidate.length > 0)
    .flatMap((candidate) => {
      const descriptorStart = candidate.search(/\s/);
      const url =
        descriptorStart === -1
          ? candidate
          : candidate.slice(0, descriptorStart);
      const descriptor =
        descriptorStart === -1 ? '' : candidate.slice(descriptorStart);
      return isPermittedSourceUrl(url, undefined)
        ? [`${resolveNetworkPath(url)}${descriptor}`]
        : [];
    });
  return survivors.length > 0 ? survivors.join(', ') : undefined;
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
  // (#236).
  const src = permittedPosterSrc(srcProp);
  const srcSet = permittedPosterSrcSet(srcSetProp);
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
      data-reely-part="poster-image"
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
          'var(--reely-poster-fit, cover)') as CSSProperties['objectFit'],
        objectPosition:
          objectPosition ??
          style?.objectPosition ??
          'var(--reely-poster-position, center)'
      }}
      width={width}
    />
  );
  /* eslint-enable react-hooks/refs */
};
