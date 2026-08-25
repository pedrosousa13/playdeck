import { expect, test, type Frame, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';

declare global {
  interface Window {
    // Both recorded by `fixtures/vimeo-embed.html`; see the comments there.
    playdeckEmbedState?: { currentTime: unknown };
    playdeckEmbedRepublishReady?: () => void;
  }
}

// #329, OWASP A01. Importing `@vimeo/player` runs a module-scope block that
// installs a `window` `message` listener (`checkUrlTimeParam`,
// `@vimeo/player@2.30.4/dist/player.js:1018`, called at `:2827`). When a
// Vimeo-origin frame publishes `ready`, the listener resolves that frame's
// video id, greps the TOP-LEVEL page url for `vimeo_t_<videoId>`, and calls
// `setCurrentTime` with what it finds. The command input is therefore the
// consumer's own query string, which any third party can supply by handing a
// victim a link to the consumer's own page.
//
// These specs exercise the SHIPPED SDK in a real browser. Only the far side of
// the postMessage bridge is a stub, and it is served at the real
// `player.vimeo.com` origin, which is what the SDK's own `isVimeoUrl` gate
// keys on. That distinction is drawn out because #333 is the cautionary case:
// a fix designed against a stubbed SDK was a no-op in production. The SDK's
// `isServerRuntime` sniff is also why the happy-dom repro on the issue never
// fired — under Node the whole module-scope block is skipped.
const VIDEO_ID = '76979871';
const START_TIME = 20;
// Not zero, deliberately: a playhead that lands on an attacker's arbitrary
// number proves the value was read out of the url, where a zero could also be
// a player that simply never moved.
const CRAFTED_TIME = 45;

const embedHtml = readFile(
  new URL('./fixtures/vimeo-embed.html', import.meta.url),
  'utf8'
);

const routeVimeoEmbed = async (page: Page): Promise<void> => {
  const body = await embedHtml;
  await page.route('https://player.vimeo.com/video/**', async (route) => {
    await route.fulfill({ body, contentType: 'text/html', status: 200 });
  });
};

// The crafted link: the consumer's own page, plus the parameter.
const craftedStory = (id: string): string =>
  `/iframe.html?id=fixtures-playerfixture--${id}&viewMode=story&vimeo_t_${VIDEO_ID}=${CRAFTED_TIME}`;

const plainStory = (id: string): string =>
  `/iframe.html?id=fixtures-playerfixture--${id}&viewMode=story`;

const embedFrame = (page: Page): Frame => {
  const frame = page
    .frames()
    .find((candidate) =>
      candidate.url().startsWith('https://player.vimeo.com/video/')
    );
  if (!frame) throw new Error('The Vimeo embed frame is not attached.');
  return frame;
};

// Every `setCurrentTime` the embed received, in arrival order — the adapter's
// and the SDK's listener's alike. Which one is last is what decides where the
// viewer ends up.
const seeks = async (page: Page): Promise<unknown[]> =>
  embedFrame(page).evaluate(() =>
    (
      (window.playdeckEmbedMessages ?? []) as {
        method?: string;
        value?: unknown;
      }[]
    )
      .filter((message) => message.method === 'setCurrentTime')
      .map((message) => message.value)
  );

// The embed's own playhead. Playdeck's published `currentTime` is a mirror
// maintained from the embed's reports, so the two can disagree — and where
// they do, this is the one the viewer is watching.
const embedPlayhead = async (page: Page): Promise<unknown> =>
  embedFrame(page).evaluate(() => window.playdeckEmbedState?.currentTime);

const publishedPlayhead = (page: Page): Promise<number | undefined> =>
  page.evaluate(() => window.playdeckHandle?.getState().currentTime);

const waitForReady = async (page: Page): Promise<void> => {
  await expect
    .poll(
      () => page.evaluate(() => window.playdeckHandle?.getState().activation),
      { timeout: 60_000 }
    )
    .toBe('ready');
};

// The playhead sampled over a window long enough to contain the SDK's own
// round trip: it has to ask the embed for its video id before it can seek.
// Sampling rather than reading once is what makes a negative result mean
// something — a single read could miss a move in either direction.
const samplePlayhead = async (
  page: Page,
  durationMs: number
): Promise<number[]> => {
  const samples: number[] = [];
  const deadline = Date.now() + durationMs;
  while (Date.now() < deadline) {
    const time = await publishedPlayhead(page);
    if (typeof time === 'number') samples.push(time);
    await page.waitForTimeout(100);
  }
  return samples;
};

// The page's own escape hatch, which is also the only way left to observe the
// weakness: Playdeck's write is one-way and non-clobbering, so a page that
// pinned the guard to `false` keeps it and the SDK installs its listener as it
// always has. Every test below that needs the unguarded behaviour opts out
// this way, and each of them is therefore proof of two things at once — that
// the mechanism is real, and that Playdeck did not overwrite a value the page
// owns.
const optOutOfTheGuard = async (page: Page): Promise<void> => {
  await page.addInitScript(() => {
    (window as unknown as Record<string, unknown>).VimeoCheckedUrlTimeParam =
      false;
  });
};

// The change itself. A crafted page url reaches the embed as nothing at all:
// the only seek it receives is the adapter's own start positioning.
test('the guard stops a vimeo_t_ page-url parameter becoming a seek on the embed', async ({
  page
}) => {
  await routeVimeoEmbed(page);
  await page.goto(craftedStory('vimeo-start-time'));
  await waitForReady(page);
  await expect.poll(() => seeks(page)).toEqual([START_TIME]);

  // The parameter really was there to be read, so the silence is the guard and
  // not a url that never carried anything.
  const href = await page.evaluate(() => window.location.href);
  expect(href).toContain(`vimeo_t_${VIDEO_ID}=${CRAFTED_TIME}`);
  expect(await embedPlayhead(page)).toBe(START_TIME);
});

// ...and the same page without the guard, which is what makes the test above
// mean something. The seek arrives with the attacker's value — 45, a number
// only the url carried — and the adapter's lands after it, so at FIRST LOAD the
// start boundary survives anyway. Both chains begin at the same embed `ready`:
// the SDK's needs one round trip (`getVideoId`, then the seek), the adapter's
// needs at least two (its own readiness handshake, then the getters `adopt`
// reads). That ordering is recorded as characterisation, not as a guarantee —
// nothing on either side of the bridge promises it, which is half the reason
// the guard is worth having.
test('a page that opts out of the guard receives the crafted seek, before the adapter positions', async ({
  page
}) => {
  await routeVimeoEmbed(page);
  await optOutOfTheGuard(page);
  await page.goto(craftedStory('vimeo-start-time'));
  await waitForReady(page);

  await expect
    .poll(() => seeks(page))
    .toEqual([String(CRAFTED_TIME), START_TIME]);
  await expect.poll(() => embedPlayhead(page)).toBe(START_TIME);
  expect(Math.min(...(await samplePlayhead(page, 2_000)))).toBe(START_TIME);
});

// The exposure that survives that ordering, and the one this change is really
// for. The SDK's listener answers EVERY `ready` for the life of the page; the
// adapter positions the playhead on the first one only (`playback.ts`'s
// `adopt`, reached once per attach). So a repeat `ready` from the same embed
// carries the crafted seek with nothing behind it.
test('the guard closes the repeat-ready path', async ({ page }) => {
  await routeVimeoEmbed(page);
  await page.goto(craftedStory('vimeo-start-time'));
  await waitForReady(page);
  await expect.poll(() => embedPlayhead(page)).toBe(START_TIME);

  await embedFrame(page).evaluate(() => window.playdeckEmbedRepublishReady?.());

  // Nothing answered the second `ready`, so the embed never left the window
  // and the seek list is still the adapter's one entry.
  await expect.poll(() => seeks(page)).toEqual([START_TIME]);
  expect(await embedPlayhead(page)).toBe(START_TIME);
  expect(await publishedPlayhead(page)).toBe(START_TIME);
});

// The same repeat `ready` on a page that opted out — the failure being closed,
// spelled out. Nothing pulls the playhead back: the embed sits at 45 while
// Playdeck goes on publishing 20, and the guard is what keeps that out of
// reach.
//
// This stays a #329 test now that #381 has landed. The floor #381 added answers
// a position *below* `startTime`, and this path does not produce one: 45 is
// inside the window the story configures (`startTime: 20`, no `endTime`), so
// `correction` answers nothing for it. What diverges here is the published
// mirror rather than the window, and that is #463.
test('a page that opts out is left at the crafted position by a repeat ready', async ({
  page
}) => {
  await routeVimeoEmbed(page);
  await optOutOfTheGuard(page);
  await page.goto(craftedStory('vimeo-start-time'));
  await waitForReady(page);
  await expect.poll(() => embedPlayhead(page)).toBe(START_TIME);

  await embedFrame(page).evaluate(() => window.playdeckEmbedRepublishReady?.());

  await expect.poll(() => embedPlayhead(page)).toBe(String(CRAFTED_TIME));
  expect(await publishedPlayhead(page)).toBe(START_TIME);
});

// The gate for #329: read-confirmation is not confirmation, and neither is a
// stub. Tagged @real, so it never blocks CI (see grepInvert in
// playwright.config.ts). Run with:
//   PLAYDECK_REAL_PROVIDERS=1 pnpm exec playwright test --project=chromium \
//     e2e/vimeo-url-time-param.spec.ts
//
// Measured 2026-08-20, chromium, BEFORE the guard existed: the crafted
// parameter did NOT move the published playhead below `startTime` on the real
// embed — 78 samples over 8s read 20 in both the control and the attacked run,
// matching the ordering the second test above records. What the issue predicted
// at first load is therefore not what a real embed does, and that measurement
// is what turned this from a start-boundary change into a guard.
//
// So this test cannot tell the guard apart from its absence, and it is not
// meant to: it pins the real-embed behaviour the guard must not regress. What
// the guard does is proved against the stub, where the SDK is the shipped one
// and only the far side of the bridge is ours. Two things are still unmeasured
// against a real embed and want the next approved run: whether one ever
// republishes `ready`, and whether the ordering holds once playback starts from
// a user gesture.
test(
  'a crafted vimeo_t_ url parameter does not move a real Vimeo playhead at first load',
  { tag: '@real' },
  async ({ page }) => {
    test.setTimeout(180_000);

    // The control first, and in the same run: without it, "the playhead is at
    // the start boundary" is equally well explained by the crafted parameter
    // never having been read, which is a different claim.
    await page.goto(plainStory('vimeo-start-time'));
    await waitForReady(page);
    const control = await samplePlayhead(page, 8_000);
    expect(Math.min(...control)).toBe(START_TIME);

    await page.goto(craftedStory('vimeo-start-time'));
    await waitForReady(page);
    const attacked = await samplePlayhead(page, 8_000);
    expect(Math.min(...attacked)).toBe(START_TIME);
  }
);
