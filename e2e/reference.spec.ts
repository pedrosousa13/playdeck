import { expect, test, type Page } from '@playwright/test';
import {
  activationButton,
  airPlayButton,
  captionsButton,
  controls,
  media,
  muteButton,
  pipButton,
  playButton,
  seekBufferedRange,
  seekSliderInput,
  settingsMenu,
  settingsTrigger,
  volumeSlider
} from './locators';

// #67's composed example, driven the way a consumer would. The MP4 and HLS legs
// block; YouTube and Vimeo are @real and grep-inverted out of CI, because the
// ledger has already characterised those two (plus hls) as where CPU-saturation
// failures land.
const story = '/iframe.html?id=reference-player--real-sources&viewMode=story';

// Both local fixtures are ~1 SECOND long (measured while driving the story by
// hand in Task 4). So `data-state="playing"` is a state the clip leaves on its
// own within ~2s, and asserting it is a race. `currentTime > 0` is the
// race-free way to say "it actually played" — it stays true once ended.
//
// 15s rather than `expect.poll`'s default 5s, which WebKit under contention ran
// out of (#408). Instrumented to poll the element directly for up to 60s so no
// timeout truncated the tail, 384 invocations on `--project=webkit` under
// `--repeat-each=8 --workers=4` took a median of 2916ms and a worst case of
// 6263ms — 13 runs over 5s, 1 over 6s, none over 7s.
//
// Which measures what the wait needs HERE, and 10s would fit that data as well
// as 15s does. The extra margin is for the machine this was not measured on:
// CI's contention profile is different and unmeasured, and the 6263ms above is
// one laptop's tail, not a bound. What the margin costs is worth naming, since
// it is not nothing — the wedge below fails at the timeout rather than before
// it, so every wedged run now burns 15s instead of 10s. At ~1% of runs that was
// judged the cheaper side to be wrong on. The number matching
// `bufferedRendered`'s is a convenience, not the reason; that one is for a
// different signal and was not the basis for this.
//
// A longer wait is not the whole story. 4 of those 384 never started at all:
// the element reached `readyState 4`, fully buffered, and sat at `currentTime`
// 0 for the entire 60s, which no timeout value can wait out (#411). So this
// lowers the failure rate rather than ending it, and a `played()` timeout from
// here on is worth reading as that wedge rather than as 15s being too short.
//
// Reconciled against the 30s per-test budget in `playwright.config.ts`, which
// both other 15s bounds in this file justify themselves against: the pointer
// test below now carries this bound AND `seekableThrough`'s, and the 26s of
// `settledAt` and polls the latter counts comes after both. Those upper bounds
// have summed past 30s since long before this change, and cannot all be spent —
// measured across 512 runs, that test ran 9.6s at the median and 22.2s at its
// worst. They exist to fail a wedged element rather than to be waited out, so
// reaching either means the test timeout arrives first and the diagnosis is
// #411 rather than a budget to re-cut.
//
// `a11y-media.spec.ts` and `rapid-slider-presses.spec.ts` keep their own copies
// of this helper and carry the same timeout with a pointer back here, rather
// than a third copy of the reasoning. Folding the three into one shared helper
// is a wider change than #408 asked for.
const played = (page: Page) =>
  expect
    .poll(
      () => media(page).evaluate((el: HTMLVideoElement) => el.currentTime),
      {
        timeout: 15_000
      }
    )
    .toBeGreaterThan(0);

// The buffered layer only renders once `PlayerState.buffered` is non-empty, and
// that is NOT a consequence of playback. The native adapter publishes
// `buffered` from exactly two places: the `emitMediaState` snapshot, taken on
// attach and on `canplay`/`loadedmetadata`
// (provider-native/src/attachment.ts:116-124, 164-171), and the media element's
// `progress` event (attachment.ts:177-180). `onTimeUpdate` (attachment.ts:151)
// carries none, so a clip that is already playing does not keep refreshing it.
// `SeekSlider` then renders no ranges at all until it also has a seek window,
// i.e. until a duration has arrived (transport-controls.tsx:427).
//
// `played()` waits on `el.currentTime`, which the media element answers
// directly, so returning from it says nothing about any of the above having
// landed. On an unloaded machine it makes no odds — measured 4 runs each on
// chromium and firefox, the ranges are already rendered by the time `played()`
// returns — but on WebKit under CI load `expect.poll`'s default 5s ran out
// (#270). So this waits far longer for exactly the same signal, rather than
// asserting anything weaker. 15s is what still leaves headroom for the rest of
// the test inside the 30s budget in `playwright.config.ts`.
const bufferedRendered = (page: Page) =>
  expect
    .poll(() => seekBufferedRange(page).count(), { timeout: 15_000 })
    .toBeGreaterThan(0);

// Writing a position onto the media element assumes the element can already
// reach it, and on WebKit it often cannot yet. This engine parses `tracer.webm`
// incrementally and reports a duration that grows as it goes, `el.seekable`
// with it. A `currentTime` write is clamped into `seekable` — the same
// arithmetic `withinMediaBounds` does (provider-native/adapter-values.ts:132)
// — so writing 1 into a partly-parsed element lands at whatever the window
// extends to at that instant. That clamp then puts the playhead exactly at the
// leading edge, WebKit fires `seeking`/`seeked`/`ended`, the network state goes
// to `stalled`, and the duration stays frozen there for good: the element never
// recovers, so a later wait on the written position runs its whole timeout out
// (#407).
//
// Measured, not assumed. Over 60 instrumented WebKit runs, read at the instant
// of the write: all 19 that passed had `duration` and the window extent at
// 1.000000, and all 41 that failed had a partial duration between 0.0407 and
// 0.5641 with the extent equal to it — separation with no overlap. `readyState`
// would not have caught it, so this does not wait on one: those failures
// included `readyState === 4` sitting alongside a duration of 0.0407.
//
// The extent rather than `duration`, because the extent is what the write is
// clamped against, and taken across every range the way `seekWindow` takes it
// (react/src/transport-controls.tsx:247-258) rather than off the last one
// alone. The clip is left playing across the wait: the measured loads keep
// progressing and reach 1.000000 while playing, and it is the clamped write,
// not playback, that freezes them.
//
// 15s for the same reason `bufferedRendered` takes it, but it is an upper bound
// rather than headroom — reached, it would exhaust the 30s per-test budget in
// `playwright.config.ts` before reporting, because this test spends 26s more on
// `settledAt` and its polls. Measured across 512 runs under
// `--repeat-each=8 --workers=4`, the pointer test ran 9.6s at the median and
// 22.2s at its worst, so the bound is there to fail a wedged element rather
// than to be waited out.
const seekableThrough = (page: Page, seconds: number) =>
  expect
    .poll(
      () =>
        media(page).evaluate((el: HTMLVideoElement) =>
          el.seekable.length === 0
            ? 0
            : Math.max(
                ...Array.from({ length: el.seekable.length }, (_, index) =>
                  el.seekable.end(index)
                )
              )
        ),
      { timeout: 15_000 }
    )
    .toBeGreaterThanOrEqual(seconds);

// WebKit cannot satisfy that poll for this composition's fixture, so the two
// tests that wait on it are excluded there (#401). Measured, not assumed.
//
// This engine takes `tracer.webm`: Playwright's Linux WebKit has no H.264
// decoder (`el.canPlayType('video/mp4')` is the empty string), so it falls past
// the MP4 to the WebM #384 put behind it. For that clip WebKit populates
// `el.buffered` on roughly HALF of loads — the first test below, run 8 times
// sequentially on an IDLE machine, passed 4 and failed 4, while chromium went
// 6/6 and firefox 6/6.
//
// On the loads where `buffered` is empty it is empty at EVERY observable
// instant, not merely at the four the native adapter samples. An in-situ probe
// on this same story, reading `el.buffered.length` on every
// `requestAnimationFrame` and on 18 media events across 13 loads, measured a
// length of 0 in 0 of ~450 frames and 0 of 708-751 `durationchange` ticks over
// ~8s of wall clock — while `el.seekable` grew to [[0, 1.000333333]] and
// playback ran all the way through to `ended`. And in all 7 of the loads where
// `buffered` was ever non-empty, the `canplay` snapshot the adapter already
// takes caught it.
//
// That pair of numbers is what separates this from #400 and rules out the fix
// that issue got: publishing `buffered` from more media events buys exactly
// zero extra passing runs here, because on a failing load there is no instant
// to sample. Also ruled out by measurement, none of them moving the rate: clip
// length (a generated 30s VP8 clip failed 3 of 8, the same as the 1s
// original's 3 of 8), `Accept-Ranges`, `preload="metadata"`, which entries the
// `<source>` set carries, the adapter's second `media.load()`, and rescuing a
// bare load after the fact with a seek, a replay or another `load()`.
//
// What would reopen it: a WebKit build that reports buffered ranges for this
// clip on every load, or a fixture this engine populates `buffered` for
// deterministically — an H.264-capable build, which would take the MP4 instead
// and never reach the WebM, is the likelier of the two. Deleting either skip
// needs the same kind of evidence that put it here: at a failure rate of one in
// two, a single green run says nothing, so repeat the run enough times to tell
// "always" apart from "half the time".
//
// The two tests carrying this skip are the whole exposure. `bufferedRendered`
// has no other callers, and this file's remaining `seek-buffered` assertions
// read rule text out of the story's stylesheet rather than rendered ranges, so
// they hold whether or not the engine ever reports a buffered range.
const skipWithoutWebKitBuffered =
  'WebKit populates el.buffered for the WebM fixture this composition selects on only about half of loads (measured: 4 of 8 sequential runs on an idle machine), and on the other half it stays empty at every observable instant, so no seek-buffered-range is ever rendered to assert on (#401).';

test('the composed example plays, seeks, mutes and toggles captions on MP4', async ({
  page
}) => {
  await page.goto(story);
  await activationButton(page).click();
  await played(page);

  // Seek through the public control, then read the media element: the command
  // has to reach the video, not just move the input. `SeekSlider`'s step is 1
  // and its max is the duration, so on a 1s fixture 0 and 1 are the only
  // reachable targets — and seeking to the end is the deterministic assertion,
  // because arriving there ends the clip rather than racing playback.
  //
  // Measured: WebKit's currentTime after ending is never exactly 1 — it
  // settles a fraction past it (observed 1.000122584-1.000185166 across
  // repeated runs), while Chromium and Firefox report exactly 1. `>= 1` is
  // what's actually true on every engine; `data-state === 'ended'` below is
  // the assertion that actually pins down "reached the end".
  await seekSliderInput(page).fill('1');
  await expect
    .poll(() => media(page).evaluate((el: HTMLVideoElement) => el.currentTime))
    .toBeGreaterThanOrEqual(1);
  await expect(playButton(page)).toHaveAttribute('data-state', 'ended');

  await muteButton(page).click();
  await expect(muteButton(page)).toHaveAttribute('data-state', 'muted');
  await expect(
    media(page).evaluate((el: HTMLVideoElement) => el.muted)
  ).resolves.toBe(true);

  // The <track> the example declares through Media's children — the API #15
  // shipped without. Its default flag selects it on load.
  await expect(captionsButton(page)).toHaveAttribute('data-state', 'on');
  await captionsButton(page).click();
  await expect(captionsButton(page)).toHaveAttribute('data-state', 'off');
});

// A computed background colour is either `rgb(r, g, b)` (opaque) or
// `rgba(r, g, b, a)`. Only the second form can be transparent — the
// `transparent` keyword and the story's own `rgb(255 255 255 / 0.3)` both come
// back from every engine as `rgba(...)` (measured on chromium and firefox).
//
// The third branch throws rather than defaulting. A helper that answered 1 for
// anything it did not recognise would make every `alpha > 0` assertion below
// pass on a serialization nobody had read — a future engine emitting
// `color(srgb ...)` would turn the whole buffered-visibility suite green
// without measuring anything. Failing loudly is the only reading that keeps
// these assertions worth having.
const alphaOf = (color: string): number => {
  const value = color.trim();
  const rgba = /^rgba\([^)]*,\s*([0-9.]+)\s*\)$/.exec(value);
  if (rgba !== null) return Number(rgba[1]);
  if (/^rgb\([^)]*\)$/.test(value)) return 1;
  throw new Error(`alphaOf: unrecognised colour serialization ${value}`);
};

// #191. The buffered layer's presentation comes from the shipped theme, which
// this composition deliberately does not mount — so on main both parts rendered
// as zero-height transparent boxes and the indicator conveyed nothing. These
// assertions pin the visible result, not the rule text: a regression back to
// "styled by nothing" is a zero height and a zero alpha here.
test('the buffered indicator is visible and distinguishable from the unbuffered track', async ({
  browserName,
  page
}) => {
  test.skip(browserName === 'webkit', skipWithoutWebKitBuffered);

  await page.goto(story);
  await activationButton(page).click();
  await played(page);
  await bufferedRendered(page);

  const painted = await page.evaluate(() => {
    const read = (selector: string) => {
      const el = document.querySelector(selector)!;
      const style = getComputedStyle(el);
      return {
        height: el.getBoundingClientRect().height,
        backgroundColor: style.backgroundColor,
        position: style.position,
        pointerEvents: style.pointerEvents
      };
    };
    return {
      container: read('[data-playdeck-part="seek-buffered"]'),
      range: read('[data-playdeck-part="seek-buffered-range"]')
    };
  });

  expect(painted.container.height).toBeGreaterThan(0);
  expect(alphaOf(painted.container.backgroundColor)).toBeGreaterThan(0);
  expect(painted.range.height).toBeGreaterThan(0);
  expect(alphaOf(painted.range.backgroundColor)).toBeGreaterThan(0);
  // Buffered-ahead has to read differently from the track it sits on, or the
  // layer is visible and still says nothing.
  expect(painted.range.backgroundColor).not.toBe(
    painted.container.backgroundColor
  );

  // Out of flow and inside the seek control's own box: together those are why
  // the layer cannot grow the control row, whatever thickness it is given.
  expect(painted.container.position).toBe('absolute');
  const contained = await page.evaluate(() => {
    const slider = document
      .querySelector('[data-playdeck-part="seek-slider"]')!
      .getBoundingClientRect();
    const buffered = document
      .querySelector('[data-playdeck-part="seek-buffered"]')!
      .getBoundingClientRect();
    return {
      overflowTop: Math.round(slider.top - buffered.top),
      overflowBottom: Math.round(buffered.bottom - slider.bottom)
    };
  });
  expect(contained.overflowTop).toBeLessThanOrEqual(0);
  expect(contained.overflowBottom).toBeLessThanOrEqual(0);

  // The layer paints over the control, so it has to stay pointer-transparent —
  // otherwise it swallows the seek it is describing.
  expect(painted.container.pointerEvents).toBe('none');
  const hit = await page.evaluate(() => {
    const input = document.querySelector(
      '[data-playdeck-part="seek-slider-input"]'
    )!;
    const rect = input.getBoundingClientRect();
    const resolved = document.elementFromPoint(
      rect.left + rect.width / 2,
      rect.top + rect.height / 2
    );
    return (
      resolved?.getAttribute('data-playdeck-part') ?? resolved?.tagName ?? null
    );
  });
  expect(hit).toBe('seek-slider-input');

  // And a seek through the control still reaches the media element. Paused AND
  // rewound first, and that setup is what makes the assertion mean anything:
  // the fixture is 1.000s long (read off `el.duration` on both engines),
  // `played()` only waits for `currentTime > 0`, and `expect.poll` waits up to
  // 5s — so a running clip arrives at 1 on its own and this stays green with
  // the control ripped out, and a clip that had already ended by the time
  // `played()` returned is there before the seek is even attempted.
  await media(page).evaluate((el: HTMLVideoElement) => {
    el.pause();
    el.currentTime = 0;
  });
  // `SeekSlider` is min 0 / max duration with `step={1}`, so on a 1.000s clip
  // the input has exactly two reachable values and rounds anything past 0.5 to
  // "1". Reading "0" is therefore both preconditions at once: currentTime is
  // below 0.5, so `>= 1` below cannot already hold; and the input does not
  // already hold the value `fill` is about to write, so the fill is a real
  // change rather than a no-op.
  await expect(seekSliderInput(page)).toHaveValue('0');
  await seekSliderInput(page).fill('1');
  await expect
    .poll(() => media(page).evaluate((el: HTMLVideoElement) => el.currentTime))
    .toBeGreaterThanOrEqual(1);
});

// #192, folded into #191. Both range controls rendered as the engine's bare
// native slider: `accent-color: auto`, the UA's own white background, and no
// authored rule anywhere in the story document mentioning either part.
//
// #191's criterion has two halves, and they are split across four tests rather
// than one: what the controls LOOK like and what they do to the layout is this
// test, and whether they stay operable is the three gesture tests below. Each
// of those establishes its own starting position through the media element, so
// a gesture that one engine swallows cannot cascade into the leg after it —
// which is what a single long test made possible, and what it went flaky on
// twice (see `settledAt`).
test('both range controls carry the composition own presentation', async ({
  page
}) => {
  await page.goto(story);
  await activationButton(page).click();
  await played(page);

  const sliders = await page.evaluate(() => {
    const read = (selector: string) => {
      const el = document.querySelector(selector)!;
      const style = getComputedStyle(el);
      const rect = el.getBoundingClientRect();
      const resolved = document.elementFromPoint(
        rect.left + rect.width / 2,
        rect.top + rect.height / 2
      );
      return {
        accentColor: style.accentColor,
        cursor: style.cursor,
        width: rect.width,
        height: rect.height,
        hit: resolved?.getAttribute('data-playdeck-part') ?? null
      };
    };
    return {
      seek: read('[data-playdeck-part="seek-slider-input"]'),
      volume: read('[data-playdeck-part="volume-slider"]')
    };
  });

  // Deliberate rather than defaulted. `auto` is what the UA leaves behind.
  expect(sliders.seek.accentColor).not.toBe('auto');
  expect(sliders.volume.accentColor).not.toBe('auto');
  expect(sliders.seek.accentColor).toBe(sliders.volume.accentColor);
  expect(sliders.seek.cursor).toBe('pointer');
  expect(sliders.volume.cursor).toBe('pointer');

  // The 44px target, and the four are NOT floored alike — worth naming,
  // because three of them are already true before this stylesheet exists and
  // one is not.
  //
  // The primitives write their floors inline, which no rule here can beat.
  // `VolumeSlider` IS the range input and takes `controlTargetStyle`'s
  // `{ minWidth: 44, minHeight: 44 }` (loading-error.tsx:307, applied at
  // transport-controls.tsx:141), so both of its numbers are inline. The seek
  // input is a separate element inside `SeekSlider`'s root and gets a literal
  // `{ width: '100%', minHeight: 44 }` (transport-controls.tsx:462) — a
  // block-axis floor and NO minWidth. So `sliders.volume.*` and
  // `sliders.seek.height` guard only that the new rules left the primitives'
  // own floors intact, which is what makes them cheap to keep and weak on
  // their own.
  //
  // `sliders.seek.width` is the one this stylesheet owns end to end. Nothing
  // floors it: the input is `width: 100%` of `.playdeck-example-scrubber`, which
  // is `flex: 1 1 auto; min-width: 0` in the seek row — measured 693.59px on
  // chromium and 693.63px on firefox at the default viewport. It clears 44 by
  // layout alone, so a rule here that narrowed the scrubber is the one thing
  // in this group that actually fails.
  //
  // None of the four guard the authored `inline-size: 5rem` on the volume
  // slider: mutating it to 1rem leaves all four green, floored at 44 by the
  // inline `minWidth`. Nothing in this file pins that number, and nothing
  // should — 44 is the accessibility criterion, 80 is a taste call.
  expect(sliders.seek.height).toBeGreaterThanOrEqual(44);
  expect(sliders.seek.width).toBeGreaterThanOrEqual(44);
  expect(sliders.volume.height).toBeGreaterThanOrEqual(44);
  expect(sliders.volume.width).toBeGreaterThanOrEqual(44);

  // Nothing this stylesheet added sits in front of either control: each one's
  // own centre hit-tests to itself. That is occlusion only — the gesture half
  // of the same criterion is the three operability tests below.
  expect(sliders.seek.hit).toBe('seek-slider-input');
  expect(sliders.volume.hit).toBe('volume-slider');

  // The row heights the new rules are not allowed to move (#191). Stated as
  // relations, not pixel counts: the row is 50/48px on chromium and neither
  // number is the same on every engine.
  const rows = await page.evaluate(() => {
    const marginBox = (el: Element): number => {
      const style = getComputedStyle(el);
      return (
        el.getBoundingClientRect().height +
        Number.parseFloat(style.marginBlockStart) +
        Number.parseFloat(style.marginBlockEnd)
      );
    };
    const buttonRow = document.querySelector('.playdeck-example-row-buttons')!;
    return {
      buttonRow: buttonRow.getBoundingClientRect().height,
      tallestInButtonRow: Math.max(
        ...[...buttonRow.children].map((child) => marginBox(child))
      ),
      volume: document
        .querySelector('[data-playdeck-part="volume-slider"]')!
        .getBoundingClientRect().height,
      mute: document
        .querySelector('[data-playdeck-part="mute-button"]')!
        .getBoundingClientRect().height
    };
  });

  // The button row still lays out on one line. `flex: 0 0 auto` at 5rem makes
  // the volume slider unshrinkable inside a `flex-wrap: wrap` row, so the
  // failure mode is a second line — which doubles this height and breaks the
  // equality, with no engine-specific number written down.
  expect(rows.buttonRow).toBeCloseTo(rows.tallestInButtonRow, 1);
  // And the authored size did not make the slider taller than the targets
  // beside it, which is the other way the row could grow.
  expect(rows.volume).toBeCloseTo(rows.mute, 1);

  // The seek row gets the criterion literally: measure it, delete every rule
  // of the sliders block from the live sheet, measure again, put the sheet
  // back. "Unchanged BY the new rules" is a difference, so the test takes the
  // difference rather than naming a second box that ought to match.
  //
  // It used to compare the row against the margin box of
  // `seek-slider-input`, on the reasoning that the buffered layer is out of
  // flow so the input alone sizes the row. The premise holds; the equality
  // does not. Measured, the row is 2px taller than that margin box on
  // chromium and 4px on firefox, and all of the difference sits BELOW the
  // input. `SeekSlider`'s root is a block box whose only in-flow child is the
  // inline-level input, so the root's height is a line box, not the input's
  // box: the input's baseline is its bottom margin edge, and the root's own
  // strut (the composition's system-ui 16px at `line-height: normal`, a 19px
  // line box on both engines) hangs its descent below that baseline.
  // Confirmed by taking the input off the baseline — `vertical-align: bottom`
  // on it collapses the row to exactly the 48px margin box on both engines.
  // That descent is engine font metrics, which nothing in this stylesheet
  // sets, so the old equality was pinning the wrong thing.
  const seekRow = await page.evaluate(() => {
    const height = () =>
      document
        .querySelector('.playdeck-example-scrubber')!
        .parentElement!.getBoundingClientRect().height;
    const element = [...document.querySelectorAll('style')].find((candidate) =>
      candidate.textContent?.includes('.playdeck-example-frame')
    )!;
    const source = element.textContent!;
    const sheet = element.sheet!;
    const withRules = height();
    let removed = 0;
    // Backwards: deleting a rule reindexes every rule after it. The pattern
    // covers the whole sliders block including its forced-colors half, which
    // is a media rule whose cssText carries its inner selectors.
    for (let index = sheet.cssRules.length - 1; index >= 0; index -= 1) {
      const rule = sheet.cssRules.item(index);
      if (
        rule &&
        /seek-buffered|seek-slider-input|volume-slider/.test(rule.cssText)
      ) {
        sheet.deleteRule(index);
        removed += 1;
      }
    }
    const withoutRules = height();
    // Defensive. Nothing runs after this today and Playwright discards the
    // page at the end of the test either way, so this restores nothing that is
    // currently read — it is here so that anything added below inherits the
    // composition rather than a half-deleted stylesheet. Reassigning the text
    // reparses the sheet.
    element.textContent = source;
    return { withRules, withoutRules, removed };
  });

  // Guards the guard. The equality below compares the row against itself with
  // the sliders block deleted, so anything that stops the pattern matching
  // makes it vacuous — and `> 0` would not catch that, because a rename of one
  // part leaves the rules naming the others still matching. The exact count is
  // what catches a rename that drops a rule out of the match: five rules carry
  // those three part names today — seek-buffered, seek-buffered-range, the
  // accent/cursor rule shared by both inputs, the volume sizing rule, and the
  // forced-colors media rule, whose cssText carries its two inner selectors.
  // Not every partial rename moves the number: renaming `seek-slider-input`
  // alone leaves it at 5, because the one rule naming that part also names
  // `volume-slider`.
  expect(seekRow.removed).toBe(5);
  // Both numbers come from the same engine in the same layout, so there is
  // still no pixel count written down. Mutation-checked in both directions a
  // rule could grow the row: a `block-size` on `seek-slider-input`, and a
  // taller `seek-buffered` taken off `position: absolute`. Each moves
  // `withRules` alone and fails this.
  expect(seekRow.withRules).toBeCloseTo(seekRow.withoutRules, 1);
});

// The precondition every gesture test below starts from, and the reason they
// are separate tests at all.
//
// Both range controls are CONTROLLED inputs: the DOM value is whatever React
// last committed, and what React renders is `PlayerState`, which the native
// adapter publishes from the media element's own asynchronous events. Between
// a change and the commit that answers it, the input can still be holding the
// OLD value. Measured under CPU saturation on chromium, at the `change` event
// `el.volume` already read 1 while the input still read "0", a macrotask ran
// while that was still true, and the input only read "1" 2.6-19.7ms later.
//
// That window is fatal because a range input fires no `input` and no `change`
// when a gesture asks it for the value it already holds — measured: Home on a
// slider already at its minimum produces a `keydown` and nothing else. A press
// or click made inside the window is therefore silently swallowed, and the
// assertion after it reads whatever the previous step left behind. That is the
// diagnosis of the chromium flake — twice in a row at the volume Home,
// `Expected: 0 / Received: 1` — which is where the timings above were measured.
// The later webkit flake, at the seek End with `Expected: >= 1 / Received: 0`,
// has the same shape: a gesture that left the media element where it was.
// Its mechanism is NOT measured here — that flake was never reproduced, so the
// shape above is read across from the chromium diagnosis rather than measured
// on WebKit.
//
// A single `toHaveValue` sample cannot rule the window out, because the sample
// can land before the stale restore does. So no gesture below rests on one
// sample. `settledAt` requires four things to hold TOGETHER for `HOLD_MS` of
// wall clock, sampled inside the page:
//
//  - the control sits on the grid its input renders, at the stop nearest
//    `value`;
//  - the media element's `property` is inside `bounds`, so the two agree;
//  - the media element is not part-way through a seek (`el.seeking`), i.e. no
//    seek is outstanding whose completion would publish another position;
//  - the media element fired none of the events the adapter publishes these
//    two values from, so nothing is in flight that could commit over the
//    control. Every caller pauses first, which is what makes this reachable:
//    a playing clip reports `timeupdate` several times a second and would
//    never go quiet for a whole window.
//
// A stop, rather than the exact string the input has to report, because the
// string a range input keeps is a function of a grid this test does not pin.
// The seek input spans its seek window rather than the media duration: `min`
// and `max` are that window's start and end, which is `0` to the duration for a
// VOD source that has one — the case this fixture happens to be — and the
// seekable extent for a live source that has none. Its `step` is the
// consumer's wherever `inputProps` supplies one, and otherwise the derived
// default, `min(1, span / 20)` (`transport-controls.tsx`, #383). `snapToStep`
// there decides the value React assigns from whichever grid those produce, so
// the string the input keeps is a stop on it. An engine that reports this
// fixture's duration as `1.000333333` rather than `1` moves every stop off the
// round number a literal would name, so a literal asserted the duration as
// much as the control.
//
// Half a step is only half the check. The control must also sit ON the grid:
// its distance to the nearest stop, counted in steps from the input's own
// `min`, has to be within a small fraction of one. Neither condition is worth
// much alone — proximity alone accepts a control that is merely close and on no
// stop at all, which is a control that never went through the sanitisation this
// is here to observe, and membership alone accepts any stop anywhere. Together
// they pin the control to a stop, and to the stop nearest the target: a stop
// further out fails the first, a near miss of one fails the second. That is the
// strictness of the literal this replaced, minus its dependence on the
// fixture's duration being a round number.
//
// Membership is a tolerance and not exact arithmetic because it cannot be. The
// DOM value is a decimal string `snapToStep` produced through `.toFixed`, and a
// stop rebuilt here in floating point from `min` and `step` does not reproduce
// that string digit for digit, so a modulo test against it would fail on
// grids that are perfectly sound. The tolerance is therefore a fraction of a
// step rather than an absolute distance, and is orders of magnitude below any
// drift that would mean the control had missed the grid.
//
// What the control side does NOT rest on is `bounds`. That constrains the media
// element's own value independently of the control, so the two halves are
// established separately rather than each from the other — but both seek call
// sites pass `{ min: 1, max: Infinity }`, a floor and not a pin, so it is not
// what makes the control side tight. The two conditions above are. And half a
// step still rejects a control a whole step or more from the target, which is
// every stale reading the helper exists to catch: the shape it was written for
// is a control reading 1 while the media reads 0, a full window apart and
// nowhere near any tolerance.
//
// The grid is read back off the input rather than recomputed here, and
// deliberately not re-derived from the window: a check that reimplemented
// `snapToStep` would agree with a broken `snapToStep` by construction, which is
// the one thing this must not do. Membership is grid arithmetic and nothing
// else for the same reason — it does not rebuild `snapToStep`'s clamp into
// `[min, max]`, nor its fallback where the nearest stop overshoots `max`,
// because rebuilding either is how a check starts agreeing with the code it is
// checking. An input with no usable grid — `step="any"`, or an attribute that
// parses to nothing — has no stop to sit on, so that case demands the target
// exactly.
//
// The loop awaits a timer between samples, so a commit that is owed gets the
// event loop and is observed rather than skipped over. `HOLD_MS` is fixed wall
// clock, not a sample count: under load the number of samples inside it drops
// but the window itself does not shrink. 150ms is ~7x the longest restore
// measured above.
const HOLD_MS = 150;

const settledAt = (
  page: Page,
  part: 'seek-slider-input' | 'volume-slider',
  value: number,
  property: 'currentTime' | 'volume',
  bounds: { readonly min: number; readonly max: number }
) =>
  expect
    .poll(
      () =>
        page.evaluate(
          async ({ hold, max, min, part, property, value }) => {
            const input = document.querySelector<HTMLInputElement>(
              `[data-playdeck-part="${part}"]`
            );
            const el = document.querySelector<HTMLVideoElement>(
              '[data-playdeck-part="media"]'
            );
            if (input === null || el === null) return 'nothing rendered';
            const size = Number(input.step);
            const origin = Number(input.min);
            // Both conditions, on a control with a usable grid: within half a
            // step of the target, and on the grid. The float boundary of the
            // first needs a nudge, since a control exactly half a step out is
            // on the tolerated side of it and `1e-9` is far below any grid
            // these controls render. The second counts the distance to the
            // nearest stop in steps rather than seconds, and tolerates a
            // millionth of one: the value it reads is a decimal string written
            // with `.toFixed`, so a stop rebuilt from `min` and `step` here in
            // floating point cannot be expected to match it exactly.
            const near = (reported: number): boolean => {
              if (!Number.isFinite(size) || size <= 0)
                return reported === value;
              if (Math.abs(reported - value) > size / 2 + 1e-9) return false;
              const stops = (reported - origin) / size;
              return Math.abs(stops - Math.round(stops)) <= 1e-6;
            };
            const names = [
              'durationchange',
              'seeked',
              'seeking',
              'timeupdate',
              'volumechange'
            ];
            // An array rather than a `let`: assignment from a listener is
            // invisible to TypeScript's narrowing, which would then read the
            // check below as always false.
            const fired: string[] = [];
            const record = (event: Event) => {
              fired.push(event.type);
            };
            for (const name of names) el.addEventListener(name, record);
            try {
              const deadline = performance.now() + hold;
              for (;;) {
                const reading = el[property];
                if (
                  !near(Number(input.value)) ||
                  reading < min ||
                  reading > max
                ) {
                  return `control ${input.value} (target ${value}) / media ${reading} / grid min=${input.min} max=${input.max} step=${input.step} / duration ${el.duration} / seekableEnd ${el.seekable.length === 0 ? 'none' : el.seekable.end(el.seekable.length - 1)}`;
                }
                if (fired.length > 0) return `media fired ${fired.join(',')}`;
                if (el.seeking) return 'media seeking';
                if (performance.now() >= deadline) return 'held';
                await new Promise((resolve) => {
                  setTimeout(resolve, 10);
                });
              }
            } finally {
              for (const name of names) el.removeEventListener(name, record);
            }
          },
          {
            hold: HOLD_MS,
            max: bounds.max,
            min: bounds.min,
            part,
            property,
            value
          }
        ),
      { timeout: 8_000 }
    )
    .toBe('held');

// #191: both controls remain operable by POINTER, and the resulting value
// still reaches the media element.
test('both range controls stay operable by pointer', async ({ page }) => {
  await page.goto(story);
  await activationButton(page).click();
  await played(page);

  // Paused first, and left paused for the rest of the test. `played()` only
  // waits for `currentTime > 0` and `expect.poll` waits up to 5s, so against a
  // running clip a `>= 1` assertion arrives on its own with both controls
  // ripped out. Pausing also makes the clock one-way: a paused clip's
  // currentTime never falls by itself, so every `toBe(0)` below is a place
  // only a control can put it.
  //
  // The seek starts one step short of its far end, put there through the media
  // element rather than through either control, so the pointer click has
  // somewhere to travel that playback could not have reached on its own. Where
  // a consumer supplies no step, `SeekSlider` derives its input's default from
  // the window it renders — `min(1, span / 20)` (#383) — so on this ~1.000s
  // fixture the grid is a fine one, its stops a twentieth of the clip apart,
  // rather than the two values the older fixed `step={1}` left. ADR-0005
  // remains the account of that step: its `step={1}` bullet is why the
  // attribute is still whatever pointer scrubbing wants even though the arrows
  // stopped using it, and its footnote records the derivation replacing the
  // fixed 1. 0.95 is a stop on that derived grid and sits 19 of its 20 steps
  // away from the minimum the click below asks for, so settling there first is
  // what makes that click a real change rather than a no-op that fires no
  // event: a range input handed the value it already holds fires neither
  // `input` nor `change`, and the assertion after it would then be reading what
  // this line put there.
  //
  // 0.95 rather than the far end, which is where this line started and what it
  // was written to use. The far end is exactly `duration`, and a seek to
  // exactly `duration` is the one position this fixture cannot be relied on to
  // reach in Playwright's Linux WebKit. Measured over 50 unretried runs
  // (`--repeat-each=25 --retries=0`, #470): the write itself always took — 25
  // of 25 read back exactly 1 in the statement after the assignment, on a
  // source whose duration and seekable window had both reached 1.000000 — and
  // then the seek the engine started for it landed at 0.000000 on 9 of those 25
  // runs, `seeking` reporting 1.000000 and `seeked` 0.000000 a few
  // milliseconds behind it. Nothing in the page put the playhead back: a
  // `currentTime` accessor trap installed before the story's own script ran
  // recorded exactly one write on the failing runs, the test's. So the target
  // is the whole of the variable, and this test never needed the furthest one
  // — only one far enough from the minimum to make the click below a real
  // change. `.out-of-scope/webkit-end-of-media-seek.md` carries the rest, and
  // the keyboard test below, which cannot move its target off `max`, carries
  // the skip this retarget avoids needing.
  //
  // And the element has to be able to reach that position before it is told to,
  // which on WebKit is not a given — `seekableThrough` above is that
  // precondition, and carries why (#407). It still waits on 1 rather than on
  // 0.95: waiting on the target alone would accept a window that stops just
  // past it, and #407's subject is the partly-parsed element, not the distance.
  await seekableThrough(page, 1);
  await media(page).evaluate((el: HTMLVideoElement) => {
    el.pause();
    el.currentTime = 0.95;
  });
  // One derived step either side of the target, both ends measured rather than
  // picked for comfort. Every engine parks the playhead at exactly 0.95 for
  // this write — 6 of 6 on webkit, 4 of 4 on chromium and 4 of 4 on firefox,
  // run locally on an idle machine, each reading 0.95 against a grid the input
  // reported as min=0 step=0.05 max=1. The slack is a whole step and not the
  // half `settledAt` allows the control, because a frame-boundary snap on a
  // re-encoded fixture is bounded by a frame and a frame at any ordinary rate
  // is longer than half a step's 25ms. What the lower bound must not do is
  // admit 0, which is exactly where the defect above lands: 0.9 is eighteen
  // steps clear of it. And the bound is closed at the top, where the far end
  // needed `max: Infinity` — WebKit settles a fraction PAST 1 once the clip
  // ends (observed 1.000122584-1.000185166), and a mid-clip seek has no such
  // overshoot to allow for.
  await settledAt(page, 'seek-slider-input', 0.95, 'currentTime', {
    min: 0.9,
    max: 1
  });

  // A single click, not a drag — a synthesized drag across a range input was
  // rejected here earlier as engine-flaky and stays rejected. A click is a
  // different gesture, and clicking the near end of a track was measured
  // deterministic on chromium and firefox. Same gesture on both controls, and
  // in both cases the value it asks for is the minimum.
  const seekBox = (await seekSliderInput(page).boundingBox())!;
  await page.mouse.click(seekBox.x + 1, seekBox.y + seekBox.height / 2);
  await expect
    .poll(() => media(page).evaluate((el: HTMLVideoElement) => el.currentTime))
    .toBe(0);

  // The volume slider sits at its default of 1 and nothing but a control moves
  // it, so its near end is somewhere it is not. Settled on the control as well
  // as on the media element, the same precondition the seek click gets above:
  // a click that asks a range input for the value it already holds fires
  // nothing.
  await settledAt(page, 'volume-slider', 1, 'volume', { min: 1, max: 1 });
  const volumeBox = (await volumeSlider(page).boundingBox())!;
  await page.mouse.click(volumeBox.x + 1, volumeBox.y + volumeBox.height / 2);
  await expect
    .poll(() => media(page).evaluate((el: HTMLVideoElement) => el.volume))
    .toBe(0);
});

// #191: both controls remain operable by KEYBOARD, in both directions, with
// the resulting value still reaching the media element. One test per control,
// each starting from a position it puts there itself through the media
// element — a leg that inherits where another gesture left a control is a leg
// whose precondition is someone else's outcome.
//
// End/Home rather than the arrows, and not for convenience: per ADR-0005 the
// shortcut layer owns every arrow REGION-WIDE and calls preventDefault()
// whatever the focused target, so an arrow press never reaches either input —
// it seeks 5s through `seekBy` or moves volume 0.05 through `setVolume`, and
// would pass here with both controls completely broken. Home and End are bound
// to nothing in `controls.tsx`'s `defaultBindings` (checked: the ten actions
// there cover Space, k, the four arrows, j, l, PageUp, PageDown, m, f and c,
// and nothing else), so they are the only keys left that exercise the input
// itself. ADR-0005 names them as what keeps each slider operable.
//
// And End is what puts this test out of WebKit's reach, where the pointer test
// above only had to move its target. `End` asks a range input for its `max`,
// and `SeekSlider`'s `max` IS the duration, so this leg cannot ask for anything
// but the position #470 measured as non-deterministic on this engine: 7 of 25
// unretried runs read the playhead at 0 after a press whose seek the library
// had already issued and the element had already accepted. There is no
// narrower exclusion, and it was looked for. The control is not an independent
// witness here: its `value` comes from `PlayerState.currentTime` with
// `useSeekPreview` holding the requested value only until the published state
// answers for it (`react/src/optimistic-request.ts`), so on a failing run the
// seek succeeds, the element publishes 0, the preview is released and the
// control follows the media back down — which is what the pointer test's own
// failure string reported, `control 0 (target 1) / media 0`. An assertion on
// the control alone would therefore fail on exactly the runs the media
// assertion fails on, and the `Home` half degrades the other way: with the
// playhead already at 0, `toBe(0)` after `Home` is a check that cannot fail.
// The reasoning is the one `.out-of-scope/webkit-buffered-ranges.md` applies to
// relaxed assertions — a guard that cannot refuse the defect it exists for is
// worth nothing — so the whole test goes rather than half of it.
const skipWithoutWebKitEndOfMediaSeek =
  'End necessarily targets the seek slider max, which is the duration, and a seek to exactly the duration resolves at 0 on this engine for the WebM fixture this composition selects (measured: 7 of 25 unretried CI runs). See .out-of-scope/webkit-end-of-media-seek.md (#470).';

test('the seek slider stays operable by keyboard in both directions', async ({
  browserName,
  page
}) => {
  test.skip(browserName === 'webkit', skipWithoutWebKitEndOfMediaSeek);

  await page.goto(story);
  await activationButton(page).click();
  await played(page);

  // Paused and rewound, for the same reasons the pointer test pauses: a
  // running 1.000s clip reaches `>= 1` on its own inside `expect.poll`'s 5s,
  // and a paused clock only moves where a control puts it.
  await media(page).evaluate((el: HTMLVideoElement) => {
    el.pause();
    el.currentTime = 0;
  });
  await settledAt(page, 'seek-slider-input', 0, 'currentTime', {
    min: 0,
    max: 0
  });

  await seekSliderInput(page).focus();
  await page.keyboard.press('End');
  await expect
    .poll(() => media(page).evaluate((el: HTMLVideoElement) => el.currentTime))
    .toBeGreaterThanOrEqual(1);

  // The other direction. Settling here is both the assertion that End moved
  // the CONTROL — not only the media element — and the precondition that makes
  // Home a real change: the position Home asks for is the one the press before
  // it moved away from, so a control still holding it would swallow the press.
  //
  // The upper bound is left open to match the poll above it, which asks for
  // `>= 1` — the two are one assertion about the same press and would not be
  // worth reading if they disagreed about what the end of the clip is. It was
  // opened for WebKit, which settles a fraction past 1 at the end of this
  // fixture (observed 1.000122584-1.000185166; see the comment on the MP4 test
  // above) where Chromium and Firefox report exactly 1, and the skip above now
  // keeps WebKit off this line — but "reached the end" is a floor on every
  // engine, which is the reading the MP4 test takes as well.
  await settledAt(page, 'seek-slider-input', 1, 'currentTime', {
    min: 1,
    max: Infinity
  });
  await page.keyboard.press('Home');
  await expect
    .poll(() => media(page).evaluate((el: HTMLVideoElement) => el.currentTime))
    .toBe(0);
});

declare global {
  interface Window {
    // Installed by the mid-clip presses below, and their way back out.
    playdeckSeekInputEvents?: number;
    playdeckMediaSeeks?: number;
  }
}

// #383, and the half of "operable by keyboard" the test above cannot reach: it
// presses End from 0 and Home from the end, both of them positions the thumb
// reaches under any step, so the press always had somewhere to go. From
// mid-clip it did not. Measured on chromium, firefox and webkit alike with the
// media parked at 0.6 on this ~1s clip: a whole-second step against a `[0, 1]`
// window left the input two values it could keep, 0.6 rounded to the upper one,
// and the input was therefore already at its maximum — so End moved nothing,
// fired neither `input` nor `change`, and issued no seek. Nothing was swallowed
// by the library; the press never became an event at all. Home below the
// halfway mark was the mirror image, against the minimum.
//
// The step is derived from the window now (`min(1, span / 20)`, so 0.05 here),
// which is what makes mid-clip a position the thumb can be at and the press one
// with somewhere to go. An engine is the whole point: happy-dom neither
// sanitises a range input's value nor implements its key handling, so whether a
// press becomes an event is not a question the node suite can be asked.
//
// What these assert is that the press was issued as a seek, and NOT where the
// playhead settles afterwards. They asserted the latter first, and CI WebKit
// failed the End direction outright on all three attempts: `currentTime` read
// `0` every time, while the input-event counter below passed on the same
// attempts — so the press did become an event and did reach the player, and
// only the playhead assertion failed. Local WebKit passes both directions. The
// pre-existing `operable by keyboard` test above carries the identical
// `toBeGreaterThanOrEqual(1)` after its own End press and went flaky on that
// same CI run, so the assertion was fragile on this engine independently of
// #383. #470 has since measured what that fragility is: a seek to exactly
// `duration` resolves at 0.000000 on this engine for the WebM fixture this
// composition selects, on 7 of 25 unretried runs, with the library's write and
// the element's own `seeking` both reporting 1.000000 first. That is why the
// test above now carries a WebKit skip and these two do not — the seek window
// is not the variable, `el.seekable` having reached 1.000000 on every one of
// those runs, and neither is anything the library does.
//
// The `seeking` counter is the stronger statement, not the weaker one: it says
// the media element acted on a seek, which is the criterion's own wording —
// "issues a seek rather than producing no event at all" — and it holds wherever
// the engine leaves the playhead.
//
// Park, check the thumb is where the media is, install both counters, press,
// and assert the press became an input event and a seek. That is the whole of
// what each direction has to show, so the tests below are one call each.
const pressFromMidClip = async (
  page: Page,
  parkAt: number,
  key: 'End' | 'Home'
): Promise<void> => {
  await page.goto(story);
  await activationButton(page).click();
  await played(page);

  // Paused as well as parked, for the reason the tests above pause: a running
  // 1.000s clip reaches the end on its own.
  await media(page).evaluate((el: HTMLVideoElement, time: number) => {
    el.pause();
    el.currentTime = time;
  }, parkAt);
  // Approximate rather than an exact string, because the derived step is a
  // function of a fixture duration this test does not pin. What it has to
  // exclude is the defect: a thumb pinned to an end of the window, which
  // `toBe('1')` and `toBe('0')` were the measured readings of.
  await expect
    .poll(() => seekSliderInput(page).inputValue().then(Number))
    .toBeCloseTo(parkAt, 1);

  await seekSliderInput(page).focus();
  // Installed last, immediately before the press, and zeroing as it attaches.
  // The parking assignment above raises a `seeking` of its own, and this is what
  // keeps it out of the count: by here the thumb poll has seen the player
  // publish the time the media reported for that seek, so it has already
  // completed. Measured on the pre-#383 source with the poll removed, WebKit
  // counted a stray `seeking` on the Home leg — with zero input events beside
  // it, which is the shape of the parking seek and not of a press.
  const installed = await page.evaluate(() => {
    const input = document.querySelector<HTMLInputElement>(
      '[data-playdeck-part="seek-slider-input"]'
    );
    const el = document.querySelector<HTMLVideoElement>(
      '[data-playdeck-part="media"]'
    );
    if (input === null || el === null) return false;
    window.playdeckSeekInputEvents = 0;
    window.playdeckMediaSeeks = 0;
    const count = () => {
      window.playdeckSeekInputEvents =
        (window.playdeckSeekInputEvents ?? 0) + 1;
    };
    input.addEventListener('input', count);
    input.addEventListener('change', count);
    el.addEventListener('seeking', () => {
      window.playdeckMediaSeeks = (window.playdeckMediaSeeks ?? 0) + 1;
    });
    return true;
  });
  // A counter that was never installed reads 0 below, which is the failure
  // these tests are looking for. It has to be a failure of the press instead.
  expect(installed).toBe(true);

  await page.keyboard.press(key);

  // The press became an event at all — the measurement's `0 input events, 0
  // change events` is what this refuses...
  await expect
    .poll(() => page.evaluate(() => window.playdeckSeekInputEvents ?? 0))
    .toBeGreaterThan(0);
  // ...and the seek behind it reached the media element, which is the half a
  // press that moved nothing could never produce.
  await expect
    .poll(() => page.evaluate(() => window.playdeckMediaSeeks ?? 0))
    .toBeGreaterThan(0);
};

test('End from mid-clip seeks rather than landing on the value the thumb already holds', async ({
  page
}) => {
  await pressFromMidClip(page, 0.6, 'End');
});

test('Home from mid-clip seeks rather than landing on the value the thumb already holds', async ({
  page
}) => {
  await pressFromMidClip(page, 0.4, 'Home');
});

test('the volume slider stays operable by keyboard in both directions', async ({
  page
}) => {
  await page.goto(story);
  await activationButton(page).click();
  await played(page);

  // Volume is not a function of playback, so this leg does not need the clip
  // rewound — but it does need it paused, because `settledAt` will not call a
  // media element that is still reporting `timeupdate` settled.
  //
  // The starting position is written to the media element, not clicked in:
  // that keeps the press below the only control gesture in this test, so
  // `toBe(1)` after it cannot be crediting an earlier one.
  await media(page).evaluate((el: HTMLVideoElement) => {
    el.pause();
    el.volume = 0;
  });
  await settledAt(page, 'volume-slider', 0, 'volume', { min: 0, max: 0 });

  await volumeSlider(page).focus();
  await page.keyboard.press('End');
  await expect
    .poll(() => media(page).evaluate((el: HTMLVideoElement) => el.volume))
    .toBe(1);

  // As on the seek slider: the control reaching 1 and holding it is what makes
  // the Home below a change rather than a no-op.
  await settledAt(page, 'volume-slider', 1, 'volume', { min: 1, max: 1 });
  await page.keyboard.press('Home');
  await expect
    .poll(() => media(page).evaluate((el: HTMLVideoElement) => el.volume))
    .toBe(0);
});

// The forced-colors branch of the new rules, which exists for the users least
// able to absorb the original defect: both background-colors resolve to the
// same system canvas there, collapsing the two-tone layer back into one flat
// band. Same emulation harness and same "assert what the user can see" shape as
// `e2e/theme.spec.ts`, which guards none of its forced-colors tests by engine.
// The skip below is not a departure from that — it guards the precondition, not
// the forced-colors branch: this waits on `bufferedRendered` exactly as the
// visibility test does, so it inherits that precondition and the identical
// WebKit failure: measured here on its own, 8 sequential runs on an idle
// machine gave 3 passes and 5 failures, each failure the same
// `Expected: > 0 / Received: 0` on the range count, reached before any
// forced-colors assertion ran. The reason is the fixture and the engine, written up
// on `skipWithoutWebKitBuffered` above; nothing about forced colors is
// engine-specific here, and this test returns to WebKit the moment that record
// does.
test('the buffered indicator stays distinguishable in forced-colors mode', async ({
  browserName,
  page
}) => {
  test.skip(browserName === 'webkit', skipWithoutWebKitBuffered);

  await page.emulateMedia({ forcedColors: 'active' });
  await page.goto(story);
  await activationButton(page).click();
  await played(page);
  await bufferedRendered(page);

  const forced = await page.evaluate(() => {
    const read = (selector: string) => {
      const style = getComputedStyle(document.querySelector(selector)!);
      return {
        backgroundColor: style.backgroundColor,
        border: style.borderTopWidth
      };
    };
    return {
      container: read('[data-playdeck-part="seek-buffered"]'),
      range: read('[data-playdeck-part="seek-buffered-range"]')
    };
  });

  // An outlined track and a filled range, the treatment the shipped theme
  // gives these same parts: the border is what still says "here is the track"
  // once the system palette has flattened the fill.
  expect(forced.container.border).toBe('1px');
  expect(forced.range.backgroundColor).not.toBe(
    forced.container.backgroundColor
  );
  expect(alphaOf(forced.range.backgroundColor)).toBeGreaterThan(0);
});

test('the settings menu changes the playback rate on the media element', async ({
  page
}) => {
  await page.goto(story);
  await activationButton(page).click();
  await played(page);

  await settingsTrigger(page).click();
  await expect(settingsMenu(page)).toHaveAttribute(
    'data-playdeck-menu',
    'open'
  );
  // exact: true — Playwright name matching is a substring match, and "1.5x"
  // is a substring of nothing here only by luck.
  await page.getByRole('menuitemradio', { name: '1.5×', exact: true }).click();

  await expect
    .poll(() => media(page).evaluate((el: HTMLVideoElement) => el.playbackRate))
    .toBe(1.5);
});

// Shared by both HLS-swap tests below. The example no longer forces an
// engine (`source: { type: 'hls', src: '/hls/master.m3u8' }`), so this swap
// lets each browser resolve HLS the way a consumer's would, via
// `HTMLVideoElement.canPlayType`. Measured directly (see the quality-ladder
// test below): both Chromium and WebKit report non-empty support for the HLS
// MIME type and resolve to the native engine; only Firefox reports none and
// resolves to hls.js.
const swapToHls = async (page: Page): Promise<void> => {
  await page.goto(story);
  await activationButton(page).click();
  await played(page);

  await page.getByTestId('reference-source-hls').click();
  // A source change resets activation to dormant rather than remounting Root,
  // so the overlay returns and the new source needs one more click. Confirmed
  // by hand in Task 4: the overlay genuinely reappears.
  await expect(activationButton(page)).toBeVisible();
  await activationButton(page).click();
  await played(page);
};

test('swapping MP4 to HLS keeps the controls live', async ({ page }) => {
  await swapToHls(page);

  // The controls survived the swap on the same Root.
  await muteButton(page).click();
  await expect(muteButton(page)).toHaveAttribute('data-state', 'muted');
});

test('swapping MP4 to HLS populates the quality ladder', async ({
  browserName,
  page
}) => {
  // Only the hls.js engine populates `PlayerState.qualities` (see
  // provider-hls); native HLS leaves it empty by design, so the menu section
  // is legitimately absent there. The example no longer forces `engine:
  // 'hls.js'` (that put an hls.js flow on WebKit, see e2e/hls.spec.ts:28,46-49
  // for why this repo doesn't rely on that combination) — auto-detection asks
  // each browser's own `HTMLVideoElement.canPlayType`, and measured directly:
  // Chromium and WebKit both report non-empty support for the HLS MIME type,
  // so `selectHlsEngine` resolves them to 'native' the same as forced native
  // would; only Firefox reports no native support and resolves to hls.js.
  // Scoped to the one browser where that's actually true, rather than
  // Chromium as `hls.spec.ts:28`'s *forced*-engine comment might suggest.
  test.skip(
    browserName !== 'firefox',
    "Only the hls.js engine enumerates PlayerState.qualities; under auto-detection, Firefox is the only project whose canPlayType reports no native HLS support, so it's the only one that resolves to hls.js here."
  );

  await swapToHls(page);

  // #81's ladder, from the fixture manifest's two variants (320x180, 160x90).
  // Observed labels under HLS in Task 4: 'Auto (180p)', '90p', '180p'. Assert
  // the two fixed rung labels only — the auto row's parenthesised height
  // reflects whichever rung hls.js had resolved when the menu opened.
  await settingsTrigger(page).click();
  const quality = page.getByRole('group', { name: 'Quality', exact: true });
  await expect(quality).toBeVisible();
  await expect(
    quality.locator('[data-playdeck-part="menu-radio-item"]')
  ).toHaveCount(3);
  await quality
    .getByRole('menuitemradio', { name: '90p', exact: true })
    .click();

  await settingsTrigger(page).click();
  await expect(
    page
      .getByRole('group', { name: 'Quality', exact: true })
      .getByRole('menuitemradio', { name: '90p', exact: true })
  ).toHaveAttribute('aria-checked', 'true');
});

test('the control row does not overflow at 320px, and hides the volume slider below the 420px breakpoint', async ({
  page
}) => {
  // #32's 1.4.10 reflow check has to pass by construction on the very artifact
  // it is pointed at, not be discovered later. This is also the defect
  // Theme/Theme still admits: at 480 its row overflowed by 49px once
  // AirPlayButton made it six buttons.
  //
  // The overflow assertions below hold at 320px regardless of the
  // `@container (max-width: 420px)` volume-slider rule, because
  // `.playdeck-example-row-buttons` sets `flex-wrap: wrap` — the row cannot
  // overflow horizontally either way. What actually exercises that
  // breakpoint is the volume-slider visibility check that follows: hidden at
  // 320px, visible again at 480px (comfortably above the breakpoint).
  await page.setViewportSize({ width: 320, height: 640 });
  await page.goto(story);
  await activationButton(page).click();
  await played(page);

  const row = controls(page);
  await expect(row).toBeVisible();
  const overflow = await row.evaluate((el) => el.scrollWidth - el.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);

  const page320 = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth
  }));
  expect(page320.scrollWidth).toBeLessThanOrEqual(page320.clientWidth);

  await expect(volumeSlider(page)).toBeHidden();

  await page.setViewportSize({ width: 480, height: 640 });
  await expect(volumeSlider(page)).toBeVisible();
});

test('the volume slider hides on the player width, not the viewport width', async ({
  page
}) => {
  // The breakpoint test above resizes the viewport, which narrows the player
  // too, so it cannot tell a viewport query from a container query. This can:
  // the viewport stays wide and only the player is narrow, which is what an
  // embedded player in a sidebar actually looks like. Against a
  // `@media (max-width: 420px)` rule the slider stays visible and this fails.
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto(story);
  // Constrain the CONTAINING element, not the player: that is what an embed in
  // a narrow column does, and the player's own `width: 100%` then resolves to
  // 320px. Styling `.playdeck-example` directly does not work anyway — the story
  // injects its stylesheet from the body, so a rule added here loses on
  // document order at equal specificity (measured: the player stayed 768px).
  await page.addStyleTag({ content: '#storybook-root { width: 320px; }' });
  await expect
    .poll(() =>
      page
        .locator('.playdeck-example')
        .evaluate((el) => el.getBoundingClientRect().width)
    )
    .toBeLessThanOrEqual(320);

  await activationButton(page).click();
  await played(page);

  await expect(
    page.locator('[data-playdeck-part="volume-slider"]')
  ).toBeHidden();

  // And the viewport really was wide throughout — otherwise this would be the
  // same assertion as the test above, passing for the wrong reason.
  const width = await page.evaluate(() => document.documentElement.clientWidth);
  expect(width).toBeGreaterThan(420);
});

test('a narrow container keeps the 16:9 floor and puts the row in flow', async ({
  page
}) => {
  // #114. The container query used to fire alone here: the volume slider hid,
  // but the box stayed locked to `aspect-ratio: 16 / 9` and the row stayed an
  // absolutely-positioned overlay covering 153px of those 180 — measured, with
  // the media element itself only 150px tall underneath it. The 320px viewport
  // path has always stacked instead (measured 336 = 180 media + 153 row),
  // because `Player.Media` is in flow; this is that outcome, on the axis that
  // an embed in a narrow column actually varies.
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto(story);
  await page.addStyleTag({ content: '#storybook-root { width: 320px; }' });

  const player = page.locator('.playdeck-example');
  await expect
    .poll(() => player.evaluate((el) => el.getBoundingClientRect().width))
    .toBeLessThanOrEqual(320);

  await activationButton(page).click();
  await played(page);

  // The media and the row both take part in flow, so the box is the sum of
  // them rather than a 16:9 lid clamped over both: 320 x 9 / 16 = 180 was the
  // old ceiling and the row alone is 153 of it. Measured at 303 after the fix;
  // asserted as a relation, because the media element's own height depends on
  // the fixture's intrinsic ratio.
  const height = await player.evaluate((el) =>
    Math.round(el.getBoundingClientRect().height)
  );
  expect(height).toBeGreaterThan(180);

  const mediaHeight = await media(page).evaluate((el) =>
    Math.round(el.getBoundingClientRect().height)
  );
  const rowHeight = await controls(page).evaluate((el) =>
    Math.round(el.getBoundingClientRect().height)
  );
  // Stacked, not overlaid: neither one is hidden behind the other.
  expect(height).toBeGreaterThanOrEqual(mediaHeight + rowHeight);

  expect(
    await controls(page).evaluate((el) => getComputedStyle(el).position)
  ).toBe('relative');

  // And the viewport really was wide throughout, or this is the 320px viewport
  // test again, passing for the wrong reason.
  expect(
    await page.evaluate(() => document.documentElement.clientWidth)
  ).toBeGreaterThan(420);
});

// PiP is capability-gated, and the capability is a property of the engine
// BUILD rather than of the browser name: Firefox has no programmatic PiP at
// all, and Playwright's Linux WebKit reports none either while macOS WebKit
// does — measured, as two tests that passed locally on webkit and failed on
// the same project in CI. So ask the media element, the way
// `e2e/platform.spec.ts:23-51` derives its own expectation, instead of
// encoding a browser list that is wrong on one platform.
//
// Call it after activation: there is no <video> in the document before that.
const pipIsAvailable = (page: Page): Promise<boolean> =>
  page.evaluate(() => {
    const media = document.querySelector('video') as
      (HTMLVideoElement & Record<string, unknown>) | null;
    if (media === null || media.disablePictureInPicture === true) return false;
    if (typeof media.requestPictureInPicture === 'function')
      return document.pictureInPictureEnabled !== false;
    return (
      typeof media.webkitSupportsPresentationMode === 'function' &&
      (media.webkitSupportsPresentationMode as (mode: string) => boolean)(
        'picture-in-picture'
      ) === true
    );
  });

const skipWithoutPip =
  'This engine build exposes no Picture-in-Picture, so neither the button nor the folded menu entry renders at any width.';

test('a narrow container folds PiP into the settings menu', async ({
  page
}) => {
  // The row holds 6 targets at 320px (312px of content, 44px targets, 4px
  // gaps) and wants 8, so two wrap and the button row doubles to 92px. The
  // volume slider is redundant with the mute button and is simply hidden; PiP
  // and AirPlay are unique functionality, so they move rather than vanish.
  //
  // AirPlay is asserted only as absent from the row: it is capability-gated on
  // a WebKit-only API, so on chromium its button and its menu entry are both
  // legitimately missing and there is nothing to prove about the fold.
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto(story);
  await page.addStyleTag({ content: '#storybook-root { width: 320px; }' });
  await activationButton(page).click();
  await played(page);
  test.skip(!(await pipIsAvailable(page)), skipWithoutPip);

  await expect(pipButton(page)).toBeHidden();
  await expect(airPlayButton(page)).toBeHidden();

  // One line: the button row is exactly one 44px target tall.
  const buttonRow = page.locator('.playdeck-example-row-buttons');
  expect(
    await buttonRow.evaluate((el) =>
      Math.round(el.getBoundingClientRect().height)
    )
  ).toBe(44);

  // The function did not disappear with the button.
  await settingsTrigger(page).click();
  await expect(
    page.getByRole('menuitem', { exact: true, name: 'Picture in picture' })
  ).toBeVisible();
});

test('a wide player keeps PiP as a button, not a menu item', async ({
  page
}) => {
  // The other half of the fold: both forms are rendered and the container
  // query hides whichever does not apply, so the same action offered twice at
  // one width is the failure mode this catches.
  await page.goto(story);
  await activationButton(page).click();
  await played(page);
  test.skip(!(await pipIsAvailable(page)), skipWithoutPip);

  await expect(pipButton(page)).toBeVisible();

  await settingsTrigger(page).click();
  await expect(
    page.getByRole('menuitem', { exact: true, name: 'Picture in picture' })
  ).toBeHidden();
});

// AirPlay is hardcoded unavailable on both iframe providers — a static
// `{ status: 'unavailable', reason: 'provider' }` (Vimeo) / `providerUnavailable`
// constant (YouTube) that is never reassigned in either adapter — so asserting
// it hidden immediately after activation is safe on both, no settle time needed.
for (const provider of ['youtube', 'vimeo'] as const) {
  test(`@real capability gating hides AirPlay on ${provider}`, async ({
    page
  }) => {
    await page.goto(story);
    await page.getByTestId(`reference-source-${provider}`).click();
    await activationButton(page).click();

    await expect(playButton(page)).toHaveAttribute('data-provider', provider);
    await expect(airPlayButton(page)).toHaveCount(0);
  });
}

// PiP is NOT symmetric the way AirPlay is. YouTube hardcodes it unavailable
// (`pictureInPicture: providerUnavailable` in provider-youtube/src/index.ts,
// never reassigned), so — like AirPlay above — it is safe to assert hidden
// immediately.
test('@real capability gating hides PiP on youtube', async ({ page }) => {
  await page.goto(story);
  await page.getByTestId('reference-source-youtube').click();
  await activationButton(page).click();

  await expect(playButton(page)).toHaveAttribute('data-provider', 'youtube');
  await expect(pipButton(page)).toHaveCount(0);
});

// Vimeo's adapter defaults `pictureInPicture` to `available` and only
// downgrades it after a *failed* `requestPictureInPicture` call
// (provider-vimeo/src/index.ts) — Vimeo's SDK genuinely exposes native PiP, so
// the button renders rather than disappearing. Measured across repeated runs:
// it appears ~300-900ms after the `data-provider` match, once the SDK attaches,
// and stays. Asserting it hidden (as AirPlay is) would only pass by the race of
// the assertion running before that attach completes — confirmed flaky by
// sampling the DOM on a tight poll, so this asserts the settled, correct state
// instead, with the same generous timeout the other @real specs use for
// provider round-trips.
test('@real capability gating leaves PiP available on vimeo', async ({
  page
}) => {
  await page.goto(story);
  await page.getByTestId('reference-source-vimeo').click();
  await activationButton(page).click();

  await expect(playButton(page)).toHaveAttribute('data-provider', 'vimeo');
  await expect(pipButton(page)).toBeVisible({ timeout: 30_000 });
});
