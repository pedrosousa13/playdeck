import { expect, test, type Page } from '@playwright/test';
// #551: both archetypes' resume affordance seeks by calling `actions.seekTo`
// from an effect gated on `state.activation === 'ready'`. Activation readiness
// is published from inside the native provider's `attach()`, once
// `readyState >= HAVE_METADATA` -- but `attach()` returning is also the moment
// `player-controller.ts` queues `load()`, which calls `media.load()` and
// empties the element. A seek issued in that window lands on an element that
// is about to be destroyed, so the resumed position is lost and playback
// starts at 0. `PlayerState.commandsReady` is the provider's own signal for the
// end of that window; this spec pins the archetypes to using it.
//
// The assertion is a disjunction -- a `seeked` event landed near `resumeAt`, OR
// a refusal was published on `PlayerState.refusedCommand` -- rather than "the
// seek landed", because a wrong fix that instead refused every resume would be
// an unannounced regression of its own. On the unfixed examples neither
// happens: the seek is silently undone by `load()`, so the playhead settles at
// 0 with no `seeked` event near `resumeAt` and no refusal published.
//
// A one-shot `currentTime` read cannot tell the two outcomes apart: playback
// resumes right after activation, so by the time a read happens the unfixed
// player may already have played forward past `resumeAt` on its own, which
// would make a bare `currentTime >= resumeAt` poll pass for the wrong reason.
// Recording every `seeked` event's `currentTime` from a capture-phase listener
// installed before navigation (the same technique `initial-position.ts` uses
// for `loadedmetadata`) is what lets the assertion tell "the seek landed"
// apart from "playback caught up to that position on its own".
import { countProviderLoads, initialPositionApplied } from './initial-position';

// The same slack `initial-position.ts`'s specs use, mirroring the provider's
// own `SETTLED_POSITION_TOLERANCE_SECONDS`.
const TOLERANCE = 0.25;

const RESUME_AT = 5;

type Case = {
  readonly name: string;
  readonly story: string;
  readonly resumeButtonName: string;
};

const cases: readonly Case[] = [
  {
    name: 'streaming-service archetype',
    story:
      '/iframe.html?id=archetypes-streaming-service--resume-local-clip&viewMode=story',
    resumeButtonName: 'Resume from 0:05'
  },
  {
    name: 'course-platform archetype',
    story:
      '/iframe.html?id=archetypes-course-platform--resume-local-recording&viewMode=story',
    resumeButtonName: 'Resume the lesson from 0:05'
  }
];

// Records every `seeked` event's `currentTime`, capture-phase and installed
// before navigation so the listener exists before the media element does.
const recordSeeks = async (page: Page): Promise<void> => {
  await page.addInitScript(() => {
    const seeks: number[] = [];
    (window as unknown as { __resumeSeeks: number[] }).__resumeSeeks = seeks;
    document.addEventListener(
      'seeked',
      (event) => {
        const el = event.target as HTMLMediaElement;
        seeks.push(el.currentTime);
      },
      true
    );
  });
};

const seekedNearResume = (page: Page): Promise<boolean> =>
  page.evaluate(
    ({ resumeAt, tolerance }) =>
      (window as unknown as { __resumeSeeks?: number[] }).__resumeSeeks?.some(
        (position) => Math.abs(position - resumeAt) <= tolerance
      ) ?? false,
    { resumeAt: RESUME_AT, tolerance: TOLERANCE }
  );

// `!= null` on purpose: a missing handle reads as `undefined`, and a strict
// `!== null` would turn that into a refusal and pass the disjunction for a
// story whose ref never fired.
const commandRefused = (page: Page): Promise<boolean> =>
  page.evaluate(() => window.playdeckHandle?.getState().refusedCommand != null);

for (const { name, story, resumeButtonName } of cases) {
  test(`${name}: resume lands on the requested position or is refused, never silently dropped`, async ({
    browserName,
    page
  }) => {
    // WebKit does not launch in this environment.
    test.skip(browserName === 'webkit', 'WebKit cannot launch here.');

    await countProviderLoads(page);
    await recordSeeks(page);
    await page.goto(story);

    await page
      .getByRole('button', { name: resumeButtonName, exact: true })
      .click();

    await initialPositionApplied(page);

    await expect
      .poll(
        async () =>
          (await seekedNearResume(page)) || (await commandRefused(page)),
        { timeout: 15_000 }
      )
      .toBe(true);
  });
}
