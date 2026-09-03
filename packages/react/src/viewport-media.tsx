import { type detectSource } from '@playdeck/core';
import {
  useCallback,
  useEffect,
  useRef,
  type ComponentPropsWithRef,
  type CSSProperties,
  type Ref
} from 'react';
import { permittedUrl } from './permitted-url.js';
import { useRefusedUrlReport, usePlayer } from './player-context.js';

export type ViewportProps = ComponentPropsWithRef<'div'>;

// Standard <video> passthrough, minus the attributes the controller owns:
// `src` (driven by the resolved source / <source> children), `muted` and
// `autoPlay` (activation + autoplay policy live in the controller), `preload`
// (derived from the loading strategy), `poster` (use `nativePoster`),
// `controls` (use `Root`'s own `controls` prop, threaded through
// `PlayerContextValue` -- see the `usePlayer()` destructure below), and
// `children` (Media renders its own <source> set). Passing those would
// silently desync or bypass the player's state machine, so they're excluded.
// #224: the list is a runtime value the type reads, not a type-level literal,
// because `Omit` only stops a caller who is type-checked -- a cast, a spread or
// untyped CMS data walks past it and lands on the element. `Media` strips these
// keys off the remainder before spreading, so both halves move together.
const EXCLUDED_MEDIA_PROPS = [
  'children',
  'src',
  'muted',
  'autoPlay',
  'preload',
  'poster',
  'controls'
] as const;

export type MediaProps = Omit<
  ComponentPropsWithRef<'video'>,
  (typeof EXCLUDED_MEDIA_PROPS)[number]
> & {
  readonly nativePoster?: string;
  readonly textTracks?: ReadonlyArray<{
    readonly src: string;
    readonly srcLang: string;
    readonly label: string;
    readonly kind?: 'captions' | 'subtitles';
    readonly default?: boolean;
  }>;
};

// #89: geometry a primitive sets for itself is a default the consumer's
// `style` prop overrides, so it is spread *before* `...style` everywhere. The
// only exception is a state-derived property — computed from player state
// rather than chosen as layout, and so it stays after `...style`.
const viewportStyle: CSSProperties = {
  position: 'relative',
  overflow: 'hidden'
};

// The library's one output property, read by the consumer as
// `aspect-ratio: var(--playdeck-media-aspect-ratio, 16 / 9)`. That fallback is
// why an unknown size removes the property rather than writing a zero or a
// guess: only an absent property lets the consumer's own value apply, and
// `0 / 0` is not something CSS can use. Every provider that measures nothing
// usable therefore publishes `undefined` rather than a number pair.
const MEDIA_ASPECT_RATIO_PROPERTY = '--playdeck-media-aspect-ratio';

// How long playback runs with no pointer or keyboard input before the themes'
// auto-hide rule takes the controls away. A constant local to this file rather
// than a `Viewport` prop: the value is CSS-driven, and a consumer who wants no
// auto-hide overrides the `[data-idle='true']` rule instead of configuring a
// number through a component that takes no configuration otherwise. The
// reasoning is set out at length under "No prop" in
// `docs/superpowers/specs/2026-09-02-player-themes-design.md`.
const IDLE_DELAY_MS = 2500;

// Reset on any of these, all bound to the viewport node rather than to
// `document`, so a page carrying more than one player never has one player's
// pointer traffic keep a different one awake.
const IDLE_RESET_EVENTS = [
  'pointermove',
  'pointerdown',
  'touchstart',
  'keydown',
  'focusin'
] as const;

export const assignRef = <Value,>(
  ref: Ref<Value> | undefined,
  value: Value | null
): (() => void) | undefined => {
  if (typeof ref === 'function') {
    const cleanup = ref(value);
    return typeof cleanup === 'function' ? cleanup : undefined;
  } else if (ref) {
    ref.current = value;
  }
};

export const Viewport = ({ children, ref, style, ...rest }: ViewportProps) => {
  const { controller, registerViewport } = usePlayer();
  const viewportNode = useRef<HTMLDivElement | null>(null);
  const mergedRef = useCallback(
    (node: HTMLDivElement | null) => {
      viewportNode.current = node;
      registerViewport(node);
      if (!node) return;
      return () => {
        viewportNode.current = null;
        registerViewport(null);
      };
    },
    [registerViewport]
  );
  useEffect(() => {
    const node = viewportNode.current;
    if (!node) return;
    const consumerCleanup = assignRef(ref, node);
    return () => {
      if (consumerCleanup) {
        consumerCleanup();
      } else {
        assignRef(ref, null);
      }
    };
  }, [ref]);
  // #174: written straight to the node, never through state. Only CSS reads
  // this, and a `PlayerState` field would wake every state consumer on every
  // source change and every dimension change. Deliberately `useEffect` rather
  // than the `useSyncExternalStore` that `usePlayerState` and `useActiveCues`
  // use — subscribing through that hook is what re-renders.
  useEffect(() => {
    const node = viewportNode.current;
    if (!node) return;
    return controller.subscribeDimensions((dimensions) => {
      if (dimensions) {
        node.style.setProperty(
          MEDIA_ASPECT_RATIO_PROPERTY,
          `${dimensions.width} / ${dimensions.height}`
        );
      } else {
        node.style.removeProperty(MEDIA_ASPECT_RATIO_PROPERTY);
      }
    });
  }, [controller]);
  // The idle timer behind the themes' auto-hide rule, written straight to the
  // node for the same reason the aspect ratio above is: only CSS reads it, and
  // a `PlayerState` field would wake every state consumer on every tick.
  // `controller.subscribe` rather than `usePlayerState` for that same reason —
  // subscribing through the hook is what re-renders, while this effect reacts
  // only to a playback transition, gated below, and never to the
  // many-times-a-second ticks the same subscription otherwise carries. It also
  // never inspects focus or whether a menu is open: `:focus-within` in the
  // theme stylesheets keeps the bar visible independently of what `data-idle`
  // says, so the two concerns stay in separate layers.
  useEffect(() => {
    const node = viewportNode.current;
    if (!node) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let playing = false;
    const setIdle = (value: boolean) => {
      node.setAttribute('data-idle', value ? 'true' : 'false');
    };
    const clearTimer = () => {
      if (timer !== undefined) {
        clearTimeout(timer);
        timer = undefined;
      }
    };
    const arm = () => {
      clearTimer();
      timer = setTimeout(() => setIdle(true), IDLE_DELAY_MS);
    };
    // Only re-arms while playing, so input during a pause leaves the timer
    // disarmed rather than starting one that would idle a paused player.
    const reset = () => {
      setIdle(false);
      if (playing) arm();
    };
    for (const type of IDLE_RESET_EVENTS) node.addEventListener(type, reset);
    setIdle(false);
    const unsubscribe = controller.subscribe((state) => {
      const nowPlaying = state.playback === 'playing';
      if (nowPlaying === playing) return;
      playing = nowPlaying;
      if (playing) {
        arm();
      } else {
        clearTimer();
        setIdle(false);
      }
    });
    return () => {
      clearTimer();
      for (const type of IDLE_RESET_EVENTS)
        node.removeEventListener(type, reset);
      unsubscribe();
    };
  }, [controller]);
  return (
    <div
      {...rest}
      data-playdeck-part="viewport"
      ref={mergedRef}
      style={{ ...viewportStyle, ...style }}
    >
      {children}
    </div>
  );
};

export const sourceKey = (source: ReturnType<typeof detectSource>): string =>
  source.status === 'success'
    ? JSON.stringify(source.source)
    : 'unsupported-source';

// #150: the native <video> and the three embed mounts are one layer wearing
// four shapes, so all four state one geometry — filling the viewport they
// are laid into.
const mediaStyle: CSSProperties = {
  position: 'relative',
  zIndex: 0,
  width: '100%',
  height: '100%'
};

// The three mounts are <div>s and need nothing more, but the native <video> is
// inline-level, so without `display: block` it sits on a text baseline and
// hangs a descender gap below the frame. And the frame is content, so a box
// that does not match its aspect ratio must letterbox rather than crop away
// part of the picture or distort it; a consumer who wants cropping passes
// `objectFit: 'cover'` through `style`. `PosterImage` is decorative and so
// defaults the other way, to `cover`.
const nativeMediaStyle: CSSProperties = {
  ...mediaStyle,
  display: 'block',
  objectFit: 'contain'
};

export const Media = ({
  nativePoster,
  ref,
  style,
  textTracks,
  'aria-label': ariaLabel,
  ...rest
}: MediaProps) => {
  const {
    controller,
    controls,
    preload,
    registerMedia,
    source,
    sourceCommitted
  } = usePlayer();
  // Both filters run here, above every early return, because the report below
  // is a hook and a hook cannot sit after one. That also settles a question
  // worth stating: a refused `nativePoster` or text track is reported for an
  // embed source too, where neither prop would have been rendered at all. The
  // detection is about the consumer's value, not about which branch consumed
  // it -- the CMS field is poisoned whichever provider the source resolves to
  // (#330).
  const nativePosterSrc = permittedUrl(nativePoster);
  const nativePosterRefused =
    nativePoster !== undefined && nativePosterSrc === undefined;
  // Filtered before the map, not inside it: a rejected entry's `key` (derived
  // from its own un-resolved `src`) never needs computing, and the
  // survivors' keys stay stable across renders that only add or remove a
  // rejected entry (#236). Goes through `permittedUrl` (`permitted-url.ts`),
  // this package's one check-then-resolve helper against the shared
  // allowlist, rather than calling `isPermittedSourceUrl` and
  // `resolveNetworkPath` separately here -- the exact duplication
  // `permitted-url.ts` was extracted to end. It also guards a `src` that is
  // `undefined` at runtime rather than throwing: the declared `string` type
  // only binds a caller that is type-checked, and the #224 comment above
  // records the same gap for untyped CMS data walking past a declared type.
  const permittedTextTracks = textTracks?.flatMap((track) => {
    const resolvedSrc = permittedUrl(track.src);
    return resolvedSrc !== undefined ? [{ ...track, resolvedSrc }] : [];
  });
  // `permittedTextTracks` is `undefined` exactly when `textTracks` is, and is a
  // subset of it otherwise, so a shorter list is the only way a track can have
  // been refused. Read through the optional chain rather than defaulted to a
  // length of zero: with no `textTracks` at all there is nothing to have
  // refused, so the guard already covers that case and a fallback would only
  // state one that cannot arise.
  const textTrackRefused =
    textTracks !== undefined &&
    permittedTextTracks?.length !== textTracks.length;
  // One registration per surface, each standing only while THIS `Media` refuses
  // that surface -- see `useRefusedUrlReport` (`player-context.ts`) (#330).
  useRefusedUrlReport(controller, 'nativePoster', nativePosterRefused);
  useRefusedUrlReport(controller, 'textTracks src', textTrackRefused);
  // Merge the consumer ref onto the internal registration inside one callback
  // ref (rather than Viewport's stable-callback + separate `[ref]` effect):
  // Media is committed-source-gated and mounts its <video> late, so a `[ref]`
  // effect would run before the element exists and never forward the ref when
  // it finally mounts. Consumer refs on Media are expected to be stable; the
  // trade-off is that a volatile (inline) ref re-runs this callback each
  // render — behavior-preserving, verified to not reload the provider. Only
  // the native <video> branch attaches this; the iframe mounts aren't a video
  // element. Declared before the committed-source gate returns to keep hook
  // order stable.
  const mediaRef = useCallback(
    (node: HTMLVideoElement | null) => {
      registerMedia(node);
      const consumerCleanup = assignRef(ref, node);
      if (!node) return;
      return () => {
        registerMedia(null);
        if (consumerCleanup) consumerCleanup();
        else assignRef(ref, null);
      };
    },
    [registerMedia, ref]
  );
  if (!sourceCommitted || source.status === 'failure') {
    return null;
  }

  if (source.source.type === 'youtube') {
    // A plain mount for the YouTube iframe. The provider chrome inside the
    // iframe is the single control layer; Playdeck renders nothing over it.
    return (
      <div
        data-playdeck-part="media"
        key={sourceKey(source)}
        ref={registerMedia}
        style={{ ...mediaStyle, ...style }}
      />
    );
  }

  if (source.source.type === 'vimeo') {
    // A mount for the Vimeo iframe embed. When chromeless controls are
    // plan-gated, Vimeo's own controls stay the single layer; Playdeck renders
    // nothing over the embed.
    return (
      <div
        data-playdeck-part="media"
        key={sourceKey(source)}
        ref={registerMedia}
        style={{ ...mediaStyle, ...style }}
      />
    );
  }

  if (source.source.type === 'wistia') {
    // A mount for the `<wistia-player>` custom element the provider appends
    // into it. Unlike YouTube and Vimeo, the embed is chromeless by default —
    // the provider switches every Wistia control off by name — so Playdeck's own
    // controls are the layer, which is what `customControls: available` says.
    return (
      <div
        data-playdeck-part="media"
        key={sourceKey(source)}
        ref={registerMedia}
        style={{ ...mediaStyle, ...style }}
      />
    );
  }

  if (source.source.type !== 'video' && source.source.type !== 'hls') {
    return null;
  }

  const passthrough = { ...rest };
  for (const excluded of EXCLUDED_MEDIA_PROPS) {
    delete (passthrough as Record<string, unknown>)[excluded];
    // The same key in the DOM's own spelling. React reports an unknown
    // property such as `autoplay` with a warning and still writes the
    // attribute, so untyped data spelling the attribute rather than the React
    // prop would otherwise reach the element. Derived from the list above so
    // the two spellings cannot drift apart.
    delete (passthrough as Record<string, unknown>)[excluded.toLowerCase()];
  }

  return (
    <video
      playsInline
      {...passthrough}
      aria-label={ariaLabel ?? 'Playdeck media'}
      // `Root`'s own `controls` prop, read as a DOM attribute rather than
      // through the provider-options bag YouTube and Vimeo use: a native
      // `<video>` already has its own chrome toggle, so the value needs no
      // re-attach to change it, only this attribute.
      controls={controls === true}
      data-playdeck-part="media"
      key={sourceKey(source)}
      // A rejected `nativePoster` omits the attribute entirely -- the same
      // shared allowlist that gates a source URL, applied to this
      // consumer-supplied prop through `permittedUrl` (`permitted-url.ts`)
      // rather than forked into a second scheme test (#236).
      poster={nativePosterSrc}
      preload={preload}
      ref={mediaRef}
      style={{ ...nativeMediaStyle, ...style }}
    >
      {source.source.type === 'video'
        ? source.source.sources.map(({ mimeType, src }, index) => (
            <source
              key={`${src}:${mimeType}:${index}`}
              src={src}
              type={mimeType}
            />
          ))
        : // The HLS provider owns the media source: the native engine assigns
          // the manifest URL and hls.js attaches Media Source Extensions.
          null}
      {permittedTextTracks?.map(
        ({ src, srcLang, label, kind, default: isDefault, resolvedSrc }) => (
          <track
            key={`${src}:${srcLang}`}
            default={isDefault}
            kind={kind ?? 'captions'}
            label={label}
            src={resolvedSrc}
            srcLang={srcLang}
          />
        )
      )}
    </video>
  );
};
