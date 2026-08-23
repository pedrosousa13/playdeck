import { expect, test, type Page } from '@playwright/test';
import {
  contrast,
  fromChannels,
  type Rgba
} from '../packages/react/test/contrast';

/**
 * WCAG 2.2 AA 1.4.11 on the slider thumb, measured from rendered pixels (#190).
 *
 * `packages/react/test/theme.test.ts` already composites the theme's token
 * defaults and asserts the same 3:1 floor. This file exists because that
 * arithmetic describes a slider no engine paints: both sliders are native range
 * inputs, every engine paints its own track and thumb underneath (or through)
 * whatever the theme says, and the ring's whole job is to survive that. A rule
 * that is a no-op on the target engine is the failure mode #190 is about, and
 * only a screenshot can tell.
 *
 * The maths is imported from the unit test's module rather than restated, so
 * the two numbers are comparable by construction.
 *
 * Both stories are mounted through the toolbar's Theme global, which is the one
 * mechanism that mounts `theme.css` (`apps/storybook/.storybook/theme.tsx`).
 *
 * The `forced colors` block at the foot of the file measures the same two
 * sliders again with the system palette in force, because #190's Gecko half
 * works by switching that engine's native widget off — and a native widget is
 * where forced-colors rendering came from for free.
 */

const themedStory = (id: string): string =>
  `/iframe.html?id=${id}&viewMode=story&globals=theme:themed`;

type Row = {
  /** The element's inline size in CSS pixels, as laid out. */
  widthPx: number;
  /** Colour at a fraction of the element's inline size, 0..1. */
  at: (fraction: number) => Rgba;
  /** The darkest colour in a window of ±`radius` CSS px around `centre`. */
  darkestAround: (centre: number, radius: number) => Rgba;
};

/**
 * The horizontal centre line of an element, as painted.
 *
 * Screenshots come back as PNG bytes, which node cannot read without a decoder
 * dependency, so a blank second page decodes them through a canvas. It is a
 * separate page on purpose: drawing into the page under test would change the
 * DOM the next measurement samples.
 *
 * `animations: 'disabled'` because Playwright then finishes any running CSS
 * animation before capturing, rather than catching the theme's opacity
 * transition part-way and measuring a colour nothing ever settles on.
 */
const centreRow = async (page: Page, selector: string): Promise<Row> => {
  const locator = page.locator(selector);
  await expect(locator).toBeVisible();
  const box = (await locator.boundingBox())!;
  const clip = {
    x: Math.round(box.x),
    y: Math.round(box.y),
    width: Math.round(box.width),
    height: Math.round(box.height)
  };
  const shot = await page.screenshot({ animations: 'disabled', clip });

  const decoder = await page.context().newPage();
  await decoder.goto('about:blank');
  const image = await decoder.evaluate(
    async (source) => {
      const element = new Image();
      await new Promise((resolve, reject) => {
        element.addEventListener('load', resolve);
        element.addEventListener('error', reject);
        element.src = source;
      });
      const canvas = document.createElement('canvas');
      canvas.width = element.naturalWidth;
      canvas.height = element.naturalHeight;
      const context = canvas.getContext('2d')!;
      context.drawImage(element, 0, 0);
      const row = Math.round(canvas.height / 2);
      const { data } = context.getImageData(0, row, canvas.width, 1);
      return { width: canvas.width, channels: [...data] };
    },
    `data:image/png;base64,${shot.toString('base64')}`
  );
  await decoder.close();

  // Device pixels per CSS pixel: `Desktop Safari` runs at 2, the other two at 1.
  const scale = image.width / clip.width;
  const pixel = (x: number): Rgba => {
    const index = Math.min(Math.max(Math.round(x), 0), image.width - 1) * 4;
    return fromChannels(
      image.channels[index],
      image.channels[index + 1],
      image.channels[index + 2]
    );
  };
  return {
    widthPx: clip.width,
    at: (fraction) => pixel(fraction * image.width),
    darkestAround: (centre, radius) => {
      let darkest = pixel(centre * scale);
      for (let x = -radius; x <= radius; x++) {
        const candidate = pixel((centre + x) * scale);
        const sum = (color: Rgba) => color.red + color.green + color.blue;
        if (sum(candidate) < sum(darkest)) darkest = candidate;
      }
      return darkest;
    }
  };
};

/**
 * Measured ratios as one line, for the message of the assertion that reads them.
 *
 * The house style in this file is to state numbers a reviewer can check rather
 * than only booleans, and the two tests below no longer pin every boundary to a
 * literal — so the figures have to travel with the failure instead of being
 * inferable from which key of a diff went red.
 */
const state = (ratios: Record<string, number>): string =>
  Object.entries(ratios)
    .map(([boundary, ratio]) => `${boundary} ${ratio.toFixed(2)}:1`)
    .join(', ');

/**
 * The volume slider at exactly half, which is why this story and not another:
 * at 50% a range input's thumb centre lands on the track's centre on every
 * engine, whatever thumb width that engine chose. So the thumb is found by
 * construction rather than by guessing at engine metrics.
 *
 * It is also the slider the theme does not cover with anything: `VolumeSlider`
 * renders the input alone, so what a screenshot shows beside the thumb is the
 * slider itself. The seek slider is the opposite case, below.
 */
const volumeRow = async (page: Page): Promise<Row> => {
  await page.goto(themedStory('player-volumeslider--half-volume'));
  return centreRow(page, '[data-playdeck-part="volume-slider"]');
};

test('the thumb ring is painted on every engine, not just declared', async ({
  page
}) => {
  const row = await volumeRow(page);
  // The darkest thing inside the thumb has to be the ring, and the ring is
  // `--playdeck-color-thumb-ring`, `#000`. This is the assertion that fails when
  // a rule reaches the wrong engine: before #190's Gecko half, the darkest pixel
  // in this window was Firefox's own grey thumb, `rgb(103 103 116)`, because
  // `outline` on `::-moz-range-thumb` paints nothing at all.
  const ring = row.darkestAround(0.5 * row.widthPx, 12);
  expect({
    red: Math.round(ring.red * 255),
    green: Math.round(ring.green * 255),
    blue: Math.round(ring.blue * 255)
  }).toEqual({ red: 0, green: 0, blue: 0 });
});

test('the volume thumb ring clears 3:1 against the surfaces beside it', async ({
  page,
  browserName
}) => {
  const row = await volumeRow(page);
  const ring = row.darkestAround(0.5 * row.widthPx, 12);
  // Left of the thumb is the filled part of the track, right of it the unfilled
  // part. Sampled well clear of the thumb, which spans roughly 0.37..0.63.
  const ratios = {
    'ring vs fill': contrast(ring, row.at(0.22)),
    'ring vs unfilled track': contrast(ring, row.at(0.85))
  };
  const measured = state(ratios);

  // Asserted per OWNER rather than per engine, because only the pixels this
  // theme paints are this repo's to hold to a floor. Both measurements travel
  // with either assertion, in `measured`.
  //
  // The fill is the theme's everywhere: `accent-color` on Blink and WebKit, the
  // hand-drawn `::-moz-range-progress` on Gecko. It clears on all three —
  // measured 8.10:1, the same figure the token arithmetic gives.
  //
  // The unfilled track is the theme's on Gecko ONLY. #190's Gecko half has to
  // draw the whole control there (native theming is all-or-nothing), so the
  // theme paints `--playdeck-color-track` and the ring measures 3.55:1 against
  // it. That pixel is ours, so its floor is asserted.
  //
  // Blink and WebKit keep their own unfilled track, which the theme never
  // colours for this slider, so that ratio is stated here and not pinned. It was
  // pinned, as `browserName === 'firefox'`, and the same literal one test down
  // is what failed on CI: how light a native track renders is a property of the
  // engine build and the runner, not of this repo, and the WebKit that paints it
  // near the story's own ground locally (1.07:1) painted it light enough on
  // GitHub's runner to clear 3:1. Blink measured 1.87:1 over `rgb(59 59 59)`
  // here. Neither figure is a regression from #414 and neither was ever passing;
  // closing them for real means drawing the control by hand on all three
  // engines, which is a decision #190 explicitly did not take.
  expect(ratios['ring vs fill'], measured).toBeGreaterThanOrEqual(3);
  if (browserName === 'firefox')
    expect(ratios['ring vs unfilled track'], measured).toBeGreaterThanOrEqual(
      3
    );
});

test('the seek thumb ring is veiled by the theme bar painted over it', async ({
  page
}) => {
  await page.goto(themedStory('player-seekslider--with-buffered-ranges'));
  const row = await centreRow(page, '[data-playdeck-part="seek-slider-input"]');
  // Value 30 of 100, buffered 0..45 and 60..80. A range thumb's centre sits at
  // `half + fraction * (width - thumb)`, over a thumb 16-18px wide. Blink and
  // WebKit pick that width themselves; on Gecko it is no longer the engine's,
  // it is this theme's — `--playdeck-slider-thickness * 4`, 16px (#190). The
  // three agree closely enough that on this story's 432px input 30% lands at
  // 133 ± 0.3 on all of them.
  const ring = row.darkestAround(8.5 + 0.3 * (row.widthPx - 17), 12);
  const ratios = {
    'ring vs unfilled track': contrast(ring, row.at(0.55)),
    'ring vs loaded range': contrast(ring, row.at(0.7))
  };

  // Recorded as failing rather than left unmeasured, because it is the part of
  // #190 that no ring colour can fix and the arithmetic in `theme.test.ts` says
  // the opposite.
  //
  // `SeekSlider` renders `seek-buffered` before the input, and this theme makes
  // it `position: absolute` while leaving the input in flow. A positioned
  // element paints after an in-flow one, so the theme's own translucent bar
  // paints OVER the native control on Blink and Gecko: white at 0.36 alpha, and
  // a second white at 0.7 wherever a range is loaded. That lifts every pixel of
  // the thumb, ring included, towards white before anyone sees it. A `#000` ring
  // reaches the screen as `rgb(92 92 92)` under one veil and `rgb(206 206 206)`
  // under two, against a track lifted the same way — measured 2.48:1 and 1.11:1
  // on Blink, 1.75:1 and 1.20:1 on Gecko. No ring colour escapes: the veil puts
  // a floor under how dark the ring can land and a ceiling under how light, and
  // 3:1 sits outside both.
  //
  // WebKit misses the same two boundaries for the opposite reason: there the bar
  // does not reach the screen at all (#191, #192), so the ring is a true `#000`
  // and what sits beside it is WebKit's OWN unfilled track, which the theme
  // never colours.
  //
  // Which is why the two boundaries are no longer pinned to a boolean each. They
  // were, and it cost a CI failure: how light that native WebKit track renders
  // is a property of the engine build and the runner, not of this repo — near
  // the story's own ground locally, where the ring measured 1.07:1 against it,
  // and light enough on GitHub's runner for the same ring on the same commit to
  // clear 3:1. Same engine, opposite booleans. Keying the table by `browserName`
  // does not fix that; it only moves the flake to the next runner or the next
  // WebKit release. So what is asserted is the one thing that is a property of
  // OUR code on every engine — the seek slider does not clear 3:1 on BOTH sides
  // of its thumb, i.e. it is not 1.4.11-compliant — while the two ratios that
  // got it there are stated in the message rather than frozen.
  //
  // Clearing this needs `appearance: none` and a hand-drawn control on all three
  // engines, which #190 named and did not take. The `seek-buffered` overlay that
  // puts the veil there is now owned by #415, and this assertion is what has to
  // go red the day #415 makes the slider compliant.
  expect(
    Object.values(ratios).every((ratio) => ratio >= 3),
    `the seek slider clears 3:1 on both sides of its thumb, which #415 owns and this test exists to catch: ${state(ratios)}`
  ).toBe(false);
});

/**
 * The same two sliders with the user's palette in force (#190 follow-up).
 *
 * This block exists because #190's Gecko half is not additive. It works by
 * switching Gecko's native range widget off for the whole control, and forced
 * colors is precisely the mode where that widget was doing something no author
 * rule replaced: repainting itself in the user's own palette. Nothing in
 * `theme.css`'s `forced-colors: active` block maps a range part, so with the
 * `::-moz-*` rules unguarded the whole Gecko control flattened to `Canvas` —
 * measured on the volume slider, which is the one of the two this is visible on,
 * before the `(forced-colors: none)` query went on those rules. The seek slider
 * cannot show it either way, for the reason the second test below records.
 *
 * Chromium and Firefox only. WebKit matches `(forced-colors: active)` under
 * Playwright's emulation but does not substitute the palette with it: measured
 * here, `--playdeck-color-accent` still reaches the screen as `rgb(62 166 255)`
 * and the story's ground stays `rgb(11 14 19)`. A pixel assertion there would be
 * measuring ordinary rendering under a forced-colors label. `e2e/theme.spec.ts`
 * keeps WebKit for its computed-style forced-colors tests, which that emulation
 * does support.
 */
test.describe('forced colors', () => {
  test.beforeEach(async ({ page, browserName }) => {
    test.skip(
      browserName === 'webkit',
      'the emulation matches the media feature there without substituting the palette'
    );
    await page.emulateMedia({ forcedColors: 'active' });
  });

  test('the volume slider still states its value', async ({ page }) => {
    const row = await volumeRow(page);
    // Half volume, so 0.15 is inside the filled part and 0.85 inside the
    // unfilled one. This is the whole of what a slider communicates, and it is
    // what the unguarded Gecko rules destroyed: the fill and the track both
    // painted `rgb(255 255 255)`, one colour, 1.00:1, while the thumb reached
    // `rgb(240 240 240)` inside a `rgb(153 153 153)` border for 1.14:1 and
    // 2.85:1 against the canvas.
    //
    // Left native the boundary is the platform's, and it is emphatic:
    // `rgb(0 0 0)` against `rgb(233 233 237)` on Firefox for 17.34:1, and
    // `rgb(55 0 110)` against `rgb(255 255 255)` on Chromium for 15.13:1. Both
    // are the engine's numbers, not the theme's, which is why the floor is
    // asserted rather than the colours.
    expect(contrast(row.at(0.15), row.at(0.85))).toBeGreaterThanOrEqual(3);
  });

  test('the seek bar shows its loaded ranges but not its thumb', async ({
    page
  }) => {
    await page.goto(themedStory('player-seekslider--with-buffered-ranges'));
    const row = await centreRow(
      page,
      '[data-playdeck-part="seek-slider-input"]'
    );
    // Buffered 0..45 and 60..80, so 0.15 is loaded and 0.52 is not. Both are
    // painted by the theme's own forced-colors block — `canvastext` over
    // `canvas` — and they clear at 21:1.
    const loaded = row.at(0.15);
    expect(contrast(loaded, row.at(0.52))).toBeGreaterThanOrEqual(3);

    // And the position the user is actually at reaches no pixel. In this mode
    // `seek-buffered` is an opaque `canvas` bar rather than a translucent one,
    // so instead of veiling the native control it hides it outright, on every
    // engine and on both sides of #190. The thumb's centre samples the same
    // colour as a point in the loaded range well clear of it, which is the
    // assertion that there is nothing there. #415 owns that overlay; #190
    // neither caused this nor can reach it.
    const thumbCentre = 8.5 + 0.3 * (row.widthPx - 17);
    expect(row.at(thumbCentre / row.widthPx)).toEqual(loaded);
  });
});
