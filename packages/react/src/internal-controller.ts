import type { PlayerController } from '@playdeck/core';

/**
 * The one deliberate way back to the live `PlayerController` from a
 * `PlayerHandle`.
 *
 * `Root`'s ref hands back exactly what `PlayerHandle` declares and nothing
 * else (#328). That closed the door on the Storybook mock-player decorator and
 * this package's test render helpers, which stage a fake provider through
 * `setProvider`/`configureAutoplay` -- members the declared handle has never
 * named. The replacement is this key rather than a `@playdeck/react/testing`
 * entry point: an entry point would add published surface and build config
 * without stopping anyone, since per #328's own "Impact bound" whoever holds
 * the ref is already same-origin and could reach the controller other ways.
 * Stopping them was never the goal. Making the *declared* surface honest was,
 * so that a reviewer auditing what a vendor overlay can reach reads
 * `PlayerHandle` and gets the right answer, with one named, greppable hatch
 * beside it instead of the whole controller by default.
 *
 * `Symbol.for` and not `Symbol()`: the key is looked up from the global symbol
 * registry, so a caller that cannot import this module still reaches it by
 * naming the same string. `apps/storybook/.storybook/mock-player.tsx` is that
 * caller -- it imports the package entry, and this module is deliberately not
 * exported from `index.tsx` (the same way `permitted-url.ts` is not). The
 * registry is a plain runtime global, so the hatch works in a browser and not
 * only under a bundler that can resolve deep paths, which the 35 Storybook e2e
 * tests running through that decorator require.
 *
 * Being a symbol keeps the key out of `Object.keys` and `JSON.stringify`, but
 * NOT out of object spread, which copies enumerable symbol keys -- measured,
 * not assumed. `Root` therefore installs it with `Object.defineProperty`,
 * whose default is non-enumerable, so `{...handle}` carries the declared
 * surface and nothing else. Pinned by index.test.tsx's "keeps the internal
 * controller hatch out of every enumeration of the handle" and "reaches the
 * live controller through the internal symbol hatch".
 */
export const INTERNAL_CONTROLLER: unique symbol = Symbol.for(
  'playdeck.internal.controller'
);

/**
 * What a `PlayerHandle` is cast through to read {@link INTERNAL_CONTROLLER}.
 * The cast stays explicit at every call site -- `PlayerHandle` itself must not
 * declare the key, or the hatch would be back in the public type and #328
 * would be undone in the only place that matters.
 */
export type InternalControllerAccess = {
  readonly [INTERNAL_CONTROLLER]: PlayerController;
};
