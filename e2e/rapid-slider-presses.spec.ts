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
// WebKit, for whoever meets a red run on it: the four tests in this file have
// never been observed green in-suite on WebKit anywhere, and CI is where they
// first execute on it. A locally installed Playwright Linux WebKit has no H.264
// (`canPlayType` for `avc1` is empty), so the composed example never reaches
// activation `ready`, hides its whole control row, and all four fail on the
// arrangement — identically with main's `packages/react` in place, and the
// archive records the same for the rest of the media suite. CI installs the
// codec set alongside the browser (`playwright install --with-deps` in
// `.github/workflows/ci.yml`), so CI's WebKit very likely plays the fixture.
// Driven on WebKit by hand with the control row forced visible, the volume
// gestures reproduce the defect against the pre-fix source (`[1, 1, 1]`, the
// player left silent) and pass against this one, so what is unproven there is
// the run and not the technique. The alternative was
// `test.skip(browserName !== 'chromium')`, this repo's convention wherever
// something is CDP-only, and it would have proven nothing at all on the engine
// where #271's seek failure was first seen.

const story = '/iframe.html?id=reference-player--real-sources&viewMode=story';

// Both local fixtures are ~1 SECOND long, so `data-state="playing"` is a state
// the clip leaves on its own and asserting it is a race; `currentTime > 0` is
// the race-free way to say "it actually played" (e2e/reference.spec.ts).
const played = (page: Page) =>
  expect
    .poll(() => media(page).evaluate((el: HTMLVideoElement) => el.currentTime))
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
    reelyPresses?: PressRecord[];
    reelyEchoes?: number[];
    // Installed by `underCongestion`, and its way back out.
    reelyStopCongestion?: () => void;
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
    window.reelyStopCongestion = () => {
      stopped = true;
    };
  }, CONGESTION_BURN_MS);

  let stopped: boolean;
  try {
    await gesture();
  } finally {
    stopped = await page.evaluate(() => {
      if (window.reelyStopCongestion === undefined) return false;
      window.reelyStopCongestion();
      window.reelyStopCongestion = undefined;
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
      window.reelyPresses = [];
      window.reelyEchoes = answers;
      window.addEventListener(
        'keydown',
        () => {
          window.reelyPresses?.push({
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
    [`[data-reely-part="${part}"]`, echo.event, echo.of] as const
  );

const presses = (page: Page): Promise<PressRecord[]> =>
  page.evaluate(() => window.reelyPresses ?? []);

const shown = async (page: Page): Promise<number[]> =>
  (await presses(page)).map((press) => press.shown);

const echoes = (page: Page): Promise<number[]> =>
  page.evaluate(() => window.reelyEchoes ?? []);

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
  page
}) => {
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
  page
}) => {
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
  page
}) => {
  await page.goto(story);
  await activationButton(page).click();
  await played(page);

  // Park the media at the start and hold it there. Not a wait for the player to
  // go quiet — the gesture below is made under congestion with nothing settled
  // between its presses — but the seek window is only ~1s wide and the control
  // steps by 1, so a clip left running would put the thumb at a different end
  // of that window depending on how far it had got, and the gesture would be
  // asserting something different on every run.
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
  // Measured: WebKit's currentTime after arriving at the end settles a fraction
  // past it (1.000122584-1.000185166), while chromium and firefox report
  // exactly 1 — `>= 1` is what is true on every engine (e2e/reference.spec.ts).
  await expect
    .poll(() => media(page).evaluate((el: HTMLVideoElement) => el.currentTime))
    .toBeGreaterThanOrEqual(1);
});
