import type {
  PlayerSource,
  ProviderAdapter,
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
export type ProviderAdapterFactory<
  Source extends SuppliedProviderSource,
  Options extends Record<string, PrimitiveOptionValue> = Record<string, never>
> = (
  media: PlayerMediaMount | null,
  source: Source,
  options?: Options
) => ProviderAdapter | Promise<ProviderAdapter>;

/**
 * One entry of `Root`'s `providers` prop, keyed by the source-kind name it
 * registers: `detect` turns a URL into this kind's own source object, or
 * declines by returning `undefined`; `load` is the lazy factory above.
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
// concrete pair here -- `unknown` fails the covariant side, `never` fails the
// contravariant one, and the two built-in kinds' own concrete types would
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
export type SuppliedSource<P extends PlayerProviders> = {
  [K in keyof P]: P[K] extends ProviderRegistration<
    infer Source,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- see above
    any
  >
    ? Source
    : never;
}[keyof P];

// The `providerOptions` keys `P` opens up, one per supplied kind, each typed
// by that registration's own `Options` parameter -- folded into
// `RootProps.providerOptions` alongside `PlayerProviderOptions`'s four
// built-in keys (`root.tsx`). `Source`'s own `any` here is `SuppliedSource`'s
// mirror image, for the same reason.
export type SuppliedProviderOptions<P extends PlayerProviders> = {
  [K in keyof P]?: P[K] extends ProviderRegistration<
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
};

export const loadProvider = async ({
  media,
  nativeOptions,
  providerOptions,
  providers,
  source
}: ProviderLoaderRequest): Promise<ProviderAdapter> => {
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
    return factory(
      media,
      source,
      (providerOptions as Record<string, unknown> | undefined)?.[source.type]
    );
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
const everyStringPermitted = (value: unknown): boolean => {
  if (typeof value === 'string') {
    return isPermittedSourceUrl(value, undefined);
  }
  if (Array.isArray(value)) {
    return value.every(everyStringPermitted);
  }
  if (typeof value === 'object' && value !== null) {
    return Object.values(value).every(everyStringPermitted);
  }
  // A number, boolean, null or undefined names no URL, so it needs no check
  // and cannot fail one.
  return true;
};

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
// on `providers` promises -- using the first whose `detect` accepts it.
//
// An explicit object is resolved without ever calling a registration's
// `detect`: `detect` takes a URL string by contract, and an object arriving
// here has already declared its own kind through its `type` field, the same
// way `sourceFromExplicitObject` skips every built-in host detector and goes
// straight to per-kind validation once `input.type` names one. So a record
// whose `type` is a non-empty string matching a registered `providers` key is
// accepted as that kind's resolved source directly, once `everyStringPermitted`
// above has cleared every string value nested anywhere inside it. A `type`
// matching no registration, or a `type` that is not a string at all, falls
// through to the built-in failure below unchanged -- there is nothing a
// supplied kind could resolve it to.
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
    for (const key in providers) {
      const source = providers[key]?.detect(input);
      if (source) {
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
    const kind = (input as Record<string, unknown>).type;
    if (
      typeof kind === 'string' &&
      kind !== '' &&
      providers[kind] &&
      everyStringPermitted(input)
    ) {
      return {
        status: 'success',
        input: input as PlayerSource,
        source: input as ResolvedPlayerSource
      };
    }
  }

  return builtin;
};
