import { describe, expect, it } from 'vitest';
import {
  QUIET_START,
  quietLine,
  recordLoad,
  type QuietHistory
} from '../src/bench-quiet';

const PAGE = 'https://playdeck.example/';
const NATIVE = '/tracer.mp4';
const HLS = '/hls/master.m3u8';
const YOUTUBE = 'https://www.youtube.com/watch?v=example';
const VIMEO = 'https://player.vimeo.com/video/1';

const RESTING = 'No video has loaded yet. No provider has been contacted.';
const CLEAN = 'Loaded from this origin. No third party has been contacted.';
const AFTERWARDS =
  'Loaded from this origin. A third party was contacted earlier.';

/** The line after a sequence of loads, which is how a reader produces one. */
const after = (...sources: string[]): string =>
  quietLine(
    sources.reduce<QuietHistory>(
      (history, source) => recordLoad(history, source, PAGE),
      QUIET_START
    )
  );

describe('the bench quiet line', () => {
  it('says nothing has loaded before anything has', () => {
    expect(quietLine(QUIET_START)).toBe(RESTING);
  });

  /*
   * The regression the resting sentence itself was in. `Bench.astro` renders
   * `bunny-poster.webp` as a real `<img>` before any press, so at rest an
   * image has already loaded and the request that fetched it has already left
   * this page. A dormant sentence that claims either is false the moment a
   * sceptical reader checks it -- the claim that is actually true and worth
   * making is that no provider has been contacted yet.
   */
  it('does not claim that nothing has loaded or that no request has left the page, since the poster falsifies both', () => {
    const line = quietLine(QUIET_START);
    expect(line).not.toMatch(/nothing[^.]*loaded/i);
    expect(line).not.toMatch(/no request[^.]*left/i);
  });

  /*
   * The regression this module exists for.
   *
   * Under `loading="interaction"` a source change returns `Player.Root` to
   * `dormant`, so a line derived from the live activation state printed the
   * resting sentence again after a fetch had already gone out. Two presses,
   * no timing trick. The `hls` press below is the second one: the first
   * source has loaded, and whatever the player's current state is, "no
   * provider has been contacted" is now false forever.
   */
  it('never returns to the resting sentence once a source has loaded', () => {
    const played = recordLoad(QUIET_START, NATIVE, PAGE);
    expect(quietLine(played)).not.toBe(RESTING);

    // The reader presses `hls`. Nothing is fetched for it yet, and the player
    // is dormant again -- but the page's history is unchanged.
    expect(quietLine(played)).toBe(CLEAN);
    expect(quietLine(recordLoad(played, HLS, PAGE))).toBe(CLEAN);
  });

  it('reports a same-origin load without claiming anything about a third party it has contacted', () => {
    expect(after(NATIVE)).toBe(CLEAN);
    expect(after(NATIVE, HLS)).toBe(CLEAN);
  });

  it('names the host when the loaded source is cross-origin', () => {
    expect(after(YOUTUBE)).toBe(
      'Loaded from www.youtube.com, contacted because you asked.'
    );
    expect(after(NATIVE, VIMEO)).toBe(
      'Loaded from player.vimeo.com, contacted because you asked.'
    );
  });

  /*
   * The other direction the first version could have lied in, and the reason
   * `everCrossOrigin` is a field of its own. Coming back to a same-origin
   * source does not un-contact a host.
   */
  it('keeps admitting the third party after returning to a same-origin source', () => {
    expect(after(YOUTUBE, NATIVE)).toBe(AFTERWARDS);
    expect(after(NATIVE, YOUTUBE, HLS)).toBe(AFTERWARDS);
    expect(after(NATIVE, YOUTUBE, VIMEO, NATIVE)).toBe(AFTERWARDS);
  });

  it('never unsets either latch', () => {
    const history = [NATIVE, YOUTUBE, HLS, VIMEO, NATIVE].reduce<QuietHistory>(
      (current, source) => {
        const next = recordLoad(current, source, PAGE);
        // Monotonic in both fields: a load can turn either latch on and no
        // load can turn either off. Written as an implication rather than as
        // `current.everCrossOrigin || true`, which is `true` and asserts
        // nothing.
        expect(next.everLoaded).toBe(true);
        if (current.everCrossOrigin) expect(next.everCrossOrigin).toBe(true);
        return next;
      },
      QUIET_START
    );
    // The last load in that sequence is same-origin, and the latch survives it.
    expect(history.lastLoadedHost).toBeNull();
    expect(history.everCrossOrigin).toBe(true);
  });

  it('tests the page origin rather than a list of provider names', () => {
    // A hosted provider served from this very origin is not a third party, and
    // an unknown host that is not one of the five still is. Neither case can be
    // got right by matching a name.
    expect(after(`${PAGE}youtube/watch?v=x`)).toBe(CLEAN);
    expect(after('https://cdn.example.net/clip.mp4')).toBe(
      'Loaded from cdn.example.net, contacted because you asked.'
    );
  });

  it('returns the same object when a load changes nothing, so a setter cannot loop', () => {
    const once = recordLoad(QUIET_START, NATIVE, PAGE);
    expect(recordLoad(once, NATIVE, PAGE)).toBe(once);
    expect(recordLoad(once, HLS, PAGE)).toBe(once);

    const crossed = recordLoad(once, YOUTUBE, PAGE);
    expect(recordLoad(crossed, YOUTUBE, PAGE)).toBe(crossed);
  });

  // The line is replaced rather than removed so that nothing below it moves,
  // which only holds if the four strings are close enough in length to wrap the
  // same way. The rendered check is in the browser; this is the guard that
  // stops one of them drifting far enough to make that check fail.
  it('keeps every sentence within one line-length of the others', () => {
    const lengths = [
      RESTING,
      CLEAN,
      AFTERWARDS,
      quietLine({
        everLoaded: true,
        everCrossOrigin: true,
        lastLoadedHost: 'player.vimeo.com'
      })
    ].map((sentence) => sentence.length);
    expect(Math.max(...lengths) - Math.min(...lengths)).toBeLessThanOrEqual(8);
  });
});
