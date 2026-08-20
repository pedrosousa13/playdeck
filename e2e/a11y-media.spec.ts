import { expect, test, type Page } from '@playwright/test';
import {
  activationButton,
  captionsButton,
  controls,
  loadingIndicator,
  media,
  muteButton,
  seekSliderInput
} from './locators';

declare global {
  interface Window {
    __playdeckAnnouncements: string[];
  }
}

// Real-media #32 checks only: real providers, real network, real decode
// timing. Split out of `e2e/a11y.spec.ts` (which stays mock-only) because the
// two families have different failure profiles — the mock tests are
// deterministic and fast, while these depend on actual video playback and are
// inherently more flake-prone. Mixing them meant a real-media timing flake and
// a genuine axe regression could surface in the same undifferentiated run.
// Keep it this way: a real-media test belongs here, never in the mock file,
// however small.

// The `RealSources` story: real providers, real media. Driven on the local MP4
// leg only — the YouTube and Vimeo legs are @real and grep-inverted out of CI.
const story = (id: string) =>
  `/iframe.html?id=reference-player--${id}&viewMode=story`;

const realSources = story('real-sources');

// Both local fixtures are ~1 second long, so `data-state="playing"` is a state
// the clip leaves on its own and asserting it is a race. `currentTime > 0` is
// race-free: it stays true once ended.
const played = (page: Page) =>
  expect
    .poll(() => media(page).evaluate((el: HTMLVideoElement) => el.currentTime))
    .toBeGreaterThan(0);

test('keyboard shortcuts reach the media element, not just the DOM', async ({
  page
}) => {
  await page.goto(realSources);
  await activationButton(page).click();
  await played(page);

  // Shortcuts are scoped to the controls region, so focus must be inside it.
  await controls(page).focus();

  await page.keyboard.press('m');
  await expect(muteButton(page)).toHaveAttribute('data-state', 'muted');
  await expect(
    media(page).evaluate((el: HTMLVideoElement) => el.muted)
  ).resolves.toBe(true);

  await page.keyboard.press('m');
  await expect(muteButton(page)).toHaveAttribute('data-state', 'unmuted');

  // The <track> the example declares through Media's children; its `default`
  // flag selects it on load, so the first press turns captions off. The
  // custom caption renderer keeps a selected track's native mode `hidden`
  // (the overlay draws it, not the browser) and an unselected one `disabled`
  // — read here off the real `TextTrack`, not just the button's own label.
  const trackMode = () =>
    media(page).evaluate(
      (el: HTMLVideoElement) => el.textTracks[0]?.mode ?? null
    );
  await expect(captionsButton(page)).toHaveAttribute('data-state', 'on');
  await expect.poll(trackMode).toBe('hidden');
  await page.keyboard.press('c');
  await expect(captionsButton(page)).toHaveAttribute('data-state', 'off');
  await expect.poll(trackMode).toBe('disabled');
  await page.keyboard.press('c');
  await expect(captionsButton(page)).toHaveAttribute('data-state', 'on');
  await expect.poll(trackMode).toBe('hidden');
});

test('arrow-key seeking moves the media element', async ({ page }) => {
  await page.goto(realSources);
  await activationButton(page).click();
  await played(page);
  await controls(page).focus();

  // Pause first. While the clip is still playing, seeking to 0 does not
  // settle there — playback resumes forward from 0 in real time, and on a
  // poll long enough it re-reaches the natural end (observed: currentTime
  // lands back at 1, not 0). `k` pauses through the same shortcut handler
  // this test exercises, giving seekBy(-5)'s clamp-at-0 a floor that holds.
  await page.keyboard.press('k');
  await expect
    .poll(() => media(page).evaluate((el: HTMLVideoElement) => el.paused))
    .toBe(true);

  // The fixture is ~1s and `seekBy(-5)` clamps at 0, so seeking BACKWARD to a
  // known floor is the deterministic direction on a clip this short —
  // seeking forward races the clip ending on its own.
  await page.keyboard.press('ArrowLeft');
  await expect
    .poll(() => media(page).evaluate((el: HTMLVideoElement) => el.currentTime))
    .toBe(0);
});

test('a focused seek slider does not silence the shortcut layer', async ({
  page
}) => {
  await page.goto(realSources);
  await activationButton(page).click();
  await played(page);

  // The slider is a native range input, and the layer used to skip every
  // INPUT target before it looked at the key — so standing here killed `m`,
  // `k`, `f`, `c`, the ten-second jumps and the volume arrows, none of which a
  // range input consumes (#181). Focus goes on the input itself, not on the
  // region: the two tests above both focus the region, which is exactly the
  // position this defect never affected.
  await seekSliderInput(page).focus();
  await expect(seekSliderInput(page)).toBeFocused();

  // `m` and not an arrow. The arrows are the keys whose OWNERSHIP moved, but
  // both local fixtures are ~1s, so no arrow assertion here could tell the
  // layer's 5s from the input's 1s `step`: `seekBy(-5)` and a 1s step both
  // clamp to 0, and seeking forward races the clip ending. `m` proves the
  // thing that was actually dead — that a bound key reaches the layer at all
  // from this target — and it proves it deterministically.
  await page.keyboard.press('m');
  await expect(muteButton(page)).toHaveAttribute('data-state', 'muted');
  await expect(
    media(page).evaluate((el: HTMLVideoElement) => el.muted)
  ).resolves.toBe(true);

  // Still on the slider: the shortcut must not have moved focus, or the second
  // press would be testing a different target than the first.
  await expect(seekSliderInput(page)).toBeFocused();

  await page.keyboard.press('m');
  await expect(muteButton(page)).toHaveAttribute('data-state', 'unmuted');
  await expect(
    media(page).evaluate((el: HTMLVideoElement) => el.muted)
  ).resolves.toBe(false);
});

test('live regions announce state transitions only, never time updates or cues', async ({
  page
}) => {
  // `captions-reference.vtt`'s cue boundary — see the fixture and the guard
  // assertion below, both of which depend on this exact value.
  //
  // This was 0.4 until the self-hosted runner (slower than the previous
  // GitHub-hosted one) started landing the observer's install position at
  // 0.46-0.54s — past the old boundary — on real activation/decode +
  // `page.evaluate` round-trip latency alone, well before any real work in the
  // window below even starts. The guard's entire point is proving the observer
  // is live strictly before the fixture's real cue transition, so that fix
  // moved the transition itself (fixture + this constant, kept equal on
  // purpose, see above) rather than just loosening the `toBeLessThan` check —
  // decoupling the two would let the guard pass while the observer still
  // missed the transition, silently reopening the exact gap this test exists
  // to close. 0.7s still leaves a real 0.3s cue-two window inside the ~1s clip.
  //
  // Widening the bound was not enough, though, because widening a bound only
  // moves a flake (#279). Measured locally at `--repeat-each=10 --workers=4`,
  // install landed at 0.11, 0.12, 0.14, 0.16, 0.24, 0.44, 0.84, 0.84, 0.88 and
  // 1.0 on chromium — four of ten past 0.7, one of them a clip that had
  // already ENDED — and webkit reached 0.83. No boundary inside a ~1s clip
  // survives that spread. So the arrangement below stopped hoping for a
  // position and started choosing one: it lets the clip end, rewinds to 0,
  // waits for the seek and the loading indicator to settle, and only then
  // installs the observer and replays. This constant is no longer headroom
  // against latency; it is purely the fixture's boundary, and the guard checks
  // it against a window the test SET both edges of.
  const cueBoundary = 0.7;

  // The window's far edge: where the playthrough poll below stops watching.
  // Far enough past `cueBoundary` that the cue transition is behind it, short
  // enough of the ~1s clip's end that the poll is not racing the clip stopping
  // on its own. Named rather than inlined because the guard compares
  // `cueBoundary` against it — that comparison is the only thing keeping the
  // fixture's boundary and the observed window stated in terms of each other.
  const playedThrough = 0.9;

  await page.goto(realSources);
  await activationButton(page).click();
  await played(page);
  // `played()` stays because it is what proves this was a real activation of a
  // real provider decoding real media. Everything after it is the test taking
  // the clock away from that latency: the observed window opens much further
  // down, so activation's own legitimate announcements — `LoadingIndicator`'s
  // `'loading-provider'` → idle among them, a meaningful state change and not
  // a time or cue violation — are never inside it.

  // Let the ~1s clip run out first, then measure the REPLAY. Ending is the one
  // position on this clip that arrives on its own and then stays put, so it
  // costs nothing to wait for and it is reached from wherever activation
  // latency happened to leave the clip — still playing, or already ended.
  await expect
    .poll(() => media(page).evaluate((el: HTMLVideoElement) => el.ended), {
      timeout: 15_000
    })
    .toBe(true);

  // Rewind to a position the test owns. An earlier revision of this block
  // rejected "seeking back to 0 first" on the grounds that a real seek drags
  // its own async settling time and its knock-on `TextTrack`/
  // `LoadingIndicator` side effects INTO the window being measured. That
  // objection is answered by ORDERING, not by ignoring it: the seek and the
  // loading indicator (#35, see the wait below) are both settled HERE, while
  // nothing is observing and while the clip cannot advance, so their side
  // effects land before the window instead of inside it. What remains inside
  // is playback from 0 and nothing else.
  //
  // Every arrangement step is driven on the media element rather than through
  // a control — this rewind, and the `play()` that opens the window alike —
  // because a control click is a user INTERACTION, and the window below asserts
  // silence across playback alone. `Player.PlayButton` is in this composition
  // and `playButton` exists in `./locators`, so the element calls are a choice,
  // not a missing locator: a click inside the window would change what the
  // silence proves. `pause()` rides along as a belt-and-braces no-op on an
  // already-ended element: it makes the guard's `paused` assertion below mean
  // "the test put it there", not "the clip happened to have run out".
  await media(page).evaluate((el: HTMLVideoElement) => {
    el.pause();
    el.currentTime = 0;
  });
  await expect
    .poll(() =>
      media(page).evaluate((el: HTMLVideoElement) => ({
        currentTime: el.currentTime,
        paused: el.paused,
        seeking: el.seeking,
        // HAVE_FUTURE_DATA or better means the element can resume from here
        // without stalling, which is what keeps `state.buffering` false across
        // the `play()` below and so keeps a `loading-indicator: Buffering`
        // entry — a real announcement, and one this test rightly refuses to
        // excuse — out of the window.
        //
        // This is why the rewind waits for the natural end rather than
        // grabbing the clip mid-play. Measured on WebKit: a paused seek from
        // mid-clip drops readyState to HAVE_CURRENT_DATA and it NEVER climbs
        // back while paused (still 2 after 3s, with the whole clip already in
        // `buffered`), so the following `play()` stalls ~1000ms — past #35's
        // 500ms debounce, i.e. a real `loading-indicator: Buffering` in the
        // window, reproducible on a single worker. Rewinding from the end
        // instead keeps readyState at HAVE_ENOUGH_DATA and `play()` reaches
        // `playing` in 8-21ms with no `waiting` at all, on all three engines.
        canResume: el.readyState >= el.HAVE_FUTURE_DATA
      }))
    )
    .toEqual({ currentTime: 0, paused: true, seeking: false, canResume: true });

  // Wait the loading indicator out too, now that waiting costs no clip time.
  // Its `'loading-provider'` → idle transition is a legitimate announcement,
  // and #35's 500ms minimum-visible floor is what pushed it late enough to
  // land inside the observed window, where it had to be excused by exact
  // value and bounded to one occurrence. Dropping that exclusion was not
  // possible while the window's start was whatever position activation latency
  // produced: waiting the floor out THERE would have advanced `currentTime`
  // past the cue boundary and silently dropped the cue coverage this test
  // exists to hold. With the position pinned at 0 while paused, the floor
  // expires before the observer exists at no cost in clip time (#279), so the
  // window below demands silence outright instead of tolerating an entry.
  await expect(loadingIndicator(page)).toHaveAttribute('data-state', 'idle');

  // Observe every live region in the tree, not a named one: a regression that
  // adds aria-live to the time display or the caption cue container has to be
  // caught here as well as structurally (the story-level inventory check only
  // proves shape, not that a live region stays silent during playback).
  //
  // One observer on `document.body`'s subtree, not one per already-known
  // region: a per-region `observe()` list built at setup time can only ever
  // watch regions that exist at that moment. `ErrorDisplay` renders `null`
  // until `state.error !== null` and then mounts a fresh `role="alert"` div as
  // a SIBLING of the regions watched here, not nested inside any of them — a
  // per-region list would never see it, even though a decode failure mid-
  // window is a real possibility on a real `<video>`, not a hypothetical.
  //
  // The callback below has two branches that stay disjoint (no double-
  // counting): `ancestor` fires for mutations INSIDE a region already present
  // in the tree (a text node's data changing, or a region's own children
  // being swapped, e.g. `LoadingIndicator` toggling between text and `null`);
  // `addedNodes` fires for a region — or one nested inside an added subtree —
  // arriving for the first time. A mutation can only ever be shaped one way
  // or the other, never both.
  await page.evaluate(() => {
    window.__playdeckAnnouncements = [];
    const selector = '[aria-live], [role="status"], [role="alert"]';
    const regionsWithin = (node: Node): Element[] => {
      if (node.nodeType !== Node.ELEMENT_NODE) return [];
      const el = node as Element;
      return el.matches(selector) ? [el] : [...el.querySelectorAll(selector)];
    };
    const observer = new MutationObserver((records) => {
      for (const record of records) {
        const ancestor = (
          record.target.nodeType === Node.TEXT_NODE
            ? record.target.parentElement
            : (record.target as Element)
        )?.closest(selector);
        if (ancestor) {
          window.__playdeckAnnouncements.push(
            `${ancestor.getAttribute('data-playdeck-part')}: ${ancestor.textContent ?? ''}`
          );
        }
        for (const added of record.addedNodes) {
          for (const region of regionsWithin(added)) {
            window.__playdeckAnnouncements.push(
              `${region.getAttribute('data-playdeck-part')}: ${region.textContent ?? ''}`
            );
          }
        }
      }
    });
    observer.observe(document.body, {
      characterData: true,
      childList: true,
      subtree: true
    });
  });

  // The guard, in two halves. The observer must be live strictly before the
  // fixture's cue transition, or the transition already happened unobserved,
  // "no announcements" would pass for having nothing left to see rather than
  // for the policy holding, and this test would silently degrade back into
  // exactly the structurally-unobservable gap the dense fixture was added to
  // close.
  //
  // One: the arrangement took. The position and paused flag are re-read at
  // install time rather than assumed, so an arrangement that did not take — a
  // seek the engine clamped elsewhere, a clip that resumed on its own — fails
  // loudly here instead of quietly eating the cue transition. Both values were
  // SET and then waited for above, not sampled and hoped over, so no amount of
  // activation, decode or `page.evaluate` round-trip latency between the
  // arrangement and here can move them.
  //
  // Two: the cue transition falls strictly INSIDE the window that position
  // opens — after the start the arrangement pinned, and before
  // `playedThrough`, where the playthrough poll stops watching. Since the
  // start is now a constant 0, comparing it to `cueBoundary` alone would be a
  // tautology; it is the pair of bounds that has to hold. Note what this is
  // and is not: nothing in this file parses `captions-reference.vtt`, so a
  // boundary edited in the fixture alone still passes here on a stale
  // assumption. What it does catch is `cueBoundary` itself leaving the
  // observed window in either direction — at or below the start, or at or past
  // `playedThrough` — which would leave the rest of this test asserting
  // silence over a window with no cue transition in it at all.
  const installedAt = await media(page).evaluate((el: HTMLVideoElement) => ({
    currentTime: el.currentTime,
    paused: el.paused
  }));
  expect(installedAt).toEqual({ currentTime: 0, paused: true });
  expect(cueBoundary).toBeGreaterThan(installedAt.currentTime);
  expect(cueBoundary).toBeLessThan(playedThrough);

  // Only now does the clip run, so the window covers it from its first frame.
  // `play()` is awaited: a rejected play promise (autoplay policy, a detached
  // element) fails the test here rather than leaving the poll below to time
  // out on a clip that never started.
  await media(page).evaluate((el: HTMLVideoElement) => el.play());

  // Play through the whole ~1s clip. `captions-reference.vtt` (this example's
  // own fixture, distinct from `captions-en.vtt`) carries two cues with a
  // boundary at 0.7s, so a real cue TRANSITION happens inside this window, not
  // just one steady cue sitting there unchanged — the fixture the composed
  // example used to declare span a single 0-5s cue, which a ~1s clip never
  // gets to see change at all. Time updates fire repeatedly over the same
  // window. Neither the cue transition nor a time tick may reach a live
  // region.
  await expect
    .poll(
      () =>
        media(page).evaluate(
          (el: HTMLVideoElement, threshold: number) =>
            el.ended || el.currentTime > threshold,
          playedThrough
        ),
      { timeout: 15_000 }
    )
    .toBe(true);

  const duringPlayback = await page.evaluate(
    () => window.__playdeckAnnouncements
  );

  // Silence, with nothing excused. The loading indicator's one legitimate
  // announcement was waited out above, before the observer existed, so a live
  // region mutating at all between the first frame and the last is a failure —
  // a `loading-indicator: Buffering` from a real stall included, which is the
  // correct verdict: this window is supposed to be a clip that plays straight
  // through.
  expect(duringPlayback).toEqual([]);

  // A real state transition, on the other hand, announces exactly once. The
  // example's declared `<track default>` selects English on load, so the
  // first click turns captions OFF, not on.
  //
  // The buffer is cleared first — the observer stays installed, so the
  // assertion below is still "exactly one announcement, and it is this one",
  // but measured over the captions click alone rather than over the whole
  // test. The assertion above already proved the buffer empty, so the clear is
  // belt-and-braces: it stops this assertion from depending on that one having
  // held.
  await page.evaluate(() => {
    window.__playdeckAnnouncements = [];
  });
  await captionsButton(page).click();
  await expect(captionsButton(page)).toHaveAttribute('data-state', 'off');

  await expect
    .poll(() => page.evaluate(() => window.__playdeckAnnouncements))
    .toEqual(['captions-announcer: Captions off']);
});
