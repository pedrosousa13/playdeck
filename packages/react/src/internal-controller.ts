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
 * registry, so the hatch has exactly one name -- the string
 * `'playdeck.internal.controller'` -- and that name is the whole of it. Grep it
 * and every reader and every writer of the hatch is on screen at once, whether
 * or not they import this module. `apps/storybook/.storybook/mock-player.tsx`
 * is the caller that does not: it consumes `@playdeck/react` as a package, the
 * way an outside consumer does, and this module is deliberately not exported
 * from `index.tsx` (the same way `permitted-url.ts` is not). A `Symbol()` would
 * force the alternative -- either that file reaches into this package's source
 * tree, or the key becomes a published export -- and the published export
 * surface staying exactly as it was is the point. Nothing here is in the
 * `exports` map, so nothing here is API.
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
