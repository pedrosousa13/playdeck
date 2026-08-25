import { expect, test, type Page } from '@playwright/test';
import {
  activationButton,
  media,
  seekSliderInput,
  volumeSlider
} from './locators';

// #271, driven through #67's composed example the way a consumer would: the
// volume and seek controls are both controlled by state the media element only
// publishes from its own asynchronous events, and a press landing before that
// state catches up used to be discarded with no feedback. Every gesture below
// is made while the player is still catching up from the press before it, and
// nothing here waits for the media element to go quiet first — a test that only
// passes because it waited proves the opposite of what this file is for.
//
// WebKit, for whoever meets a red run on it: CI has run all four of these on
// that engine, and three of them are excluded from it as a result. Each of the
// three is skipped at the top of its own test with the issue that accounts for
// it. The volume `End`/`Home`/`End` gesture runs on all three engines.
//
// The two arrow gestures were flaky on WebKit and are excluded under #278.
// Playwright's injected key events return to WebKit's task queue between one
// event and the next, so a queued `volumechange` and the state publish behind
// it run in that gap, and a gesture that needs N presses inside one round trip
// cannot be constructed on that engine at all. Measured across four congestion
// shapes, both dispatch modes and burns from 0 to 400, WebKit fails at every
// setting including a burn of 0, and its spread grows with the burn, so more
// congestion is strictly worse. This says nothing about the library: the fix is
// engine-independent and the unit tests cover it directly. Driven on WebKit by
// hand with the control row forced visible, these same gestures reproduce the
// defect against the pre-fix source (`[1, 1, 1]`, the player left silent) and
// pass against this one.
//
// The seek gesture failed outright on the WebKit leg under #277 and was
// excluded from it. Its `shown` assertion passed — `[0, 1, 0]`, every press
// seen, the optimistic render working — and what failed is that the media never
// arrived: the input was polled 14 times across 5 seconds and read `"0"` every
// time, and since `useSeekPreview` holds a requested value for 2000ms after the
// chain drains, a seek that had been issued would have shown. That was read at
// the time as the third `End` issuing no seek request at all. That reading was
// wrong: with the media element instrumented, the third press does issue its
// seek, and what the poll caught is one of the two failure modes below.
//
// It ran on WebKit again under #384, as an experiment rather than a claim that
// the defect was gone, and the experiment came back negative. The same
// assertion failed with the same values — `"1"` expected, `"0"` read. It was
// flaky rather than cleanly red: it failed a first attempt and passed a later
// one, so the leg was green and the failure was visible only in the log. It is
// excluded from WebKit again for that reason, under #344's criterion 18 — a
// green run has to mean every test passed on its first attempt, and a
// knowingly-flaky test on `main` spends a retry and hides the next flake behind
// itself, which is how this defect stayed unnoticed in the first place.
//
// What the experiment bought is one mechanism struck off, not a cause. The
// control used to hand its input values the input cannot keep — a ~1s window
// under the default 1s step leaves it two — which desynchronises React's value
// tracker from the DOM permanently, and React then drops a change event whose
// value matches what the tracker holds. That was the only mechanism anyone had
// that produces this exact shape; #384 fixed it at the source in `SeekSlider`
// and the failure survived it, so it is not the cause.
//
// Ruled out and carried forward: the media element, the command path, a bare
// range input, and the spacing of the presses. And it has NEVER been reproduced
// on a local WebKit — ~70 runs of exactly this gesture across congestion burns
// of 0 to 400, a `currentTime` setter answering up to 400ms late so all three
// presses genuinely land inside one round trip, and one and four workers, all
// green.
//
// The instrumentation was then built and run on the CI leg — per press, the
// `input`/`change` events, the DOM value, `input._valueTracker.getValue()` and
// a `MutationObserver` over the input's attributes, alongside a probe on the
// media element recording every `currentTime` assignment and every seek event.
// It took three CI runs on the diagnostic branch below, and they are not
// interchangeable. Run `32399893169` ran the gesture once, before sampling
// existed, and was green: what it bought is the healthy WebKit control trace,
// in which the presses land ~56ms apart (2646, 2704, 2758) against ~4ms on
// chromium (1110, 1115, 1118). Run `32400760686` sampled the gesture 15 times
// with `retries: 0`, instrumenting the input and React layer only, and 4 of
// those samples failed (samples 2, 3, 5 and 9). Run `32402015727` sampled 15
// times the same way with the media-element probe added: 10 failed and 5
// passed. So two of the three runs sampled, at 4 of 15 and then 10 of 15 first
// attempts, and the single attempt an ordinary run gives this gesture was
// never going to catch it reliably.
//
// This header used to predict the opposite, and the prediction is corrected
// here rather than dropped: whoever re-enabled the gesture to collect the
// instrumentation was told to expect it to pass most attempts. With the media
// probe installed it failed 10 of 15.
//
// It is a WebKit bug, and there is nothing in this library to fix. That rests
// on run `32402015727` alone, since it is the only one that watched the media
// element. All 15 of its samples, failing and passing alike, issued the
// identical four `currentTime` assignments — `0` (this test's own parking
// assignment), then `1`, `0`, `1`. What differed was WebKit's final `seeked`.
// Nine of its ten failures were examined — eight in one batch comparison, plus
// sample 1 read on its own, leaving sample 0 unexamined — and every one of the
// nine reported `currentTime: 0`, the superseded target; all five passes
// reported `currentTime: 1`. Sample 1's tail, verbatim: `setCurrentTime to:1
// from:0` / `setCurrentTime to:0 from:1` / `setCurrentTime to:1 from:0` /
// `seeking currentTime:1` / `seeked currentTime:0`. WebKit accepts the third
// assignment, reports `currentTime` as `1` and fires `seeking` at `1`, and then
// completes the seek at `0` — resolving the in-flight seek to the superseded
// position and discarding the newer request it had already reported as the
// official playback position. The media element is in the ruled-out list above;
// that entry no longer holds.
//
// So the third press does issue its seek. In every failing sample that was
// examined it fired a complete `keydown`, `input` and `change`, against
// `max="1"`, `data-state="ready"`, a connected node and focus still on the seek
// input, with the change carrying `value:"1"` and `tracked:"1"`. That rules
// out: React's `_valueTracker` dedupe, since every press produced both an
// `input` and a `change`; a null seek window, the `max` blip to `0` this header
// used to name as the remaining suspect, since `max` never left `"1"` and
// `data-state` never left `ready`; focus loss and node replacement, since
// neither happened; and press spacing once more, since a sample failed with
// 53-59ms gaps, the same spacing as samples that passed.
//
// Two failure modes have been seen, and they are NOT established as one cause.
// Run `32400760686` produced both: sample 3 failed `toHaveValue("1")` reading
// `"0"`, which is the mode the original sighting above records, while samples
// 2, 5 and 9 failed the `currentTime` assertion with the input correctly
// reading `"1"`. Both sit downstream of the same WebKit behaviour — the media
// parks at `0` either way — but what selects between them was never
// instrumented. One unexamined path, a hypothesis and not a finding:
// `createCommandChain` calls `onDrained(ok)` when the chain empties and
// `useSeekPreview` clears the requested value at once when `ok` is false, so a
// command counted as failed would release the preview immediately and drop the
// control to `"0"` instead of holding `"1"` until the echo deadline.
//
// The gesture therefore stays excluded from WebKit permanently. #344's
// criterion 18 is still what requires the exclusion, on the same grounds as
// above; what has changed is that it is no longer pending an investigation,
// because the cause is an engine bug this library cannot fix. The diagnostic
// branch `pedrosousa13/issue-277-on-webkit-the-third-of-three` (PR #386,
// closed) and the three run IDs above are what is left to re-read the traces
// from.
//
// This no longer has to wait for CI. It used to: every test in this file failed
// on the arrangement locally, and the reason recorded here was that a locally
// installed Playwright Linux WebKit has no H.264. That reason was wrong, and it
// cost this issue its whole "CI only" framing. The engine never got as far as a
// decoder. `'/tracer.mp4'` was stamped `video/mp4` from its extension and
// rendered as a lone `<source type="video/mp4">`, which WebKit rejects during
// source selection — `networkState` 3, `currentSrc` empty, no request issued at
// all — so the composition sat at `activation: 'loading-provider'` with its
// control row `hidden`. The reference example now offers the same clip as both
// MP4 and WebM (`stories/reference/reference-player.tsx`), an engine with an
// H.264 decoder still takes the MP4, and this file runs on a locally installed
// WebKit. HLS is the one thing that genuinely does need the codec, so
// `e2e/reference.spec.ts`'s HLS swap is still CI-only.

const story = '/iframe.html?id=reference-player--real-sources&viewMode=story';

// Both local fixtures are ~1 SECOND long, so `data-state="playing"` is a state
// the clip leaves on its own and asserting it is a race; `currentTime > 0` is
// the race-free way to say "it actually played" (e2e/reference.spec.ts).
//
// 15s rather than `expect.poll`'s 5s default, for the reason and the numbers
// recorded on `played()` there too: WebKit under contention ran the default out
// (#408). The one call site below sits in a test this file skips on WebKit
// (#277), so #408's fix cannot reach it — this carries the timeout to keep the
// three copies of the helper identical, and it starts mattering only if that
// exclusion lifts. Past 15s, read it as the wedge (#411) rather than a short
// wait.
const played = (page: Page) =>
  expect
    .poll(
      () => media(page).evaluate((el: HTMLVideoElement) => el.currentTime),
      {
        timeout: 15_000
      }
    )
    .toBeGreaterThan(0);

type PressRecord = {
  // What the control was showing when the press was made.
  readonly shown: number;
  // How many of the presses before it the media element had answered for by
  // then. The media element's own `volume` and `currentTime` properties are no
  // use here: a command sets one synchronously, and it is the *event* announcing
  // it that published state waits for, so the count of those events is what says
  // whether the player had caught up.
  readonly answered: number;
};

declare global {
  interface Window {
    // Installed by `recordPresses`, read back by `presses` and `echoes`.
    playdeckPresses?: PressRecord[];
    playdeckEchoes?: number[];
    // Installed by `underCongestion`, and its way back out.
    playdeckStopCongestion?: () => void;
  }
}

// How long one congestion turn burns the main thread for. Measured on this
// composition at 50ms: an echo lands ~55ms after the press that caused it (one
// turn), and the presses of one gesture land within ~10ms of each other, so a
// gesture fits inside a single window with room either side.
const CONGESTION_BURN_MS = 50;

// Congest the main thread for the duration of one gesture, on every engine.
//
// What this buys is worth stating exactly, because it is easy to credit it with
// the wrong half. It is NOT what opens the swallow window: measured at a burn
// of 0, with nothing else changed, the volume gestures below still fail against
// the pre-fix source on chromium and still pass against this one. Pipelining
// the presses (`pressTogether`) is what puts them inside one round trip.
//
// What the congestion does is keep them there on a machine that would otherwise
// let an echo land between two of them, and so it defends the `answered` guard
// each gesture ends with — the assertion that refuses a run in which the
// presses stopped being one gesture. Measured across 24 pipelined presses: the
// media element had answered twice by the last of them on firefox with the
// congestion off, and not once with it on, on either engine.
//
// It is built out of what every engine already has: a task that burns a slice
// of CPU and then reschedules itself. Anything the page queues while a turn is
// running — the media element's `volumechange`, the state publish it drives,
// React's commit — waits for that turn to end. Playwright's CPU throttling is
// `Emulation.setCPUThrottlingRate` over CDP and reaches chromium alone, so a
// CDP-only technique would leave the other two engines with no defence here at
// all.
//
// Self-rescheduling rather than one long block, because a block long enough to
// matter would also swallow the presses under test and Playwright's own round
// trips: the page has to stay slow, not stop. The stopper runs in a `finally`
// so a failed assertion cannot leave a page burning CPU, and it is read back
// out of the page rather than assumed, so a congestion loop that never started
// is a failure rather than a quiet pass.
const underCongestion = async (
  page: Page,
  gesture: () => Promise<unknown>
): Promise<void> => {
  await page.evaluate((burn) => {
    let stopped = false;
    const turn = (): void => {
      if (stopped) return;
      const until = performance.now() + burn;
      while (performance.now() < until) {
        // Burn it. A loop and not a `while (true)`: the turn has to end.
      }
      setTimeout(turn, 0);
    };
    setTimeout(turn, 0);
    window.playdeckStopCongestion = () => {
      stopped = true;
    };
  }, CONGESTION_BURN_MS);

  let stopped: boolean;
  try {
    await gesture();
  } finally {
    stopped = await page.evaluate(() => {
      if (window.playdeckStopCongestion === undefined) return false;
      window.playdeckStopCongestion();
      window.playdeckStopCongestion = undefined;
      return true;
    });
  }
  // After the `finally`, not inside it: a gesture that threw keeps its own
  // failure rather than having this one reported over the top of it.
  expect(stopped).toBe(true);
};

// Press every key without waiting for the renderer to acknowledge the one
// before it. This, and not the congestion, is what puts the presses inside one
// round trip.
//
// Sent one at a time, each press costs a whole congestion turn (measured at a
// 50ms burn: ~110ms between presses, against a ~55ms echo), so every press
// would land after the previous one had already been answered — the quiescence
// wait this file exists to avoid, arrived at by accident. Measured on the
// five-press gesture below, sequentially: the media element had answered for 2
// to 4 of them by the last press, against 0 for the same five pipelined.
//
// Pipelined, all of them are queued before the renderer next drains, and they
// land within ~10ms of each other on chromium and firefox. Only the keydowns
// matter to either control, and they are dispatched in call order.
const pressTogether = (page: Page, keys: readonly string[]): Promise<unknown> =>
  Promise.all(keys.map((key) => page.keyboard.press(key)));

// Record what each control was showing at the moment of each press, and what
// the media element published in answer.
//
// A capture-phase listener on the window runs before React's handler and before
// the browser applies the key, so entry `i` is the state press `i` was made
// against — the effect of press `i - 1`. That is the only place an intermediate
// press is observable at all: reading the value back through Playwright costs a
// round trip that the echo wins, and the read would then be the wait this file
// must not depend on.
const recordPresses = (
  page: Page,
  part: 'seek-slider-input' | 'volume-slider',
  echo: {
    readonly event: 'seeked' | 'volumechange';
    readonly of: 'currentTime' | 'volume';
  }
): Promise<void> =>
  page.evaluate(
    ([selector, event, property]) => {
      const input = document.querySelector<HTMLInputElement>(selector);
      const element = document.querySelector('video');
      if (input === null || element === null) {
        throw new Error(`Nothing to record: ${selector}`);
      }
      const answers: number[] = [];
      window.playdeckPresses = [];
      window.playdeckEchoes = answers;
      window.addEventListener(
        'keydown',
        () => {
          window.playdeckPresses?.push({
            shown: Number(input.value),
            answered: answers.length
          });
        },
        true
      );
      element.addEventListener(event, () => {
        answers.push(element[property]);
      });
    },
    [`[data-playdeck-part="${part}"]`, echo.event, echo.of] as const
  );

const presses = (page: Page): Promise<PressRecord[]> =>
  page.evaluate(() => window.playdeckPresses ?? []);

const shown = async (page: Page): Promise<number[]> =>
  (await presses(page)).map((press) => press.shown);

const echoes = (page: Page): Promise<number[]> =>
  page.evaluate(() => window.playdeckEchoes ?? []);

// The presses outran the echo: by the last of them the media element had
// announced at most one answer to the ones before it. Without this a gesture
// that quietly stopped being a gesture — presses spread far enough apart that
// each is answered before the next — would pass every other assertion in this
// file, because the controls are correct under that shape too. It is the only
// thing that makes these tests about #271 rather than about volume and seeking
// in general.
//
// One answer of slack, not zero, on both sides of the measurement. Pipelined
// under congestion it reads 0 on both engines at both lengths tried (5 and 24
// presses), so a slower runner has an interleave to spend before it goes red.
// And it still refuses the shape it exists to refuse: sent one at a time, those
// same five read 2 to 4 by the last press and those same 24 read 20. A bound
// proportional to the burst — `answered < keys - 1` — would have let the low
// end of that straight through.
const outranTheEcho = async (page: Page): Promise<void> => {
  const records = await presses(page);
  expect(records.length).toBeGreaterThan(0);
  expect(records[records.length - 1]!.answered).toBeLessThanOrEqual(1);
};

// The volume path never reaches the decoder, so the gestures below need the
// control on screen and nothing else — no playback, and so nothing between the
// test and what it is proving. The composed example only shows its control row
// once activation reaches `ready`, which is what this waits for.
const activateForVolume = async (page: Page): Promise<void> => {
  await page.goto(story);
  await activationButton(page).click();
  await expect(volumeSlider(page)).toBeVisible();
  // Focus, never click: a click on a range input sets its value from where the
  // pointer landed, and the gesture would start from somewhere nobody chose.
  await volumeSlider(page).focus();
  await recordPresses(page, 'volume-slider', {
    event: 'volumechange',
    of: 'volume'
  });
};

test('the volume control keeps End, Home and End pressed inside one round trip', async ({
  page
}) => {
  await activateForVolume(page);

  await underCongestion(page, () =>
    pressTogether(page, ['End', 'Home', 'End'])
  );

  // A media element's own default volume is the maximum, so the first `End`
  // asks for a value the input already holds and fires no event — and that is
  // precisely the state the swallow used to bite in. `Home` moved the input to
  // 0, React restored it to the published maximum before the third press
  // arrived, and `End` then found the input already at the value it asks for.
  // A range input fires no event for that, so the press vanished and the player
  // was left silent on `Home` — measured, as the pre-fix run of this test:
  // `[1, 1, 1]` here and 0 below.
  expect(await shown(page)).toEqual([1, 1, 0]);

  // And the presses landed inside one round trip: the 0 above was the volume
  // the user had asked for, not one published state had already caught up with.
  // Weak in this particular gesture and deliberately kept anyway — the first
  // `End` asks a media element already at the maximum for the maximum and
  // issues no command at all, so there is barely anything here to answer — which
  // is why it is the `shown` array above that carries this test.
  await outranTheEcho(page);

  await expect(volumeSlider(page)).toHaveValue('1');
  // The commands reached the media element too, and it really did go somewhere
  // and come back: it announces a change only when the value it is given
  // differs from the one it holds, so two announcements is `Home` going silent
  // and the `End` behind it returning. Counted rather than read as a
  // trajectory, because the second assignment can land before the first
  // announcement is dispatched, and both events then report the value the
  // element has settled on. The pre-fix run of this test never got past one
  // announcement, and the volume below stayed at the 0 `Home` asked for.
  await expect
    .poll(async () => (await echoes(page)).length)
    .toBeGreaterThanOrEqual(2);
  await expect
    .poll(() => media(page).evaluate((el: HTMLVideoElement) => el.volume))
    .toBe(1);
});

test('N volume arrow presses inside one round trip move N steps', async ({
  browserName,
  page
}) => {
  test.skip(
    browserName === 'webkit',
    'WebKit returns to its task queue between injected key events, so N presses cannot be put inside one round trip there (#278).'
  );

  await activateForVolume(page);

  // The arrows never reach the input: the shortcut layer owns them (ADR-0005)
  // and issues the volume change itself, so this is the second of #271's two
  // mechanisms — a base read from published state that two presses inside one
  // round trip both computed the same target from.
  await underCongestion(page, () =>
    pressTogether(
      page,
      Array.from({ length: 5 }, () => 'ArrowDown')
    )
  );

  // Every press compounded on the one before it, and every one of them was
  // visible while it was still outstanding. Pre-fix run of this test: five
  // presses that all read the published maximum and all asked for 0.95.
  expect(await shown(page)).toEqual([1, 0.95, 0.9, 0.85, 0.8]);
  // The guard that does the work in this file: five presses each answered
  // before the next is a run this gesture cannot be read off, and it is the one
  // shape under which the array above would be right for the wrong reason.
  await outranTheEcho(page);

  await expect(volumeSlider(page)).toHaveValue('0.75');
  await expect
    .poll(() => media(page).evaluate((el: HTMLVideoElement) => el.volume))
    .toBeCloseTo(0.75, 5);
});

test('volume arrow presses past the end clamp there rather than run past it', async ({
  browserName,
  page
}) => {
  test.skip(
    browserName === 'webkit',
    'WebKit returns to its task queue between injected key events, so 24 presses cannot be put inside one round trip there (#278).'
  );

  await activateForVolume(page);

  // 24 presses of a 0.05 step from the maximum: 20 of them reach 0 and the
  // four behind them have nowhere left to go.
  await underCongestion(page, () =>
    pressTogether(
      page,
      Array.from({ length: 24 }, () => 'ArrowDown')
    )
  );

  // Asserted as a shape rather than by position: one extra or one missing
  // recorded keydown — a key repeat, a stray focus event — shifts every index
  // and would fail an `at(19)` for a reason that has nothing to do with #271.
  // Every value is its predecessor a step lower, clamped at the floor, which is
  // the criterion itself: no press collapsed into the one before it, and the
  // ones past the end stayed at the end instead of running through it.
  const values = await shown(page);
  expect(values[0]).toBe(1);
  expect(values.at(-1)).toBe(0);
  expect(values).toEqual(
    values.map((value, index) =>
      index === 0
        ? value
        : Math.max(0, Math.round((values[index - 1]! - 0.05) * 100) / 100)
    )
  );
  await outranTheEcho(page);
  await expect(volumeSlider(page)).toHaveValue('0');
  await expect
    .poll(() => media(page).evaluate((el: HTMLVideoElement) => el.volume))
    .toBe(0);
});

test('the seek control keeps End, Home and End pressed inside one round trip', async ({
  browserName,
  page
}) => {
  test.skip(
    browserName === 'webkit',
    'WebKit intermittently resolves a rapid seek sequence to the superseded target rather than the last one requested, parking the media at the start of the window instead of arriving at its end (#277).'
  );

  await page.goto(story);
  await activationButton(page).click();
  await played(page);

  // Park the media at the start and hold it there. Not a wait for the player to
  // go quiet — the gesture below is made under congestion with nothing settled
  // between its presses — but the seek window is only ~1s wide, so a clip left
  // running would put the thumb somewhere else in it depending on how far it
  // had got, and the first entry of `shown` would be asserting something
  // different on every run. `Home` and `End` themselves are the two ends of the
  // window whatever the step is (#383), so the rest of the gesture is not.
  await media(page).evaluate((el: HTMLVideoElement) => {
    el.pause();
    el.currentTime = 0;
  });
  await expect(seekSliderInput(page)).toHaveValue('0');
  await seekSliderInput(page).focus();
  await recordPresses(page, 'seek-slider-input', {
    event: 'seeked',
    of: 'currentTime'
  });

  await underCongestion(page, () =>
    pressTogether(page, ['End', 'Home', 'End'])
  );

  // The thumb showed the end of the window while the media element was still at
  // the start, and the start again while nothing had answered for either. Both
  // are positions the user asked for, so neither press was lost. Pre-fix run of
  // this test: `[0, 0, 0]`, the middle `Home` swallowed by an input React had
  // already restored to 0.
  expect(await shown(page)).toEqual([0, 1, 0]);
  // Weak here for the same reason it is weak on the volume `End`/`Home`/`End`
  // gesture: a media element takes long enough to report a `seeked` that little
  // can have answered by the last press however the presses were sent. The
  // `shown` array is what carries this test.
  await outranTheEcho(page);

  await expect(seekSliderInput(page)).toHaveValue('1');
  // `>= 1` rather than exactly 1: chromium and firefox report exactly 1, and
  // WebKit settles a fraction past the end on arrival
  // (1.000122584-1.000185166) (e2e/reference.spec.ts). WebKit is the engine the
  // tolerance was widened for, and the one now excluded from this test.
  await expect
    .poll(() => media(page).evaluate((el: HTMLVideoElement) => el.currentTime))
    .toBeGreaterThanOrEqual(1);
});
