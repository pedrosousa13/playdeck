import { expect, test, type Page } from '@playwright/test';
import {
  contrast,
  fromChannels,
  type Rgba
} from '../packages/react/test/contrast';

/**
 * WCAG 2.2 AA 1.4.11 on the slider thumb, measured from rendered pixels (#190,
 * #415).
 *
 * `packages/react/test/theme.test.ts` already composites the theme's token
 * defaults and asserts the same 3:1 floor. This file exists because that
 * arithmetic can describe a slider no engine paints. Both sliders are native
 * range inputs, and how much of each one the theme has taken over differs: the
 * volume slider keeps Blink's and WebKit's own track and thumb with a ring added
 * to it, so what the theme declares has to survive being painted through, while
 * the seek slider is drawn by the theme on all three engines because nothing
 * else stopped its own loaded-range indicator painting over the control. A rule
 * that is a no-op on the target engine, or a layer that composites over the one
 * below it, is invisible to arithmetic. Only a screenshot can tell.
 *
 * The maths is imported from the unit test's module rather than restated, so
 * the two numbers are comparable by construction.
 *
 * Both stories are mounted through the toolbar's Theme global, which is the one
 * mechanism that mounts `theme.css` (`apps/storybook/.storybook/theme.tsx`).
 *
 * The `forced colors` block at the foot of the file measures the same two
 * sliders again with the system palette in force, because both of the above work
 * by switching an engine's native widget off — and a native widget is where
 * forced-colors rendering came from for free. Neither is applied in that mode,
 * and that block is what says so from pixels.
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
 *
 * `rowSelector` names the element whose centre picks the row, when that is not
 * the element being clipped. The seek slider needs the distinction: what is
 * sampled has to be the whole control, thumb included, so the clip is the
 * input — but the two surfaces the thumb is measured against are painted by
 * `seek-buffered`, a 4px bar that does NOT sit on the input's own centre line.
 * Measured on this story, as row offsets inside the input's box: the bar
 * occupies rows 22-25 on Blink and Gecko and rows 23-26 on WebKit, against an
 * input centre of row 22. Sampling the input's centre therefore reads the
 * engine's own track on WebKit and never the theme's bar at all.
 */
const centreRow = async (
  page: Page,
  selector: string,
  rowSelector: string = selector
): Promise<Row> => {
  const locator = page.locator(selector);
  await expect(locator).toBeVisible();
  const box = (await locator.boundingBox())!;
  const clip = {
    x: Math.round(box.x),
    y: Math.round(box.y),
    width: Math.round(box.width),
    height: Math.round(box.height)
  };
  const rowBox = (await page.locator(rowSelector).boundingBox())!;
  // Where the sampled row sits inside the clip, 0..1, so the decoder needs no
  // knowledge of the device pixel ratio to place it.
  const rowFraction = (rowBox.y + rowBox.height / 2 - clip.y) / clip.height;
  const shot = await page.screenshot({ animations: 'disabled', clip });

  const decoder = await page.context().newPage();
  await decoder.goto('about:blank');
  const image = await decoder.evaluate(
    async ({ source, fraction }) => {
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
      const row = Math.min(
        Math.max(Math.round(fraction * canvas.height), 0),
        canvas.height - 1
      );
      const { data } = context.getImageData(0, row, canvas.width, 1);
      return { width: canvas.width, channels: [...data] };
    },
    {
      source: `data:image/png;base64,${shot.toString('base64')}`,
      fraction: rowFraction
    }
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

test('the seek slider clears 3:1 on both sides of its thumb and across its loaded edge', async ({
  page
}) => {
  await page.goto(themedStory('player-seekslider--with-buffered-ranges'));
  // Clipped on the input so the thumb is in frame, sampled on the row through
  // the middle of `seek-buffered` — see `centreRow`. Both surfaces the thumb is
  // measured against live in that 4px bar and nowhere else, so it is the only
  // row on which the question this test asks is even well posed.
  const row = await centreRow(
    page,
    '[data-playdeck-part="seek-slider-input"]',
    '[data-playdeck-part="seek-buffered"]'
  );
  // Value 30 of 100, buffered 0..45 and 60..80. A range thumb's centre sits at
  // `half + fraction * (width - thumb)`, over a thumb 16px wide —
  // `--playdeck-slider-thickness * 4`, this theme's on every engine now (#415)
  // rather than only on Gecko (#190). On this story's 432px input 30% lands at
  // 133 ± 0.3.
  const ring = row.darkestAround(8.5 + 0.3 * (row.widthPx - 17), 12);
  const ratios = {
    'ring vs unfilled track': contrast(ring, row.at(0.55)),
    'ring vs loaded range': contrast(ring, row.at(0.7)),
    'loaded range vs unfilled track': contrast(row.at(0.7), row.at(0.55))
  };
  const measured = state(ratios);

  // This test recorded the opposite until #415: it asserted that the seek
  // slider does NOT clear 3:1 on both sides of its thumb, because it could not.
  // `SeekSlider` renders `seek-buffered` before the input and this theme made
  // it `position: absolute` while leaving the input in flow, so the theme's own
  // translucent bar painted OVER the native control — white at 0.36 alpha, and
  // a second white at 0.7 wherever a range was loaded. A `#000` ring reached the
  // screen as `rgb(206 206 206)` under two veils on all three engines, and the
  // engine's own track was under the bar as well, lifting the surround with it.
  // Measured on this row before the change, which is what this test reported
  // when it was written against it:
  //
  //     chromium  ring/track 2.48  ring/loaded 1.11  loaded/track 2.76
  //     firefox   ring/track 3.76  ring/loaded 1.03  loaded/track 3.86
  //     webkit    ring/track 3.76  ring/loaded 1.03  loaded/track 3.86
  //
  // The third column is the half no ring colour could have reached: on Blink the
  // bar composited over an OPAQUE native track (`rgb(59 59 59)`), which lifted
  // the unfilled bar to `rgb(129 129 129)` and left the loaded/unloaded boundary
  // at 2.76:1 — a failure of the loaded indicator itself, not of the thumb.
  //
  // What clears all three is the theme drawing the seek control rather than
  // decorating the engine's: `appearance: none`, the bar behind the input as its
  // track, and the thumb hand-drawn on all three engines. Every pixel compared
  // below is then painted from `theme.css`'s own tokens, which is why the three
  // engines now agree exactly rather than to a band — 3.55, 13.73 and 3.86 on
  // chromium, firefox and webkit alike, on all four rows of the bar and not only
  // on the one sampled here.
  //
  // The figures are stated in the message rather than pinned to literals, for
  // the reason the volume test above records: a pinned literal here cost a CI
  // failure once, when the surround was the engine's own track and not ours. It
  // is ours now, so the numbers are stable — but the floor is what 1.4.11 asks
  // for, and the floor is what is asserted.
  const belowFloor = Object.entries(ratios).filter(([, ratio]) => ratio < 3);
  expect(
    belowFloor.map(([boundary]) => boundary),
    measured
  ).toEqual([]);

  // Two boundaries the three ratios above do not cross, recorded rather than
  // left silent.
  //
  // `seek-progress` is #415's own new surface — the played span, which is what
  // `accent-color` used to paint before the native widget went off. It ends at
  // 30% on this story, and the samples above are 0.55 and 0.70, both to the
  // right of that edge, so nothing above measures the played span against
  // anything. Sampled at 0.10, inside it and clear of the thumb at ~0.27..0.34:
  //
  //     played span vs loaded range     1.69:1
  //     played span vs unfilled track   2.28:1
  //
  // Both are below the 3:1 floor, and neither is new arithmetic: they are the
  // same pair `theme.test.ts` has stated all along as `accent vs buffered` and
  // `accent vs track`, 1.65:1 and 2.59:1 over the theme's own backdrop default.
  // What #415 changed is whose pixel the fill is — this file's `seek-progress`
  // rather than an engine's `accent-color` seen through a translucent bar — so
  // the arithmetic and the screen now describe the same surface, and the three
  // engines agree on it. Closing the gap means moving
  // `--playdeck-color-accent`, which #415 puts out of scope, and 1.4.11 is
  // already satisfied at the thumb by the ring rather than by the fill — see the
  // long note in `theme.test.ts` for why no accent value clears both surfaces at
  // once.
  //
  // Pinned rather than floored, because there is no floor here to assert: what
  // is worth catching is the figure moving without anyone saying so. Pinning is
  // safe here for the reason it was not in the volume test above — every pixel
  // in both pairs is painted from `theme.css`'s own tokens over this story's
  // ground, none of it is an engine's native track, and the three engines
  // measured 1.6947 and 2.2805 alike.
  const played = row.at(0.1);
  const unmeasured = {
    'played span vs loaded range': contrast(played, row.at(0.7)),
    'played span vs unfilled track': contrast(played, row.at(0.55))
  };
  expect(
    Object.fromEntries(
      Object.entries(unmeasured).map(([boundary, ratio]) => [
        boundary,
        `${ratio.toFixed(2)}:1`
      ])
    )
  ).toEqual({
    'played span vs loaded range': '1.69:1',
    'played span vs unfilled track': '2.28:1'
  });
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
 * cannot show it either way, for the reason the second test below records — and
 * #415's rules sit inside the same query for the same reason, so this mode is
 * the one place the seek slider is still the engine's control under the theme's
 * opaque bar.
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
    // engine. The thumb's centre samples the same colour as a point in the
    // loaded range well clear of it, which is the assertion that there is
    // nothing there.
    //
    // Still true after #415, and deliberately. That change put the bar behind
    // the input everywhere else by making the theme draw the control, and both
    // halves of it are held out of this mode: `theme.css` records the two
    // measurements that say why, and they are the same trade #190 refused —
    // positioning the input here hands the row to the engine's own opaque track
    // and takes the assertion above from 21.00:1 to 1.00:1, and drawing the
    // control here flattens Gecko's thumb to under 3:1 against the canvas. The
    // pair of assertions in this test is what keeps that decision honest: the
    // first is the half worth more than the second, and the second is the cost,
    // stated rather than left silent.
    const thumbCentre = 8.5 + 0.3 * (row.widthPx - 17);
    expect(row.at(thumbCentre / row.widthPx)).toEqual(loaded);
  });
});
