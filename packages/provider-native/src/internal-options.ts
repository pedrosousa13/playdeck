/**
 * A hatch onto `NativePlaybackOptions`, on the same terms as
 * `@playdeck/react`'s `internal-controller.ts`: a `Symbol.for`-keyed,
 * non-enumerable property that carries a setting no consumer writes,
 * deliberately not re-exported from this package's own `index.ts` so it
 * never reaches `@playdeck/provider-native`'s published `.d.ts`.
 *
 * `Symbol.for`, not `Symbol()`: the one caller that writes this,
 * `@playdeck/react`'s `use-activation.ts`, is a separate package and does
 * not import this module -- it calls `Symbol.for` with the same string key
 * directly, which the registry resolves to this exact symbol regardless.
 * Grepping the key string finds every reader and writer; importing this
 * module is not required to be one.
 *
 * Whether `@playdeck/react` committed this element's source at render time
 * rather than from an effect (`use-activation.ts`'s own `eagerVideoCommit`,
 * true only under `loading: 'eager'` for a `video` file source). The native
 * provider's `load()` reads it to decide whether a server-rendered element
 * may already be mid-fetch, without ever reading `media.networkState`
 * itself -- inserting a `<source>` child moves `networkState` off
 * `NETWORK_EMPTY` synchronously for a client-created element too, so that
 * reading could never tell the two apart.
 */
export const COMMITTED_AT_RENDER: unique symbol = Symbol.for(
  'playdeck.internal.native-committed-at-render'
);

export type CommittedAtRenderCarrier = {
  readonly [COMMITTED_AT_RENDER]?: boolean;
};
