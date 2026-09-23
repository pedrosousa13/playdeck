import type {
  PlayerSource,
  ProviderAdapter,
  RefusedUrlSurface,
  ResolvedPlayerSource
} from '@playdeck/core';
import { detectSource, isPermittedSourceUrl } from '@playdeck/core';
import type { SourceDetectionResult } from '@playdeck/core';
import type { HlsBuild } from '@playdeck/provider-hls';
import type { NativePlaybackOptions } from '@playdeck/provider-native';
import type { VimeoProviderOptions } from '@playdeck/provider-vimeo';
import type { WistiaProviderOptions } from '@playdeck/provider-wistia';
import type { YouTubeProviderOptions } from '@playdeck/provider-youtube';

export type PlayerMediaMount = HTMLVideoElement | HTMLDivElement;

// Every bag below is guarded to this: fields whose value is a string, a
// number, a boolean, or absent. `providerBagEqual` (`use-activation.ts`)
// compares a bag's own keys with `Object.is`, which is only meaningful for a
// value that is itself its own identity -- a function or another object
// compares unequal to a value equal to it in every way that matters, so a bag
// holding one would retire the provider's activation identity, and rebuild
// its engine, on every render that passes it inline (#579).
// `PrimitiveOptionBag` turns a bag that stops being able to promise that into
// a compile error at the bag's own declaration below, rather than a rebuilt
// engine and a lost playback position discovered by a consumer.
//
// `youtube` was the one bag that could not take it as written (#579):
// `loadIframeApi` is a function, and it already carried the exact hazard this
// guard exists to catch -- an inline `providerOptions={{ youtube: {
// loadIframeApi: () => ... } }}` retired the YouTube activation every render,
// undocumented. #628 closes that the way `hls` keeps `loadHls` out of its own
// bag: `loadIframeApi` is omitted below rather than admitted, and stays
// reachable only on `YouTubeProviderOptions` itself, the provider's own
// documented test seam (mounting `createYouTubeProvider` directly, the way
// `packages/provider-youtube/test/index.test.ts` does). There is no
// `build`-shaped primitive standing in for it here, unlike `hls`'s selector,
// because nothing in `youtube`'s own options names a choice for one to select
// between; a consumer-facing, data-shaped loading option remains open should
// that need turn up.
type PrimitiveOptionValue = string | number | boolean | undefined;

// Exported for `provider-loaders.test.ts` alone, to prove the constraint
// itself rejects a function-valued key at the type level -- not just that one
// particular bag happens not to declare one.
export type PrimitiveOptionBag<
  Bag extends Record<string, PrimitiveOptionValue>
> = Bag;

/**
 * Options a single provider accepts that no Playdeck prop covers, keyed by
 * provider. Wistia's embed carries presentation options -- a player colour, a
 * swatch, a poster -- that only that provider has. HLS carries one option of
 * its own, `build` (#579): which hls.js build `loadProvider` loads, `'full'`
 * (its default) or `'light'`. It is a name rather than the `loadHls` loader
 * function `HlsProviderOptions` (`@playdeck/provider-hls`) also accepts,
 * because a function cannot satisfy `PrimitiveOptionBag` above; reaching
 * `loadHls` itself -- to pin an hls.js version or serve it from somewhere
 * else -- still means mounting `createHlsProvider` directly, the way
 * `apps/storybook/stories/hls-build.stories.tsx` does. The native provider
 * still waits on its own issue, so its absence here remains deliberate.
 *
 * `youtube` joined the same guard in #628, for the same reason and by the same
 * means: its `loadIframeApi` is a function too, so it is omitted here and
 * reached only through `YouTubeProviderOptions` itself, exactly as `loadHls`
 * is. There is no `build`-shaped selector standing in for it -- `host` is the
 * bag's one remaining key -- because nothing in `youtube`'s own options names
 * a choice to select between.
 *
 * `controls`, `loop`, `startTime` and `endTime` are cross-provider concepts and
 * live on `Root` as its own props (ADR-0004). Each is omitted here from the bags
 * `Root`'s fan-out actually reaches, which makes the double home
 * unrepresentable rather than merely discouraged -- and they do not reach the
 * same set. `loop`, `startTime` and `endTime` are omitted from all three.
 * `controls` is omitted from `youtube` and `vimeo`
 * only: Wistia has the concept
 * (`provider-wistia/src/attachment.ts:240`, `if (options.controls !== true)`)
 * but no fold in `resolvedProviderOptions` writes it, so the bag key is still
 * the only way to reach it and stays. That asymmetry is ADR-0004's own
 * Consequences section, not an oversight here.
 *
 * `loop` was the exception until SIDEPRO-210. It reached the native and HLS
 * providers inside `NativePlaybackOptions` and no further, so the `wistia` bag
 * key was the only way to loop an embed. `Root` now folds `loop` into the
 * active provider's own bag (`root.tsx`'s `resolvedProviderOptions`) exactly as
 * it folds `controls`, and every provider answers it: Wistia by setting
 * `endVideoBehavior` (`provider-wistia/src/attachment.ts:243`,
 * `if (options.loop === true)`), Vimeo and YouTube by an embed parameter, and
 * native and HLS by the `<video>` element's own attribute. The bag keys remain
 * as the provider-level channel that fold writes to; what is gone is the
 * consumer-facing second spelling.
 *
 * `startTime` and `endTime` were the same exception until #214, and a wider
 * one: they reached the native and HLS providers inside `NativePlaybackOptions`
 * and no embed bag declared them at all, so neither prop nor bag key could bound
 * a YouTube, Vimeo or Wistia source. Each provider now declares both and
 * enforces the boundary itself, `Root` folds both into the active provider's bag
 * beside `loop`, and the keys are omitted here for the same one-home reason.
 *
 * `resolvePoster` joins the fold for the same reason (#556): `Root`'s `poster`
 * prop is what a consumer sets, `poster="provider"` is what asks Vimeo and
 * Wistia to resolve their own still, and `root.tsx`'s `resolvedProviderOptions`
 * writes that opt-in into whichever of the two bags is active. Omitted from
 * `vimeo` and `wistia` here and absent from `youtube` altogether: YouTube's own
 * poster is derivable from the id and needs no opt-in to resolve.
 */
export type PlayerProviderOptions = {
  readonly wistia?: PrimitiveOptionBag<
    Omit<
      WistiaProviderOptions,
      'endTime' | 'loop' | 'resolvePoster' | 'startTime'
    >
  >;
  readonly youtube?: PrimitiveOptionBag<
    Omit<
      YouTubeProviderOptions,
      'controls' | 'endTime' | 'loadIframeApi' | 'loop' | 'startTime'
    >
  >;
  readonly vimeo?: PrimitiveOptionBag<
    Omit<
      VimeoProviderOptions,
      'controls' | 'endTime' | 'loop' | 'resolvePoster' | 'startTime'
    >
  >;
  readonly hls?: PrimitiveOptionBag<{ readonly build?: HlsBuild }>;
};

/**
 * What `Root` actually hands the loader: the public bags with `Root`'s own
 * `controls`, `loop`, `startTime` and `endTime` folded into each provider that
 * has an answer to them. `hls` folds nothing in -- `loop`, `startTime` and
 * `endTime` already reach it through `nativeOptions`, the way they reach the
 * native provider -- so it carries the same shape here as it does above.
 */
export type ResolvedProviderOptions = {
  readonly wistia?: WistiaProviderOptions;
  readonly youtube?: YouTubeProviderOptions;
  readonly vimeo?: VimeoProviderOptions;
  readonly hls?: PlayerProviderOptions['hls'];
};

// The minimum shape a supplied kind's own detected source carries: enough for
// `loadProvider`'s dispatch below to route by `type`, the same field every
// built-in `ResolvedPlayerSource` member already carries one of. A
// registration's fields beyond `type` are its own business, not this
// package's -- `loadProvider` never reads them, only passes the whole object
// on to the registration's own factory.
export type SuppliedProviderSource = { readonly type: string };

// What calling a `ProviderRegistration.load()` resolves to: not the adapter
// itself, but the factory that builds one, given a mount point and the
// detected source -- the same two-step shape every built-in branch below
// already takes inline. `await import('@playdeck/provider-hls')` resolves the
// module; `createHlsProvider(media, source, options)`, the export that import
// hands back, is the call that actually builds the adapter. `load()` is
// "lazy" because calling it is what performs a supplied kind's own dynamic
// import; calling what it resolves to is what performs the build.
//
// The factory's return type is `ProviderAdapter<Source['type']>`, not the
// bare `ProviderAdapter` every built-in branch below returns: `Source['type']`
// is the same literal a registration's own `Source` already carries (the
// field `loadProvider` dispatches on), so instantiating `PlayerProvider`'s
// `Extra` parameter with it is what lets the factory write `provider:
// 'example-file'` (say) directly on the adapter it builds, with no cast --
// `examples/provider-setup-file-adapter.tsx`'s `createExampleFileAdapter` is
// exactly this.
export type ProviderAdapterFactory<
  Source extends SuppliedProviderSource,
  Options extends Record<string, PrimitiveOptionValue> = Record<string, never>
> = (
  media: PlayerMediaMount | null,
  source: Source,
  options?: Options
) => ProviderAdapter<Source['type']> | Promise<ProviderAdapter<Source['type']>>;

/**
 * One entry of `Root`'s `providers` prop, keyed by the source-kind name it
 * registers: `detect` turns a URL into this kind's own source object, or
 * declines by returning `undefined`; `load` is the lazy factory above.
 *
 * A `detect` that throws declines too, exactly as if it had returned
 * `undefined` -- `detectSourceWithProviders` (below) catches it and moves on
 * to the next registration. The throw is not lost: it is reported the same
 * way a throwing subscriber already is elsewhere in this package
 * (`notifySafely`, `@playdeck/core`), on a fresh task, so it is still visible
 * without being able to escape render and reach a consumer's error boundary
 * (#753).
 *
 * `Source` types the object `detect` builds, which `loadProvider` later hands
 * unchanged to the loaded factory -- it must carry its own `type` literal so a
 * resolved source can be routed back to this registration by name, the way
 * `source.type === 'hls'` already routes to the built-in HLS branch. `Options`
 * types the bag a consumer may pass under this kind's own key in
 * `providerOptions`, guarded by `PrimitiveOptionBag` above for the reason
 * `PlayerProviderOptions`'s own doc comment gives: `providerOptionsEqual`
 * (`use-activation.ts`) compares every such bag with `Object.is`, which is
 * only meaningful over primitives.
 */
export type ProviderRegistration<
  Source extends SuppliedProviderSource = SuppliedProviderSource,
  Options extends Record<string, PrimitiveOptionValue> = Record<string, never>
> = {
  readonly detect: (url: string) => Source | undefined;
  readonly load: () => Promise<ProviderAdapterFactory<Source, Options>>;
};

// The constraint `Root`'s own `providers` prop is generic over: a map from a
// source-kind name to its registration. Exported so a consumer naming a
// wrapper component's own prop -- `RootProps<MyProviders>` -- has something to
// bound `MyProviders` by without reaching into `ProviderRegistration`'s own
// type parameters by hand.
//
// `any`, not a concrete pair of types or `ProviderRegistration`'s own
// defaults: `Source` appears in `ProviderRegistration` both covariantly
// (`detect`'s return) and contravariantly (`load`'s factory's own `source`
// parameter), so it is invariant overall, and TypeScript's structural checks
// reject a `ProviderRegistration<AcmeSource, AcmeOptions>` against any
// concrete pair here -- `unknown` fails the contravariant side (`load`'s
// factory's own `source` parameter), `never` fails the covariant one
// (`detect`'s return type), verified with `tsc --strict` against a minimal
// two-member repro of this same shape -- and the two built-in kinds' own
// concrete types would
// reject each other's registration the same way a heterogeneous map always
// rejects a narrower member under strict function-parameter variance. `any`
// is the one pair this constraint can hold every registration to at once,
// exactly the way `ComponentType<any>` holds a heterogeneous React tree
// together; nothing downstream reads this alias's own `Source`/`Options` --
// `SuppliedSource` and `SuppliedProviderOptions` below re-derive each
// registration's own pair through `infer`, which is what keeps a consumer's
// own types exact despite the constraint they are bound by.
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- see above
export type PlayerProviders = Record<string, ProviderRegistration<any, any>>;

// The five names a `providers` map cannot register under, read off
// `PlayerSource`'s own closed union (`@playdeck/core`) rather than repeated
// here by hand, so a sixth built-in kind added there reserves its own name
// automatically. `RESERVED_PROVIDER_NAMES` below is the runtime array this
// package still hardcodes for the same five names -- unlike this type, it
// does not re-derive from `PlayerSource` and so does not follow a sixth kind
// on its own.
export type BuiltInSourceKind = ResolvedPlayerSource['type'];

// `Root`'s own generic bound (`RootProps`, `root.tsx`): every entry of `P`
// beyond the five built-in kind names. A registration keyed by one of them
// used to typecheck against plain `PlayerProviders` and resolve nothing at
// runtime -- `loadProvider`'s five built-in branches dispatch on
// `source.type` ahead of ever consulting `providers`
// (`RESERVED_PROVIDER_NAMES` below is the runtime half of the same rule).
// Intersecting with a `Partial` record of `never` values -- rather than,
// say, `Omit` -- is what turns a registration under one of these keys into a
// compile error: a present property must be assignable to `never`, which
// nothing but `never` itself is, while an absent one satisfies the
// `Partial` trivially, so a `providers` map that never registers a built-in
// name typechecks exactly as before.
//
// Not folded into `PlayerProviders` itself: that alias also types
// `loadProvider`'s and `detectSourceWithProviders`'s own `providers`
// parameter, which this package's runtime defence
// (`RESERVED_PROVIDER_NAMES` below) is written to handle regardless of how a
// caller assembled it -- `provider-loaders.test.ts`'s own reserved-name
// tests construct exactly such a map to prove that defence, and need
// `PlayerProviders` to still accept it. The compile error belongs at
// `Root`'s own consumer-facing boundary, not at the internal functions that
// must keep tolerating a reserved key arriving anyway.
export type ConsumerProviders = PlayerProviders &
  Partial<Record<BuiltInSourceKind, never>>;

// The union of every supplied kind's own source shape in `P`, closed over
// `PlayerSource`'s generic parameter (`@playdeck/core`'s `types.ts`) the same
// way the five built-in kinds close over the non-generic union. `never` where
// `P` supplies no entries -- `keyof {} ` is `never`, and a mapped type indexed
// by `never` is itself `never` -- which is what keeps
// `PlayerSource<SuppliedSource<P>>` identical to the plain, non-generic
// `PlayerSource` for a `Root` that never sets `providers` (`root.tsx`'s own
// default `P`). The second `any` this `infer` pattern reaches past is what it
// is not asking about -- `Options`, re-derived on its own terms by
// `SuppliedProviderOptions` below -- so it is not the same permissiveness
// `PlayerProviders` needs; it holds only because `extends` accepts `any` in a
// position it is not inferring through.
//
// `keyof P & string`, not the bare `keyof P` a homomorphic mapped type would
// ordinarily read off P: TypeScript infers a generic type parameter straight
// through a mapped type of exactly that bare shape, so a `Root` call passing
// only `providerOptions` -- no `providers` at all -- could still produce a
// candidate for `P` from `providerOptions`'s own object shape (a `{ vimeo:
// {...} }` bag read as though it were naming a supplied provider). Once
// `PlayerProviders` above reserves the five built-in names, that spurious
// candidate fails the constraint and every built-in `providerOptions` key
// resolves to `undefined` in the fallout -- confirmed against this file's own
// `hls`/`vimeo`/`wistia`/`youtube` test suites and the examples under
// `examples/`, all breaking the same way. Intersecting with `string` here
// breaks that special case (the mapped type is no longer read as directly
// over the naked parameter), so `P` is inferred from an actual `providers`
// value alone, exactly as before.
export type SuppliedSource<P extends PlayerProviders> = {
  [K in keyof P & string]: P[K] extends ProviderRegistration<
    infer Source,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- see above
    any
  >
    ? Source
    : never;
}[keyof P & string];

// The `providerOptions` keys `P` opens up, one per supplied kind, each typed
// by that registration's own `Options` parameter -- folded into
// `RootProps.providerOptions` alongside `PlayerProviderOptions`'s four
// built-in keys (`root.tsx`). `Source`'s own `any` here is `SuppliedSource`'s
// mirror image, for the same reason. `keyof P & string` is `SuppliedSource`'s
// own reason too, and it costs this mapped type its homomorphism over `P` --
// `readonly` is written explicitly below rather than left to be inherited
// from `P`'s own entries, matching `PlayerProviderOptions`'s own readonly
// built-in keys.
export type SuppliedProviderOptions<P extends PlayerProviders> = {
  readonly [K in keyof P & string]?: P[K] extends ProviderRegistration<
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- see above
    any,
    infer Options
  >
    ? Options
    : never;
};

export type ProviderLoaderRequest = {
  readonly source: ResolvedPlayerSource<SuppliedProviderSource>;
  readonly media: PlayerMediaMount | null;
  readonly nativeOptions: NativePlaybackOptions;
  readonly providerOptions?: ResolvedProviderOptions;
  // Untyped by the specific `providers` map a consumer wrote: by the time a
  // source reaches here it has already been detected, so all this function
  // needs is to look a registration up by `source.type` and call it. The
  // per-kind `Source`/`Options` typing lives at `Root`'s own boundary
  // (`root.tsx`'s generic `RootProps<P>`), not here.
  readonly providers?: PlayerProviders;
  // `PlayerController.reportRefusedUrl`'s own signature, taken structurally
  // rather than importing the controller itself: `loadProvider` gates a
  // supplied kind's own option bag (below) but has no controller of its own
  // to report through, and no lifecycle across calls to hold the disposer
  // this returns -- the caller does (`use-activation.ts`), which is who
  // passes this in and who owns disposing what it hands back. Optional for
  // the same reason `useRefusedUrlReport`'s own `controller` parameter is
  // (`player-context.ts`): this function is also called directly, in tests
  // and by any caller with nothing to report to, and refusing there must
  // still omit the value rather than throw (#752).
  readonly reportRefusedUrl?: (surface: RefusedUrlSurface) => () => void;
};

// The supplied-kind counterpart of `everyStringPermitted` further down: a
// flat check rather than a recursive one, because `PrimitiveOptionBag`'s own
// contract (above) keeps every provider option bag flat -- string, number,
// boolean or absent, never a nested object or array -- so there is nothing
// underneath a bag's own values for a recursive walk to find. A refused
// string is dropped from the bag entirely, the same way an absent option
// would be, rather than replaced with anything: the factory this bag reaches
// must never see a value the allowlist refused, and omission is the one
// substitute this package already uses everywhere else it refuses a
// consumer-supplied URL (#752).
//
// Guards against a non-object arriving despite what `PrimitiveOptionBag`
// promises -- a consumer bypassing the type, or simply an absent bag -- by
// handing it back unchanged rather than throwing: `Object.entries` on
// anything else would either throw (`null`) or read no own keys worth
// walking, and this function's own contract is that it never throws.
const sanitizeSuppliedProviderOptions = (
  options: Record<string, PrimitiveOptionValue> | undefined
): {
  readonly options: Record<string, PrimitiveOptionValue> | undefined;
  readonly refused: boolean;
} => {
  if (typeof options !== 'object' || options === null) {
    return { options, refused: false };
  }
  let refused = false;
  const sanitized: Record<string, PrimitiveOptionValue> = {};
  for (const [key, value] of Object.entries(options)) {
    if (typeof value === 'string' && !isPermittedSourceUrl(value, undefined)) {
      refused = true;
      continue;
    }
    sanitized[key] = value;
  }
  return { options: sanitized, refused };
};

// The return type is `ProviderAdapter<SuppliedProviderSource['type']>`
// (`SuppliedProviderSource['type']` is `string`), not the bare `ProviderAdapter`
// every one of the five built-in branches below returns on its own: a
// registration's own factory is free to report any identity, so this
// function's own public contract has to admit that width honestly rather
// than narrowing it back with a cast at the one return statement that
// actually needs it.
export const loadProvider = async ({
  media,
  nativeOptions,
  providerOptions,
  providers,
  reportRefusedUrl,
  source
}: ProviderLoaderRequest): Promise<
  ProviderAdapter<SuppliedProviderSource['type']>
> => {
  // The five built-in branches below are typechecked against the plain,
  // non-generic union `ResolvedPlayerSource` -- what `source` was typed as
  // before `providers` existed. `ResolvedPlayerSource<SuppliedProviderSource>`
  // (`source`'s actual, wider parameter type) adds exactly one further
  // member, `SuppliedProviderSource`, whose `type` is a plain `string`,
  // overlapping every one of the five literals compared below -- so without
  // this assertion, TypeScript could not narrow `source.type === 'hls'`
  // down to `HlsSource` the way it could when the union held only literal
  // discriminants, and every branch would fail to typecheck the value it
  // hands its adapter factory. The two are exactly as unsound as the assertion
  // in every other cast this file already makes after a runtime check has
  // done the narrowing typescript's own control flow analysis cannot: the
  // registration lookup below runs on the untouched, wider `source`, so a
  // resolved source whose `type` this assertion turns out to be wrong about
  // -- because it is genuinely a supplied kind's own shape -- is still
  // dispatched correctly by that lookup, which never sees `builtin`.
  const builtin = source as ResolvedPlayerSource;
  if (builtin.type === 'hls') {
    if (!media || !(media instanceof HTMLVideoElement)) {
      throw new Error('The HLS provider requires a media mount.');
    }
    const { createHlsProvider } = await import('@playdeck/provider-hls');
    return createHlsProvider(media, builtin, {
      ...nativeOptions,
      ...providerOptions?.hls
    });
  }
  if (builtin.type === 'video') {
    if (!media || !(media instanceof HTMLVideoElement)) {
      throw new Error('The native provider requires a media mount.');
    }
    const { createNativeProvider } = await import('@playdeck/provider-native');
    return createNativeProvider(media, nativeOptions);
  }
  if (builtin.type === 'youtube') {
    if (!media) {
      throw new Error('The YouTube provider requires a media mount.');
    }
    const { createYouTubeProvider } =
      await import('@playdeck/provider-youtube');
    return createYouTubeProvider(
      media,
      builtin.videoId,
      providerOptions?.youtube
    );
  }
  if (builtin.type === 'vimeo') {
    if (!media) {
      throw new Error('The Vimeo provider requires a media mount.');
    }
    const { createVimeoProvider } = await import('@playdeck/provider-vimeo');
    return createVimeoProvider(media, builtin, providerOptions?.vimeo);
  }
  if (builtin.type === 'wistia') {
    if (!media) {
      throw new Error('The Wistia provider requires a media mount.');
    }
    const { createWistiaProvider } = await import('@playdeck/provider-wistia');
    return createWistiaProvider(media, builtin, providerOptions?.wistia);
  }
  // Not one of the five built-in kinds: a supplied kind, whose registration
  // `providers` looks up by the resolved source's own `type`, the same field
  // every branch above dispatches on. `providers` is `undefined` for a `Root`
  // that never sets the prop, so this lookup is then `undefined?.[…]` --
  // `undefined` -- and control falls straight through to the "no provider
  // adapter" throw below, exactly as an unrecognised `source.type` already
  // did before `providers` existed.
  const registration = providers?.[source.type];
  if (registration) {
    const factory = await registration.load();
    // Gated here, in the library, rather than left to the registration's own
    // factory: `providerOptions[source.type]` reaches provider-authored code
    // exactly the way the resolved source already does above, and a supplied
    // adapter is not expected to guard its own options any more than a
    // built-in one's own gate (Wistia's `poster`, YouTube's `host`) is
    // reachable from outside this package (#752).
    const { options, refused } = sanitizeSuppliedProviderOptions(
      (
        providerOptions as
          Record<string, Record<string, PrimitiveOptionValue>> | undefined
      )?.[source.type]
    );
    if (refused) reportRefusedUrl?.('providerOptions');
    return factory(media, source, options);
  }
  throw new Error(`No provider adapter is installed for ${source.type}.`);
};

// Whether every string reachable inside `value` -- its own value if it is one
// itself, or any string nested through an object or array at any depth --
// passes `isPermittedSourceUrl(value, undefined)`. `undefined` is passed for
// `type` throughout because a supplied kind's own shape carries no field this
// package knows to be a URL, let alone which built-in source kind it might
// belong to (a supplied kind's `blob:` field, if it has one, is refused the
// same way an unresolved bare string refuses it -- there is no `'video'` to
// pass here to admit it, unlike the built-in `video` branch above).
//
// Reading `isPermittedSourceUrl`'s own body and doc comment
// (`packages/core/src/source-detection.ts`) confirms both halves of why this
// rule is safe to apply to an arbitrary field rather than only a known one:
// it returns `true` whenever the value names no scheme at all (`schemeOf`
// returns `undefined` for it), which is what lets a plain id
// (`"dQw4w9WgXcQ"`), a relative path, or any other non-URL string pass
// through untouched -- and it returns `false` only for the two cases that
// matter, a forbidden scheme (`javascript:`, `data:`, and `blob:` outside a
// `video` source) or a value the URL parser would strip characters from
// before parsing. Neither of those depends on which field the string came
// from, which is what makes one allowlist call correct for every string in an
// unknown shape.
//
// The recursion is not a defensive flourish: a shallow, top-level-only check
// would leave a nested field as a live bypass of this exact gate -- `{ type:
// 'acme', config: { url: 'javascript:alert(1)' } } ` refuses at the top level
// (no string named `type` is a URL) while carrying a forbidden scheme one
// level down. A supplied kind's shape is arbitrary, so there is no schema
// here to check a known field against instead; every string, at every depth,
// is the only rule that cannot be routed around by nesting the dangerous
// value one level deeper than whatever a shallow check happened to look at.
//
// `seen` guards that same arbitrariness against a cyclic object -- a `detect`
// return is provider-authored, so a self-reference is reachable input rather
// than a hypothetical this package could assume away. Each object or array is
// recorded before its own values are walked and removed once that walk
// returns, so `seen` holds exactly the current call's ancestors, not every
// value visited so far -- meeting one still on the path declines it as a
// cycle, while the same object reached again through a sibling branch, after
// its own walk has already finished and removed it, is walked fresh. That is
// what tells a genuine cycle apart from a diamond -- the same nested object
// referenced from two branches with no cycle anywhere -- which this must
// accept rather than decline. A `WeakSet` rather than a plain `Set` so
// tracking a value for the depth of one call holds no reference to it
// afterwards. Declining a true cycle reaches the same outcome a forbidden
// scheme does at every call site -- the explicit-object path falls through to
// the built-in failure, the string path treats it as one registration's
// decline and keeps walking the rest -- because a cycle is exactly as
// untrustworthy a shape as a `javascript:` URL, not a reason to throw where
// every other refusal returns.
//
// One `typeof value === 'object'` branch covers an array too, rather than a
// separate `Array.isArray` branch ahead of it: `Object.values` reads an
// array's own numeric-index entries in order, the same elements `.every`
// would have iterated directly, so the two branches walked identically and
// only ever differed in which call read them off `value`. Adding the cycle
// guard to both would have meant writing the same two lines twice.
const everyStringPermitted = (
  value: unknown,
  seen: WeakSet<object> = new WeakSet()
): boolean => {
  if (typeof value === 'string') {
    return isPermittedSourceUrl(value, undefined);
  }
  if (typeof value === 'object' && value !== null) {
    if (seen.has(value)) return false;
    seen.add(value);
    try {
      return Object.values(value).every((item) =>
        everyStringPermitted(item, seen)
      );
    } finally {
      seen.delete(value);
    }
  }
  // A number, boolean, null or undefined names no URL, so it needs no check
  // and cannot fail one.
  return true;
};

// The named depth cap `copySuppliedSourceValue` below refuses past: sized
// generously above any legitimate supplied-kind shape -- the deepest built-in
// source `sourceFromExplicitObject` accepts, `{ type: 'video', sources: [{
// src, mimeType }] }`, is two levels deep -- while still bounding the
// recursion a genuinely deep, narrow, acyclic object (say, one built by
// looping `JSON.parse` output) could otherwise ask for before the node budget
// below ever has a chance to. A true cycle is refused outright by the
// ancestor check below, in O(1), without ever needing to reach this cap.
const MAX_SUPPLIED_SOURCE_DEPTH = 32;

// The total node budget `copySuppliedSourceValue` below refuses past: every
// object, array and primitive the copy visits counts against it, whether or
// not that value ends up admitted, and going over it refuses the whole
// source. Sized generously above any legitimate supplied-kind shape -- a
// realistic source carries tens of fields, not thousands -- while still
// bounding the copy's own total size. That size bound is not a performance
// nicety: it is what makes every later walk over the copy -- `sourceKey`'s
// `JSON.stringify` (`use-activation.ts`), the factory's own reads -- linear
// too, because none of them can visit more nodes than this copy was allowed
// to have. See this function's own doc comment for why a diamond is admitted
// as two independent copies, at the cost of this budget, rather than one
// shared object counted once.
const MAX_SUPPLIED_SOURCE_NODES = 10_000;

// The plain, bounded value space `copySuppliedSourceValue` below builds --
// deliberately narrower than "JSON-serialisable", so nothing in it can carry
// a `toJSON` for `sourceKey`'s `JSON.stringify` (`use-activation.ts`,
// `viewport-media.tsx`) to call, and deliberately narrower than "structurally
// cloneable", so nothing in it can carry a `Map`, a `Set`, or a `bigint`
// either.
type SuppliedSourceValue =
  | string
  | number
  | boolean
  | null
  | undefined
  | readonly SuppliedSourceValue[]
  | { readonly [key: string]: SuppliedSourceValue };

type SuppliedSourceCopyResult =
  | { readonly ok: true; readonly value: SuppliedSourceValue }
  | { readonly ok: false };

// The one-shot structural copy `detectSourceWithProviders`'s explicit-object
// branch below takes of a caller's own object before any validation runs over
// it -- the fix for four related defects (#754), all tracing back to one
// root: that branch used to return the caller's own object unchanged, and
// `everyStringPermitted` walked that same live object rather than a value
// this package controls.
//
// Each own enumerable string-keyed value is read through exactly one
// `value[key]` access and never touched again -- what closes the getter
// defect on its own, with no separate accessor detection needed: a `url`
// getter that answers a permitted scheme on its first read and `javascript:`
// on a second never gets a second read, so the copy carries whichever string
// that one read produced, and that string is what a resolved source's
// `source` field and the factory both see thereafter. Rejecting every
// accessor outright was the other option the issue named; reading once is
// simpler, because it is the same rule this function already needs for every
// value, accessor or not. The shared allowlist (`isPermittedSourceUrl`) runs
// on that same single read, right where the string is admitted into the
// copy: a string is refused, not merely copied unchecked, so nothing further
// has to re-walk the finished copy hunting for a forbidden scheme -- see why
// that second walk would matter below, at `MAX_SUPPLIED_SOURCE_NODES`.
//
// A key is skipped, not refused, when it is own but non-enumerable:
// `Object.keys` below already excludes it, so the copy never carries it, and
// neither this function's caller nor the factory ever sees it -- closing the
// same hole a symbol-keyed value opens, by omission rather than by
// inspection. A symbol key is different only in that its whole object is
// refused instead of just that one key: `Object.getOwnPropertySymbols` is
// checked explicitly, because enumerating string keys alone would silently
// skip a symbol the same way `Object.keys` silently skips a non-enumerable
// string, and a shape this package cannot fully account for is refused
// rather than partially admitted.
//
// "Plain" is `Object.prototype` or `null` as the value's own prototype --
// what an object literal and `Object.create(null)` both produce, and what a
// `Map`, a `Set`, a `Date`, or an instance of a class a provider author wrote
// do not. Any of those is refused outright, at whatever depth it occurs,
// rather than read as a value this walk would have to know how to open.
//
// `ancestors` holds every object still on the current recursion path;
// hitting one already there is a genuine cycle (the value is its own
// ancestor), refused in O(1) with no need to reach `MAX_SUPPLIED_SOURCE_DEPTH`
// or `MAX_SUPPLIED_SOURCE_NODES` at all -- `{ type: 'acme', a: self, b: self
// }` is refused after two calls.
//
// A diamond -- the same nested object reached through two sibling branches,
// which is not a cycle, since neither branch is the other's ancestor -- is
// copied independently for each branch rather than memoised into one shared
// copy, deliberately: a memoised copy would still carry the diamond's shared
// reference, and nothing downstream of this function walks the copy with any
// memory of its own. `sourceKey` (`use-activation.ts`) calls
// `JSON.stringify` on a resolved source during every render, and
// `JSON.stringify` does not deduplicate a shared reference -- it serialises
// every path to it -- so a copy that preserved a diamond's sharing would move
// the exact exponential cost this function exists to avoid one call
// downstream, into render, rather than remove it. `MAX_SUPPLIED_SOURCE_NODES`
// is the actual guard against that: every value this function visits, valid
// or not, counts against one shared budget, so a small diamond -- copied
// twice, costing twice its own size -- is well within it, while a diamond
// chain deep enough to double at every level exhausts the budget after a
// small, fixed number of levels and refuses the whole source, promptly, the
// same way a forbidden scheme does. Because the budget is shared across the
// whole call and checked before any further work happens once it is spent,
// going over it fails fast: the first value that trips it returns refused
// immediately, which -- exactly like a cycle -- short-circuits every
// enclosing object's own loop below, so the remaining, still-unexplored half
// of an exponential shape is never actually walked.
//
// `everyStringPermitted` itself, and its own `WeakSet`-based cycle guard, are
// unchanged: its one remaining call site -- a registration's own `detect`
// return, in the string branch below -- gets no copy step, so it still walks
// a live, potentially cyclic object directly and still needs a guard of its
// own. Nothing about it needs a node budget of its own either, for the same
// reason it needs no diamond memo: nothing calls it twice over the same
// object the way a hypothetical second pass over this function's own copy
// would.
const copySuppliedSourceValue = (
  value: unknown,
  depth: number,
  ancestors: Set<object>,
  nodes: { count: number }
): SuppliedSourceCopyResult => {
  nodes.count += 1;
  if (nodes.count > MAX_SUPPLIED_SOURCE_NODES) return { ok: false };

  if (value === null || value === undefined) return { ok: true, value };
  if (typeof value === 'string') {
    return isPermittedSourceUrl(value, undefined)
      ? { ok: true, value }
      : { ok: false };
  }
  if (typeof value === 'boolean') return { ok: true, value };
  if (typeof value === 'number') {
    return Number.isFinite(value) ? { ok: true, value } : { ok: false };
  }
  if (typeof value !== 'object') {
    // A function, a `bigint`, or a `symbol` value -- none of which any
    // legitimate supplied-kind source shape carries.
    return { ok: false };
  }

  if (ancestors.has(value)) return { ok: false };
  if (depth > MAX_SUPPLIED_SOURCE_DEPTH) return { ok: false };
  if (Object.getOwnPropertySymbols(value).length > 0) return { ok: false };

  ancestors.add(value);
  let result: SuppliedSourceCopyResult;
  if (Array.isArray(value)) {
    const copied: SuppliedSourceValue[] = [];
    result = { ok: true, value: copied };
    for (const item of value) {
      const itemResult = copySuppliedSourceValue(
        item,
        depth + 1,
        ancestors,
        nodes
      );
      if (!itemResult.ok) {
        result = itemResult;
        break;
      }
      copied.push(itemResult.value);
    }
  } else {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      result = { ok: false };
    } else {
      const copied: Record<string, SuppliedSourceValue> = {};
      result = { ok: true, value: copied };
      for (const key of Object.keys(value)) {
        const keyResult = copySuppliedSourceValue(
          (value as Record<string, unknown>)[key],
          depth + 1,
          ancestors,
          nodes
        );
        if (!keyResult.ok) {
          result = keyResult;
          break;
        }
        copied[key] = keyResult.value;
      }
    }
  }
  ancestors.delete(value);
  return result;
};

// `detectSourceWithProviders`'s own entry point into the copy above: its
// explicit-object branch already knows `input` is a non-null, non-array
// object by the time it calls this, so the only way this can fail to produce
// one is whatever `copySuppliedSourceValue` itself refused, or threw.
// `ancestors` and `nodes` are created fresh here, once per call, rather than
// shared across calls -- there is no reason to hold either past the one copy
// they serve.
//
// The `try` is this function's own guard, not `copySuppliedSourceValue`'s:
// every read that function makes -- `value[key]`, `Object.keys`,
// `Object.getOwnPropertySymbols`, `Object.getPrototypeOf` -- can throw for an
// object this package did not build, and none of the checks earlier in that
// function can rule that out first. A plain object can declare an ordinary
// data property as a throwing getter; a `Proxy` can make any one of those
// four operations throw from its own trap. Catching here, once, after the
// whole recursive copy either finishes or throws, is what "the copy must
// still read each value only once" requires: a `catch` placed around an
// individual read and retried would read that value a second time, which is
// exactly the getter hazard this package's own single-read rule (this
// function's own doc comment, above) exists to close. A throw part-way
// through is treated the same as an ordinary refusal -- `invalid-source`,
// never a throw out of `detectSourceWithProviders` -- because a value that
// cannot even be read safely is refused for the same reason a `Map` or a
// `bigint` is: this package cannot fully account for it.
const copySuppliedSourceObject = (
  input: Record<string, unknown>
): Record<string, SuppliedSourceValue> | undefined => {
  try {
    const result = copySuppliedSourceValue(input, 0, new Set<object>(), {
      count: 0
    });
    return result.ok
      ? (result.value as Record<string, SuppliedSourceValue>)
      : undefined;
  } catch {
    return undefined;
  }
};

// The five source-kind names `loadProvider` above dispatches to
// unconditionally, ahead of ever consulting `providers`. A registration keyed
// by one of these is skipped in both paths below -- before its `detect` is
// even called on the string path, and before its entry is looked up at all on
// the explicit-object path -- rather than merely finding, once called, that
// `loadProvider` routes a resolved source of that `type` to the matching
// built-in branch regardless of which registration produced it.
//
// That is not only dead code being pruned: proven by probe, a registration
// keyed `hls` whose `detect` returned `{ type: 'hls', src:
// 'https://evil.test/injected.m3u8' }` had that `detect` actually called --
// `true` -- and its return routed straight to `loadProvider`'s built-in `hls`
// branch, which builds the adapter from it directly and never runs it through
// `sourceFromExplicitObject`'s own per-kind validation (`isPermittedSourceUrl`
// against `src`, `packages/core/src/source-detection.ts`). Skipping the
// registration here, before either path can call it, closes that: a
// registration cannot masquerade as a built-in kind's own resolved source by
// returning one shaped like it.
const RESERVED_PROVIDER_NAMES: readonly string[] = [
  'hls',
  'video',
  'youtube',
  'vimeo',
  'wistia'
];

// `Root`'s own `detectSource`, layered over core's: core's own five-kind
// `detectSource` runs first and wins outright on success, so a supplied kind
// never gets a look-in on a URL -- or an explicit object -- a built-in host
// already claims. Only on a built-in refusal does a `providers` entry get a
// turn, and there are two distinct shapes of refusal this handles, mirroring
// the two ways core itself resolves a source (`sourceFromExplicitObject` vs.
// the string path, `packages/core/src/source-detection.ts`):
//
// A string is walked against every `providers` entry's own `detect`, in the
// object's own enumeration order -- insertion order for the string keys this
// map is ever given, the one order property enumeration guarantees (ECMA-262
// `OwnPropertyKeys`), which is declaration order as `Root`'s own doc comment
// on `providers` promises -- using the first whose `detect` both accepts the
// string and returns a value `everyStringPermitted` clears. That walk is the
// same one the explicit-object path below applies to an object handed in
// directly -- a `detect` return is exactly as arbitrary a shape, so it is
// exactly as capable of hiding a forbidden scheme a level or more down, and
// proven so by the same probe `RESERVED_PROVIDER_NAMES` above cites: a
// registration whose `detect` returned `{ type: 'acme', config: { url:
// 'javascript:alert(1)' } }` used to have that value accepted outright,
// because only the explicit-object path had ever run this walk. A `detect`
// return that fails it is treated as a decline, not as a reason to fail
// detection outright: the loop below simply keeps walking the remaining
// registrations, exactly as it already does when `detect` itself returns
// `undefined`, because one registration returning a value this package
// refuses to trust is not grounds to veto a later registration that would
// have matched honestly.
//
// An explicit object is resolved without ever calling a registration's
// `detect`: `detect` takes a URL string by contract, and an object arriving
// here has already declared its own kind through its `type` field, the same
// way `sourceFromExplicitObject` skips every built-in host detector and goes
// straight to per-kind validation once `input.type` names one. `input` is
// copied into a plain, bounded structure this package controls
// (`copySuppliedSourceObject` above) before anything else runs -- never the
// caller's own object. That copy closes #754's four original defects: a
// depth cap together with an ancestor check rules out both a stack overflow
// from a deep acyclic tree and a cycle (defect 1); reading each value
// exactly once is what stops a getter answering the gate and the factory
// differently (defect 2); refusing any shape (`Map`, `Set`, a `bigint`, a
// symbol key, a class instance) this package cannot fully account for closes
// the walk's own blind spot for a string it cannot see (defect 3); and
// admitting only a value space `sourceKey`'s `JSON.stringify` can always
// serialise -- a function, `toJSON` included, is one of the refused shapes --
// is defect 4. Two further guards answer hazards outside that original four:
// the node budget (`MAX_SUPPLIED_SOURCE_NODES`, above) is what keeps a
// diamond -- copied independently per branch rather than merged into one
// shared copy -- linear rather than exponential in its own depth
// (`copySuppliedSourceValue`'s own doc comment has the full account), and
// `copySuppliedSourceObject`'s own `try`/`catch` is what a throwing getter or
// a hostile `Proxy` trap needs, since none of the above assumes a read can
// fail outright. So a record
// whose `type` is a non-empty string matching a registered `providers` key,
// and not one of `RESERVED_PROVIDER_NAMES`, is accepted as that kind's
// resolved source once the copy above has succeeded -- the shared allowlist
// already ran on every string the copy admitted, inside that same walk, so
// there is nothing left for a further `everyStringPermitted` pass to check
// here (unlike the detect-return branch above, which still calls it
// directly, over a live object no copy step ever touches). A `type` matching
// no registration, a reserved name, a `type` that is not a string at all, or
// a copy that `copySuppliedSourceObject` itself refused, falls through to the
// built-in failure below unchanged -- there is nothing a supplied kind could
// resolve any of those to.
//
// Deliberately not done here: the built-in `video` and `hls` branches of
// `sourceFromExplicitObject` also rewrite a protocol-relative `//host/...`
// value to `https://host/...` (`resolveNetworkPath`) before writing it
// through, because those two kinds have a known field to rewrite. A supplied
// kind's shape is arbitrary, so there is no single field -- or set of fields
// -- this package could rewrite without either guessing wrong or walking the
// whole object a second time to mutate it, which is more risk to a
// provider-authored shape than the rewrite buys back: `isPermittedSourceUrl`
// already permits the protocol-relative form unchanged, so refusing to
// rewrite costs nothing on the allowlist side, only the normalisation. A
// supplied kind therefore receives its own values exactly as given, and a
// provider author who cares about the protocol-relative form must normalise
// it themselves (documented in `docs/provider-setup.md`'s "Explicit source
// objects" section).
//
// Both shapes share the same security-sensitive gate: `isPermittedSourceUrl`
// is core's own allowlist, applied here exactly where core applies it itself
// -- ahead of every host-specific detector inside `detectSource` for the
// string path, and ahead of per-kind validation inside
// `sourceFromExplicitObject` for the object path -- so a forbidden scheme or a
// parser-stripped edge is refused before any supplied `detect` or resolved
// source ever reaches provider-authored code, never after. Skipping this
// step would let a `javascript:` URL -- top-level or nested -- reach a
// provider's own factory, which is the validation bypass this seam must not
// be.
export const detectSourceWithProviders = (
  input: unknown,
  providers: PlayerProviders | undefined
): SourceDetectionResult => {
  const builtin = detectSource(input);
  if (builtin.status === 'success' || !providers) {
    return builtin;
  }

  if (typeof input === 'string') {
    if (!isPermittedSourceUrl(input, undefined)) {
      return builtin;
    }
    for (const [key, registration] of Object.entries(providers)) {
      if (RESERVED_PROVIDER_NAMES.includes(key)) continue;
      // Contained the way `loadProvider`'s own dispatch already is at its
      // call site (`use-activation.ts`'s `.catch` wraps `loadProvider(...)`):
      // `detect` runs during render (`root.tsx`'s `useMemo`), where an
      // uncontained throw would reach the nearest error boundary or unmount
      // the root. Not `notifySafely` (`@playdeck/core`): it forces a `void`
      // return, and this loop needs `detect`'s own return value back. A throw
      // means the same as `undefined` -- `continue` takes the same
      // fall-through -- and `queueMicrotask` reports it the way `notifySafely`
      // reports a throwing subscriber (#753).
      let source: unknown;
      try {
        source = registration.detect(input);
      } catch (cause) {
        queueMicrotask(() => {
          throw cause;
        });
        continue;
      }
      if (source && everyStringPermitted(source)) {
        return {
          status: 'success',
          input,
          source: source as ResolvedPlayerSource
        };
      }
    }
    return builtin;
  }

  if (typeof input === 'object' && input !== null && !Array.isArray(input)) {
    const copy = copySuppliedSourceObject(input as Record<string, unknown>);
    const kind = copy?.type;
    if (
      copy &&
      typeof kind === 'string' &&
      kind !== '' &&
      !RESERVED_PROVIDER_NAMES.includes(kind) &&
      providers[kind]
    ) {
      return {
        status: 'success',
        // `input` reports the caller's own object, the same convention core's
        // own `detectSource` uses for its explicit-object success -- `source`
        // is the copy.
        input: input as PlayerSource,
        source: copy as ResolvedPlayerSource
      };
    }
  }

  return builtin;
};
