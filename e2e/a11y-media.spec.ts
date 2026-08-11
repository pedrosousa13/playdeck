import { expect, test, type Page } from '@playwright/test';
import {
  activationButton,
  captionsButton,
  controls,
  media,
  muteButton,
  seekSliderInput
} from './locators';

declare global {
  interface Window {
    __reelyAnnouncements: string[];
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
  // GitHub-hosted one) started landing `installedAt` at 0.46-0.54s — past the
  // old boundary — on real activation/decode + `page.evaluate` round-trip
  // latency alone, well before any real work in the window below even starts.
  // The guard's entire point is proving the observer is live strictly before
  // the fixture's real cue transition, so the fix moves the transition itself
  // (fixture + this constant, kept equal on purpose, see above) rather than
  // just loosening the `toBeLessThan` check — decoupling the two would let the
  // guard pass while the observer still missed the transition, silently
  // reopening the exact gap this test exists to close. 0.7s clears the
  // observed 0.46-0.54s range with comfortable headroom while still leaving a
  // real 0.3s cue-two window inside the ~1s clip.
  const cueBoundary = 0.7;

  await page.goto(realSources);
  await activationButton(page).click();
  await played(page);
  // The window starts here (after `played()`, i.e. after `currentTime > 0`)
  // rather than before the click, because asserting on `LoadingIndicator`'s
  // `'loading-provider'` → idle transition would race real activation/decode
  // latency instead of the policy this test exists to check. That transition is
  // a real, legitimate announcement (a meaningful state change, not a time or
  // cue violation). Since #35 gave the indicator a 500ms minimum-visible floor
  // it can land just inside this window rather than before it, so it is
  // excluded by exact value at the assertion below rather than by position.

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
    window.__reelyAnnouncements = [];
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
          window.__reelyAnnouncements.push(
            `${ancestor.getAttribute('data-reely-part')}: ${ancestor.textContent ?? ''}`
          );
        }
        for (const added of record.addedNodes) {
          for (const region of regionsWithin(added)) {
            window.__reelyAnnouncements.push(
              `${region.getAttribute('data-reely-part')}: ${region.textContent ?? ''}`
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

  // Guard against a real race: the cue boundary above falls at 0.7s, and
  // nothing forces the observer to be live before then. Real
  // activation-to-first-frame latency (no mock: real decode) can push
  // installation past that boundary on a slow engine — this plan's own
  // constraints flag WebKit as the historically slow one here, and the
  // self-hosted runner as a slower host generally — and if it does, the cue
  // transition already happened unobserved, "no announcements" would pass for
  // having nothing left to see rather than the policy holding, and this test
  // would silently degrade back into exactly the structurally-unobservable
  // gap the dense fixture was added to close. Reading `currentTime`
  // immediately after installing (rather than, say, seeking back to 0 first)
  // avoids introducing a real seek's own async settling time and its
  // knock-on `TextTrack`/`LoadingIndicator` side effects into the very window
  // being measured; asserting on it fails loudly instead of degrading.
  const installedAt = await media(page).evaluate(
    (el: HTMLVideoElement) => el.currentTime
  );
  expect(installedAt).toBeLessThan(cueBoundary);

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
          (el: HTMLVideoElement) => el.ended || el.currentTime > 0.9
        ),
      { timeout: 15_000 }
    )
    .toBe(true);

  const duringPlayback = await page.evaluate(() => window.__reelyAnnouncements);

  // `LoadingIndicator`'s `'loading-provider'` → idle transition is the one
  // legitimate announcement that can land in this window. It used to complete
  // before `played()` returned; since #35 gave the indicator a 500ms
  // minimum-visible floor, it can complete just after, inside the window.
  //
  // It is excluded by EXACT value rather than by part name, and bounded to one
  // occurrence, so the exclusion stays as narrow as the thing it excuses: the
  // empty string is the region emptying as it goes idle. A spurious
  // `loading-indicator: Buffering`, a flapping indicator announcing idle twice,
  // and every time-update or cue leak all still fail here.
  //
  // The window is NOT moved later to dodge this. Its start point is
  // load-bearing: the `installedAt < cueBoundary` guard above proves the 0.7s
  // cue transition is still ahead of the observer, and waiting out the floor
  // first would advance `currentTime` past that boundary and silently drop the
  // cue coverage this test exists to hold.
  const idleTransition = 'loading-indicator: ';
  expect(duringPlayback.filter((entry) => entry !== idleTransition)).toEqual(
    []
  );
  expect(
    duringPlayback.filter((entry) => entry === idleTransition).length
  ).toBeLessThanOrEqual(1);

  // A real state transition, on the other hand, announces exactly once. The
  // example's declared `<track default>` selects English on load, so the
  // first click turns captions OFF, not on.
  //
  // The buffer is cleared first — the observer stays installed, so the
  // assertion below is still "exactly one announcement, and it is this one",
  // but measured over the captions click alone rather than over the whole test.
  // Without this it would also have to carry the idle transition excused above.
  await page.evaluate(() => {
    window.__reelyAnnouncements = [];
  });
  await captionsButton(page).click();
  await expect(captionsButton(page)).toHaveAttribute('data-state', 'off');

  await expect
    .poll(() => page.evaluate(() => window.__reelyAnnouncements))
    .toEqual(['captions-announcer: Captions off']);
});
