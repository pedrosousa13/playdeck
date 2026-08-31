/*
 * The line under the bench's player, and the state it is a function of.
 *
 * The page's central claim is stated here as a fact about the page the reader
 * is on rather than as a sentence about the library, so the one thing this line
 * may never do is be false. It is pure and it is here rather than inside the
 * component for exactly that reason: the failure it is written against is a
 * sequence of presses, and a sequence is cheap to test against a function and
 * expensive to test against a mounted player.
 *
 * ---- why this is a latch and not a reading of the current state ------------
 *
 * The first version read `snapshot.activation === 'dormant'` and printed the
 * resting sentence whenever that was true. Two presses falsified it. Under
 * `loading="interaction"` a source change returns `Player.Root` to `dormant`
 * (`use-activation.ts:483`), so:
 *
 *   press play   -> tracer.mp4 is fetched
 *   press `hls`  -> activation is `dormant` again
 *                -> "No provider has been contacted", after one had
 *
 * The second clause of that sentence is not a claim about the player's current
 * state. It is a claim about the page's history, and history does not revert.
 * The moment `bench-sources.ts` turns `youtube` on, those same two presses make
 * the page deny contacting a third party immediately after contacting one.
 *
 * So the state below is monotonic. `everLoaded` never goes back to false and
 * `everCrossOrigin` never goes back to false, because neither fact can stop
 * being true. `lastLoadedHost` is the one field that moves in both directions,
 * and it is not a claim about history -- it names what was last actually
 * loaded, so the line can say where the picture came from without implying
 * anything about what else the page has done.
 *
 * ---- why "last loaded" and not "currently selected" ------------------------
 *
 * They are different, and the difference is a way to lie in the other
 * direction. Pressing a source switch does not fetch anything: the root returns
 * to dormant and waits to be pressed. A reader who plays `native` and then
 * selects `youtube` without pressing play has contacted nobody, and a line
 * derived from the selection would name a host this page has never spoken to.
 * `recordLoad` is therefore called when a source *begins loading*, never when
 * one is chosen.
 */

/**
 * What the page has done, so far.
 *
 * Three fields rather than one, because the line makes two claims and they have
 * different lifetimes: where the picture came from, which changes, and whether
 * a third party has ever been contacted, which does not.
 */
export type QuietHistory = {
  /** Whether any source has ever begun loading on this page. */
  readonly everLoaded: boolean;
  /** Whether any cross-origin source ever has. Never returns to false. */
  readonly everCrossOrigin: boolean;
  /**
   * The host of the source at the most recent load, or `null` when that load
   * was same-origin. Not a history claim -- it names one load.
   */
  readonly lastLoadedHost: string | null;
};

/** Nothing pressed, nothing fetched, nobody contacted. */
export const QUIET_START: QuietHistory = {
  everLoaded: false,
  everCrossOrigin: false,
  lastLoadedHost: null
};

/**
 * The history after a source begins loading.
 *
 * `pageUrl` is passed rather than read from `window`, so this is a pure
 * function and a test can put the page on one origin and the source on
 * another without a DOM. The comparison is `URL#origin` against the page's own
 * -- never a provider name -- so a relative source is same-origin by
 * construction and the three hosted providers need no entry here the day their
 * clips exist.
 *
 * Returns the object it was given when nothing changed, so a caller can hand
 * this straight to a React setter without a render loop.
 */
export const recordLoad = (
  previous: QuietHistory,
  sourceUrl: string,
  pageUrl: string
): QuietHistory => {
  const resolved = new URL(sourceUrl, pageUrl);
  const host =
    resolved.origin === new URL(pageUrl).origin ? null : resolved.host;
  const next: QuietHistory = {
    everLoaded: true,
    everCrossOrigin: previous.everCrossOrigin || host !== null,
    lastLoadedHost: host
  };
  return previous.everLoaded === next.everLoaded &&
    previous.everCrossOrigin === next.everCrossOrigin &&
    previous.lastLoadedHost === next.lastLoadedHost
    ? previous
    : next;
};

/**
 * The sentence, for a history.
 *
 * Four states, and every one of them is true whenever it is printed. They are
 * kept close in length so that none wraps to a different number of lines than
 * another at the widths this page was measured at -- the line is replaced
 * rather than removed precisely so that nothing below it moves, and three
 * strings of very different lengths would give that back.
 *
 * The fourth names no host, unlike the third. A reader can visit more than one
 * hosted provider, so "www.youtube.com was contacted earlier" would be an
 * incomplete list dressed as a complete one -- a new way to be inexact, in the
 * clause that exists to be exact. The third names its host because that host is
 * where the picture on screen came from, which is one thing and knowable.
 */
export const quietLine = ({
  everLoaded,
  everCrossOrigin,
  lastLoadedHost
}: QuietHistory): string => {
  if (!everLoaded) {
    return 'No video has loaded yet. No provider has been contacted.';
  }
  if (lastLoadedHost !== null) {
    return `Loaded from ${lastLoadedHost}, contacted because you asked.`;
  }
  return everCrossOrigin
    ? 'Loaded from this origin. A third party was contacted earlier.'
    : 'Loaded from this origin. No third party has been contacted.';
};
