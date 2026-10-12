// The one prop-level transform both shims in this directory apply before
// handing off to the real React 18 implementation underneath --
// `jsx-runtime-18.ts` (for `jsx`/`jsxs`/`jsxDEV`) and `react-shim-18.ts` (for
// `createElement`). Factored out because `../react/src`'s JSX does not
// reliably compile to `jsx`/`jsxs` calls: TypeScript's "automatic" JSX
// transform falls back to `React.createElement` whenever an element has a
// spread attribute that is NOT the very last thing before an explicit `key`
// (`viewport-media.tsx`'s native `<video>` is exactly this shape --
// `{...passthrough}` precedes `key={sourceKey(source)}`), because the
// transform cannot then guarantee the spread does not itself carry a `key`
// that should lose to the explicit one. Confirmed empirically: the built
// bundle imports `createElement` from `react` directly, and that import is
// reached for `<video>` and nothing else in this package. A shim aliasing
// only `react/jsx-runtime` would silently miss this one element -- the one
// element carrying the merged ref callback (`mediaRef`) that most needs the
// wrapping below.
import { forwardRef, type ForwardRefExoticComponent } from 'react';

type RefCallback = (node: unknown) => (() => void) | void;

// React 19 lets a callback ref return a cleanup function, called on detach
// instead of a second invocation with `null`. React 18 has no such contract:
// it always calls the callback again with `null`, ignores whatever that
// second call returns, and (in development) warns "Unexpected return value
// from a callback ref". `../react/src`'s five internal merged-ref callbacks
// (`assignRef` call sites in viewport-media.tsx, captions.tsx, controls.tsx,
// gestures.tsx, settings-menu.tsx) are written in the React 19 shape, so every
// host element they're attached to needs this wrapper to behave the same way
// under 18: capture the cleanup a React-19-shaped callback returns on attach,
// and run it on detach instead of calling the callback a second time.
//
// Keyed by the original callback (not by host node) because React requires a
// *stable* ref-callback identity across re-renders to avoid a detach/attach
// cycle on every commit -- the library's own callbacks are already
// `useCallback`-memoised for exactly that reason (confirmed by inspection: all
// five are memoised with the ref itself, or the handler that reads it, in
// their dependency array). A WeakMap means the wrapper returned for the same
// memoised callback is the same wrapper every time, so React sees the same
// function across renders and never tears the node down to reattach it.
const hostRefWrapperCache = new WeakMap<RefCallback, RefCallback>();

const wrapHostRef = (original: RefCallback): RefCallback => {
  const cached = hostRefWrapperCache.get(original);
  if (cached) return cached;

  // Per-wrapper state, not per-call: one wrapper is reused across this
  // callback's whole attach/detach/attach lifecycle, exactly matching how
  // React calls a single callback-ref identity over a node's lifetime.
  let cleanup: (() => void) | void;
  let attached = false;

  const wrapped: RefCallback = (node) => {
    if (node === null) {
      if (typeof cleanup === 'function') {
        cleanup();
      } else if (attached) {
        original(null);
      }
      cleanup = undefined;
      attached = false;
      return undefined;
    }
    attached = true;
    cleanup = original(node);
    // Always returns undefined: React 18 never expects a cleanup back from a
    // callback ref, so handing one over here would only draw the "Unexpected
    // return value" warning this wrapper exists to avoid.
    return undefined;
  };

  hostRefWrapperCache.set(original, wrapped);
  return wrapped;
};

// React 18 never hands a plain function component a `ref` prop -- the
// component simply never receives it, silently, with no warning. Every
// exported primitive in `../react/src` that takes a ref is written as a plain
// function reading `ref` off its own props (React 19's shape), so a function
// component invoked here with a `ref` in its props needs to run inside a
// `forwardRef` wrapper for that ref to reach it under 18 at all.
//
// `forwardRef`, `memo` and `lazy` types are plain *objects* (a `$$typeof`
// tag), never functions, and a class component's `prototype.isReactComponent`
// marker distinguishes it from a function one -- both already excluded by the
// checks below, so this only ever matches an ordinary function component.
const isPlainFunctionComponent = (
  type: unknown
): type is (props: Record<string, unknown>) => unknown =>
  typeof type === 'function' &&
  !(type as { prototype?: { isReactComponent?: unknown } }).prototype
    ?.isReactComponent;

// Keyed by the original component function so the same component, rendered
// many times (or re-rendered with new props), always gets back the same
// `forwardRef` wrapper -- the component's own `.type` identity staying stable
// across renders is what lets React reuse its fiber rather than remount it
// in place.
const componentWrapperCache = new WeakMap<
  (props: Record<string, unknown>) => unknown,
  ForwardRefExoticComponent<unknown>
>();

const getRefForwardingWrapper = (
  type: (props: Record<string, unknown>) => unknown
): ForwardRefExoticComponent<unknown> => {
  const cached = componentWrapperCache.get(type);
  if (cached) return cached;
  // `type` is called directly as a plain function from inside the
  // `forwardRef` render callback, not re-entered through `jsx()`/
  // `createElement` -- so every hook it calls attaches to the one fiber
  // React created for this `forwardRef` component, exactly as if `type` had
  // been written with `forwardRef` from the start.
  const wrapper = forwardRef((props: Record<string, unknown>, ref: unknown) =>
    type({ ...props, ref })
  ) as ForwardRefExoticComponent<unknown>;
  (wrapper as { displayName?: string }).displayName =
    (type as { displayName?: string }).displayName || type.name || undefined;
  componentWrapperCache.set(type, wrapper);
  return wrapper;
};

type AnyProps = Record<string, unknown> & { ref?: unknown };

// `fetchPriority` (React 19's camelCase prop, matching the other `<img>`
// handlers this package spells camelCase) sets the attribute `fetchpriority`
// on the element; React 19 knows the mapping and writes the lowercase
// attribute itself. React 18.3.1 does not know this prop at all and -- verified
// empirically against a real 18.3.1 install -- warns on the camelCase spelling
// and never writes the attribute. Renaming the prop key to its already-lowercase
// DOM spelling before it reaches `jsx`/`jsxs`/`createElement` sidesteps both:
// React 18 writes any unrecognised string-valued prop whose name matches an
// HTML attribute straight through as that attribute.
const rewriteFetchPriority = (type: unknown, props: AnyProps): AnyProps => {
  if (type !== 'img' || !('fetchPriority' in props)) return props;
  const { fetchPriority, ...rest } = props;
  return { ...rest, fetchpriority: fetchPriority };
};

// `<link rel="preconnect">` (`root.tsx`) is deliberately left alone: React 19
// hoists a `<link>` with a recognised metadata `rel` out of its render
// position and into `<head>`, de-duplicating repeats; React 18 has no such
// hoisting and renders it exactly where it sits in the tree. That is a real,
// unavoidable behaviour difference between the two packages -- recorded here
// rather than patched, since there is no DOM API this shim can call to hoist
// an element into `<head>` on React 18's behalf without reimplementing a slice
// of React 19's metadata feature.
export const transform = (
  type: unknown,
  props: unknown
): [unknown, unknown] => {
  if (props === null || typeof props !== 'object') return [type, props];
  let nextProps = props as AnyProps;

  if (typeof type === 'string') {
    if (typeof nextProps.ref === 'function') {
      nextProps = {
        ...nextProps,
        ref: wrapHostRef(nextProps.ref as RefCallback)
      };
    }
    nextProps = rewriteFetchPriority(type, nextProps);
    return [type, nextProps];
  }

  if (isPlainFunctionComponent(type) && 'ref' in nextProps) {
    return [getRefForwardingWrapper(type), nextProps];
  }

  return [type, nextProps];
};
