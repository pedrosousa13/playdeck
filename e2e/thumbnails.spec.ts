import { expect, test, type Locator, type Page } from '@playwright/test';

/**
 * #658: `SeekSlider`'s `thumbnails` prop, driven end-to-end on the native
 * provider -- hover and keyboard both, per the issue's acceptance criterion.
 *
 * Fixtures: `apps/storybook/stories/seek-slider.stories.tsx`'s `WithThumbnails`
 * and `ThumbnailFollowsKeyboardFocus`, both mounted through the `ready()`
 * mock helper with `provider: 'native'` (`apps/storybook/stories/support.tsx`)
 * -- the same "native" the `data-provider` attribute reports elsewhere in this
 * suite (`e2e/audio-tracks.spec.ts`'s "renders nothing on a native MP4
 * source"). `thumbnails.vtt` and `thumbnails-sprite.svg`
 * (`apps/storybook/public/`) divide a 10s window into five 2s cues, one per
 * tile of a 160x90 sprite strip, each tile a single flat, maximally distinct
 * colour rather than a photographic frame -- chosen (see the sprite's own
 * comment) specifically so a sampled pixel can tell tiles apart. That is what
 * every assertion below reads, in preference to the offset the code itself
 * wrote (`sampleTileColor`): the cue mapping is fixed in `thumbnails.vtt`'s own
 * `NOTE`.
 *
 *   0:00-0:02 tile 0 #ff0000 (red)     0:04-0:06 tile 2 #0000ff (blue)
 *   0:02-0:04 tile 1 #00ff00 (green)   0:06-0:08 tile 3 #ffff00 (yellow)
 *                                      0:08-0:10 tile 4 #ff00ff (magenta)
 *
 * Device pixel ratio: `sampleTileColor` never converts a CSS-pixel coordinate
 * into a device-pixel one. It screenshots the `thumbnail` part (which is
 * `overflow: hidden` and sized exactly to the cue's region, so the screenshot
 * IS the visible crop) and reads the pixel at the decoded PNG's own centre --
 * `naturalWidth / 2`, `naturalHeight / 2` -- which is the centre of a solid
 * 160x90 fill regardless of how many device pixels the PNG holds. Desktop
 * Safari renders that PNG at 2x and the other two projects at 1x
 * (`playwright.config.ts`'s `webkit` project uses `devices['Desktop Safari']`),
 * and neither changes which fill colour sits at the middle of the image. The
 * clamp assertions below read `boundingBox()`, which Playwright already
 * reports in CSS pixels on every engine, so DPR does not enter there either.
 *
 * Both fixture stories carry their own Storybook `play()` (hover, then
 * keyboard-focus -- the same mechanism this file drives), which Storybook
 * runs the moment `iframe.html` renders the story, independent of this spec.
 * Instrumented directly: `goto()` resolves before the story has even
 * mounted (cold story compile), the `thumbnail` part then mounts, and the
 * story's own `play()` finishes roughly 30-40ms after that -- a window a
 * naive `goto()` then immediate `hover()`/`focus()` can land inside, racing
 * real pointer/keyboard events against this spec's own. `gotoStoryReady`
 * below waits for Storybook's `storyFinished` channel event (the same signal
 * Storybook's own official test runner waits on to know a story, `play()`
 * included, has settled) before this spec ever touches the page, rather than
 * trusting that the race resolves in this spec's favour.
 */

const withThumbnailsStory =
  '/iframe.html?id=player-seekslider--with-thumbnails&viewMode=story';
const keyboardFocusStory =
  '/iframe.html?id=player-seekslider--thumbnail-follows-keyboard-focus&viewMode=story';

const gotoStoryReady = async (page: Page, story: string): Promise<void> => {
  await page.addInitScript(() => {
    (
      window as typeof window & { __storyFinished?: Promise<void> }
    ).__storyFinished = new Promise((resolve) => {
      const attach = (): void => {
        const channel = (
          window as typeof window & {
            __STORYBOOK_ADDONS_CHANNEL__?: {
              on: (event: string, listener: () => void) => void;
            };
          }
        ).__STORYBOOK_ADDONS_CHANNEL__;
        if (!channel) {
          requestAnimationFrame(attach);
          return;
        }
        channel.on('storyFinished', () => resolve());
      };
      attach();
    });
  });
  await page.goto(story);
  await page.evaluate(
    () =>
      (window as typeof window & { __storyFinished?: Promise<void> })
        .__storyFinished
  );
};

const track = (page: Page): Locator =>
  page.locator('[data-playdeck-part="seek-slider"]');
const thumbnail = (page: Page): Locator =>
  page.locator('[data-playdeck-part="thumbnail"]');

// The colour at the decoded PNG's own centre -- see the file header for why
// this needs no device-pixel-ratio conversion. Waits for the `<img>` to
// finish decoding first: the sprite is a same-origin local SVG and decodes
// well inside a normal expect timeout, but a screenshot taken before
// `complete` would read whatever the box painted before the image arrived.
const sampleTileColor = async (
  page: Page
): Promise<{ r: number; g: number; b: number }> => {
  const img = thumbnail(page).locator('img');
  await expect
    .poll(() => img.evaluate((el: HTMLImageElement) => el.complete))
    .toBe(true);
  const shot = await thumbnail(page).screenshot();
  const decoder = await page.context().newPage();
  await decoder.goto('about:blank');
  const color = await decoder.evaluate(
    async (source) => {
      const image = new Image();
      await new Promise((resolve, reject) => {
        image.addEventListener('load', resolve);
        image.addEventListener('error', reject);
        image.src = source;
      });
      const canvas = document.createElement('canvas');
      canvas.width = image.naturalWidth;
      canvas.height = image.naturalHeight;
      const context = canvas.getContext('2d')!;
      context.drawImage(image, 0, 0);
      const { data } = context.getImageData(
        Math.floor(canvas.width / 2),
        Math.floor(canvas.height / 2),
        1,
        1
      );
      return { r: data[0], g: data[1], b: data[2] };
    },
    `data:image/png;base64,${shot.toString('base64')}`
  );
  await decoder.close();
  return color;
};

const GREEN = { r: 0, g: 255, b: 0 };
const YELLOW = { r: 255, g: 255, b: 0 };
const MAGENTA = { r: 255, g: 0, b: 255 };

// Moves the real pointer to a fraction of the track's own width -- `0` is
// its left edge, `1` its right -- the same fraction `trackPointer`
// (thumbnails.ts) turns into a previewed time.
const hoverFraction = async (page: Page, fraction: number): Promise<void> => {
  const box = (await track(page).boundingBox())!;
  await page.mouse.move(box.x + box.width * fraction, box.y + box.height / 2);
};

// Demonstrated red (docs/agents/demonstrated-red.md), two mutations, each run
// in isolation (chromium) against this one test:
//
// 1. Region cropping: packages/react/src/transport-controls.tsx's `<img>`
//    style, changed from `{ left: -thumbnailImage.region.x, top:
//    -thumbnailImage.region.y }` to an unconditional `{ left: 0, top: 0 }`
//    (ignoring the cue's region regardless of pointer position) --
//
//      Error: expect(received).toEqual(expected) // deep equality
//      - Expected  - { "b": 0, "g": 255, "r": 0 }   (GREEN, the first hover)
//      + Received  + { "b": 0, "g": 0, "r": 255 }   (RED -- tile 0's colour)
//      1 failed › e2e/thumbnails.spec.ts › hovering the track previews the cue
//      tile under the pointer, and the preview changes as the pointer moves
//
//    (the first hover already reads tile 0's colour -- the crop was pinned
//    to the sprite's `0,0` corner regardless of the cue's own region.)
//    Reverted, and it passed again.
//
// 2. Pointer tracking: thumbnails.ts's `trackPointer`, `setPointerFraction`'s
//    computed fraction replaced with the constant `0.3` (every pointer
//    position reads as 30% across the track, tile 1) --
//
//      Error: expect(received).toEqual(expected) // deep equality
//      - Expected  - { "b": 0, "g": 255, "r": 255 }   (YELLOW, the second hover)
//      + Received  + { "b": 0, "g": 255, "r": 0 }     (GREEN -- the first hover's tile)
//      1 failed › e2e/thumbnails.spec.ts › hovering the track previews the cue
//      tile under the pointer, and the preview changes as the pointer moves
//
//    (both hovers read tile 1, green -- the second hover, at 70%, never left
//    it.) Reverted, and it passed again.
test('hovering the track previews the cue tile under the pointer, and the preview changes as the pointer moves', async ({
  page
}) => {
  await gotoStoryReady(page, withThumbnailsStory);

  // 30% of a 10s window: 3s, inside `thumbnails.vtt`'s 2-4s cue (tile 1,
  // green). Interior rather than at a cue boundary, so the fraction is
  // unambiguously inside one cue's span.
  await hoverFraction(page, 0.3);
  await expect(thumbnail(page)).toHaveAttribute('data-state', 'visible');
  await expect.poll(() => sampleTileColor(page)).toEqual(GREEN);

  // 70%: 7s, inside the 6-8s cue (tile 3, yellow) -- a different tile from
  // the first hover, so this and the read above together are the assertion
  // that the preview moves with the pointer and not only that hovering shows
  // something.
  await hoverFraction(page, 0.7);
  await expect.poll(() => sampleTileColor(page)).toEqual(YELLOW);
});

// Demonstrated red, substitute mutation (chromium): thumbnails.ts's
// `useThumbnailPreview`, the `previewedTime` ternary's `inputFocused ? value
// : null` branch changed to an unconditional `null` (keyboard focus never
// previews, only a pointer does) --
//
//   Error: expect(locator).toHaveAttribute(expected) failed
//   Locator:  locator('[data-playdeck-part="thumbnail"]')
//   Expected: "visible"
//   Received: "hidden"
//   Timeout:  5000ms
//   1 failed › e2e/thumbnails.spec.ts › focusing the input by keyboard
//   previews the tile at its own value, and End moves it
//
// Reverted, and it passed again.
test('focusing the input by keyboard previews the tile at its own value, and End moves it', async ({
  page
}) => {
  // currentTime: 3 -- the 2-4s cue, tile 1, green.
  await gotoStoryReady(page, keyboardFocusStory);
  const slider = page.getByRole('slider', { name: 'Seek', exact: true });

  // `blur()` before `focus()`: this story's own `play()` ends by simulating
  // blur with `fireEvent.focusOut` (seek-slider.stories.tsx), a synthetic
  // dispatch that tells React the input lost focus without ever calling the
  // real DOM `.blur()` -- so the browser's actual `document.activeElement`
  // is still this input when `gotoStoryReady` returns. `.focus()` on an
  // element that is already really focused is a browser no-op that fires no
  // event at all, which a bare `await slider.focus()` here silently rode on
  // (confirmed directly: `document.activeElement` was already this input
  // and no `focus`/`focusin` event, and no `onFocus` call, followed).
  // `.blur()` first forces a real transition, so `.focus()` genuinely fires.
  await slider.blur();
  await slider.focus();
  await expect(slider).toBeFocused();
  await expect(thumbnail(page)).toHaveAttribute('data-state', 'visible');
  await expect.poll(() => sampleTileColor(page)).toEqual(GREEN);

  // `End` moves the native range input straight to its `max`, exactly 10 --
  // and `thumbnailCueAt` (packages/core/src/thumbnails.ts) matches cues
  // half-open (`time >= cue.startTime && time < cue.endTime`), so a time of
  // exactly 10 falls outside every cue in `thumbnails.vtt`, `10-10 <` failing
  // for the 8-10s one same as any other, and the part goes `hidden` rather
  // than showing tile 4 -- confirmed directly (`End` alone: `data-state`
  // reads `hidden`, not a wrong tile). That is a fact about the cue format's
  // own half-open convention, not the seek/clamp behaviour this file is for,
  // so one native `ArrowLeft` (the grid step this window derives, 0.5s) backs
  // off the exact boundary to 9.5s, still inside the 8-10s cue.
  //
  // `End` then `ArrowLeft`, landing on tile 4 (magenta) -- a colour distinct
  // from the green just read. That is what makes this discriminating rather
  // than vacuous, the exposure #657's own keyboard e2e had with no such
  // guaranteed-different last row (docs/agents/demonstrated-red.md's account,
  // and this file's own header): a mutation that made keyboard movement a
  // no-op would still read green here, the same state the focus step above
  // already produced -- so the assertion could not tell "the keys moved it"
  // from "it was already there" unless the two reads are known to differ
  // before they are pressed, which the tile-1 read just above is.
  await page.keyboard.press('End');
  await page.keyboard.press('ArrowLeft');
  await expect.poll(() => sampleTileColor(page)).toEqual(MAGENTA);
});

// Demonstrated red (docs/agents/demonstrated-red.md), natural revert
// (chromium and firefox): `thumbnailLeftStyle` in thumbnails.ts reverted to
// its pre-#658-clamp body --
//
//   export const thumbnailLeftStyle = (previewedTime, min, span) => {
//     if (previewedTime === null) return '0%';
//     return `${((previewedTime - min) / span) * 100}%`;
//   };
//
// (the exact function this repo's own `471f7b5` replaced -- see that
// commit's PR body for the same figures re-measured here) --
//
//   Error: left overflow past the slider
//   expect(received).toBeGreaterThanOrEqual(expected)
//   Expected: >= 39.5
//   Received:    -40
//   1 failed [chromium] › the clamp keeps the thumbnail fully inside the
//   slider at both pointer extremes
//   1 failed [firefox]  › the clamp keeps the thumbnail fully inside the
//   slider at both pointer extremes
//
// (`trackBox.x` was 40, `thumbBox.x` -40 on both engines -- 80px of left
// overflow at time 0, the same figure 471f7b5's own PR body records. The
// left check throws first and aborts the test before the right-edge (0.99)
// hover ever runs, so the right-edge assertion was verified separately
// (chromium): the two hovers' order swapped so it ran and failed on its own
// -- `Expected: <= 472.5, Received: 547.671875`, 75.17px of right overflow.
// Order restored, mutation reverted, both projects passed again.)
test('the clamp keeps the thumbnail fully inside the slider at both pointer extremes', async ({
  page
}) => {
  await gotoStoryReady(page, withThumbnailsStory);

  const withinTrack = async (): Promise<void> => {
    const trackBox = (await track(page).boundingBox())!;
    const thumbBox = (await thumbnail(page).boundingBox())!;
    // Half a pixel of slack for sub-pixel layout rounding -- clamp()'s own
    // arithmetic is exact, but a boundingBox() reads whatever the layout
    // engine rounded to.
    expect(thumbBox.x, 'left overflow past the slider').toBeGreaterThanOrEqual(
      trackBox.x - 0.5
    );
    expect(
      thumbBox.x + thumbBox.width,
      'right overflow past the slider'
    ).toBeLessThanOrEqual(trackBox.x + trackBox.width + 0.5);
  };

  await hoverFraction(page, 0);
  await expect(thumbnail(page)).toHaveAttribute('data-state', 'visible');
  await withinTrack();

  // 0.99, not 1: `thumbnailCueAt` matches half-open (see the keyboard test
  // below), so a pointer fraction of exactly 1 previews exactly `duration`,
  // which no cue in `thumbnails.vtt` covers -- the part goes `hidden`, its
  // box collapses to zero width, and a zero-width box is trivially "inside"
  // the track whether or not the clamp exists. 0.99 (9.9s) stays inside the
  // 8-10s cue, so the box is the real, region-sized one the clamp has to
  // keep in bounds.
  await hoverFraction(page, 0.99);
  await expect(thumbnail(page)).toHaveAttribute('data-state', 'visible');
  await withinTrack();
});

// Demonstrated red: the same natural revert as the pointer test above, run
// against this test (chromium and firefox) --
//
//   Error: left overflow past the slider
//   expect(received).toBeGreaterThanOrEqual(expected)
//   Expected: >= 39.5
//   Received:    -40
//   1 failed [chromium] › the clamp keeps the thumbnail fully inside the
//   slider at both keyboard Home/End extremes
//   1 failed [firefox]  › the clamp keeps the thumbnail fully inside the
//   slider at both keyboard Home/End extremes
//
// (the same -40/40 pair as the pointer test -- `Home` previews exactly `0`,
// same as the pointer test's own left extreme, so the same overflow. Same
// early-abort caveat as the pointer test: verified the `End`+`ArrowLeft`
// right edge separately too, with the two keyboard sequences' order swapped
// so it ran and failed on its own, on both engines -- `Expected: <= 472.5,
// Received: 530.390625` (chromium) and `530.4000244140625` (firefox), ~58px
// of right overflow. Order restored, mutation reverted, both projects passed
// again.)
//
// Kept as a separate test and a separate demonstrated-red run from the
// pointer one above because
// `thumbnailLeftStyle` resolves the same clamp for both paths from the same
// `previewedTime` -- the fix, and the earlier defect, apply to pointer and
// keyboard identically (471f7b5's own PR body: "0.00px on both. both the
// pointer path and the keyboard-focus path"), and this is what checks that
// claim on the path the pointer test does not drive.
test('the clamp keeps the thumbnail fully inside the slider at both keyboard Home/End extremes', async ({
  page
}) => {
  await gotoStoryReady(page, keyboardFocusStory);
  const slider = page.getByRole('slider', { name: 'Seek', exact: true });

  const withinTrack = async (): Promise<void> => {
    const trackBox = (await track(page).boundingBox())!;
    const thumbBox = (await thumbnail(page).boundingBox())!;
    expect(thumbBox.x, 'left overflow past the slider').toBeGreaterThanOrEqual(
      trackBox.x - 0.5
    );
    expect(
      thumbBox.x + thumbBox.width,
      'right overflow past the slider'
    ).toBeLessThanOrEqual(trackBox.x + trackBox.width + 0.5);
  };

  // See the previous test's comment: the story's own `play()` leaves the
  // input really DOM-focused despite reporting itself blurred, so `.focus()`
  // alone is a no-op here.
  await slider.blur();
  await slider.focus();
  await page.keyboard.press('Home');
  // `visible`, not merely present: the vacuous case this guards against is
  // the same one the pointer test's own comment names -- previewing exactly
  // `duration` finds no cue, `hidden`, and a collapsed zero-size box that
  // would pass `withinTrack` below for free. `Home` previews exactly `0`,
  // which the 0-2s cue does cover, so `visible` here is a real, region-sized
  // box. (Pixel colour is not read in this test: at the pre-clamp position a
  // `thumbnail` part sitting off the browser's own rendered canvas -- exactly
  // the defect this test exists to catch -- makes a screenshot-based sample
  // read whatever the page background behind it is rather than throw or read
  // wrong-but-plausibly-a-tile, which would make a colour assertion here
  // fail for a reason unrelated to what this test is about. The tile-colour
  // assertions above already cover that this part shows the right cue.)
  await expect(thumbnail(page)).toHaveAttribute('data-state', 'visible');
  await withinTrack();

  // `End` then one `ArrowLeft` -- see the previous test's comment on why
  // exactly `duration` (what `End` alone reaches) has no cue at all and
  // would collapse the box rather than exercise the clamp.
  await page.keyboard.press('End');
  await page.keyboard.press('ArrowLeft');
  await expect(thumbnail(page)).toHaveAttribute('data-state', 'visible');
  await withinTrack();
});
