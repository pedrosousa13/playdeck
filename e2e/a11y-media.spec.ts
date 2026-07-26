import { expect, test, type Page } from '@playwright/test';
import {
  activationButton,
  captionsButton,
  controls,
  media,
  muteButton
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

test('live regions announce state transitions only, never time updates or cues', async ({
  page
}) => {
  await page.goto(realSources);
  await activationButton(page).click();
  await played(page);

  // Observe every live region in the tree, not a named one: a regression that
  // adds aria-live to the time display or the caption cue container has to be
  // caught here as well as structurally (the story-level inventory check only
  // proves shape, not that a live region stays silent during playback).
  await page.evaluate(() => {
    window.__reelyAnnouncements = [];
    const observer = new MutationObserver((records) => {
      for (const record of records) {
        const node = (
          record.target.nodeType === Node.TEXT_NODE
            ? record.target.parentElement
            : (record.target as Element)
        )?.closest('[aria-live], [role="status"], [role="alert"]');
        if (!node) continue;
        window.__reelyAnnouncements.push(
          `${node.getAttribute('data-reely-part')}: ${node.textContent ?? ''}`
        );
      }
    });
    for (const region of document.querySelectorAll(
      '[aria-live], [role="status"], [role="alert"]'
    )) {
      observer.observe(region, {
        characterData: true,
        childList: true,
        subtree: true
      });
    }
  });

  // Play through the whole ~1s clip. `captions-en.vtt`'s first cue spans
  // 0-5s, so it is active and rendering for the entire clip — measured: the
  // fixture (`apps/storybook/public/tracer.mp4`) is exactly 1.0s. Time
  // updates fire repeatedly over this window too; neither the ongoing cue
  // nor a time tick may reach a live region.
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
  expect(duringPlayback).toEqual([]);

  // A real state transition, on the other hand, announces exactly once. The
  // example's declared `<track default>` selects English on load, so the
  // first click turns captions OFF, not on.
  await captionsButton(page).click();
  await expect(captionsButton(page)).toHaveAttribute('data-state', 'off');

  await expect
    .poll(() => page.evaluate(() => window.__reelyAnnouncements))
    .toEqual(['captions-announcer: Captions off']);
});
