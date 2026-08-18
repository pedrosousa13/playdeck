import { expect, test, type Page } from '@playwright/test';
import { playButton } from './locators';

// Real-provider smoke tests: tagged @real so they never block CI (see
// grepInvert in playwright.config.ts). Run with:
//   PLAYDECK_REAL_PROVIDERS=1 pnpm test:e2e --project=chromium --grep @real

const STORY =
  '/iframe.html?id=fixtures-playerfixture--wistia-interaction-muted&viewMode=story';

// Every control `<wistia-player>` draws when its chrome is on, by the
// `data-handle` Wistia stamps on each one. Measured off a stock embed rather
// than read out of the SDK: the chrome is drawn by the engine fetched from
// fast.wistia.com, so nothing in the shipped npm package names these.
const CONTROL_HANDLES = [
  'bigPlayButton',
  'playbar',
  'volumeButton',
  'settingsButton',
  'fullscreenControl',
  'ellipsisButton'
] as const;

type RecordedEvent = { readonly type: string; readonly detail: string };

// Records every event the live `<wistia-player>` dispatches, name and payload.
// This is the instrument the whole file rests on: the adapter's event-name
// literals and the unit suite's fixture were both derived from Wistia's
// documentation, so only a recording taken off the real element can tell the
// two apart from a shared misreading. Installed before navigation, because the
// first events land inside the element's own upgrade.
const recordElementEvents = (page: Page): Promise<unknown> =>
  page.addInitScript(() => {
    const log: Array<{ type: string; detail: string }> = [];
    (window as unknown as { __wistiaEvents: typeof log }).__wistiaEvents = log;
    const dispatch = EventTarget.prototype.dispatchEvent;
    EventTarget.prototype.dispatchEvent = function (event: Event) {
      if ((this as unknown as { tagName?: string }).tagName === 'WISTIA-PLAYER')
        log.push({
          type: event.type,
          // Wistia's payloads carry live player objects, so a failed
          // stringify is expected for some and must not break the recording.
          detail: (() => {
            try {
              return JSON.stringify((event as CustomEvent<unknown>).detail);
            } catch {
              return '[unserializable]';
            }
          })()
        });
      return dispatch.call(this, event);
    };
  });

const recorded = (page: Page): Promise<RecordedEvent[]> =>
  page.evaluate(
    () =>
      (window as unknown as { __wistiaEvents: RecordedEvent[] }).__wistiaEvents
  );

const firedTypes = async (page: Page): Promise<string[]> =>
  (await recorded(page)).map((event) => event.type);

const state = (page: Page) =>
  page.evaluate(() => window.playdeckHandle?.getState());

const activate = async (page: Page): Promise<void> => {
  await page.goto(STORY);
  const activation = page.getByRole('button', {
    name: 'Play video',
    exact: true
  });
  await activation.waitFor();
  await activation.click();
  await expect(playButton(page)).toHaveAttribute('data-state', 'playing', {
    timeout: 90_000
  });
};

test(
  'plays a real Wistia video and advances the playhead',
  { tag: '@real' },
  async ({ page }) => {
    test.setTimeout(180_000);
    await activate(page);

    // A mounted element is not playback: the media element has to be the real
    // `<wistia-player>`, on screen, carrying the mediaId Playdeck detected.
    const player = page.locator('[data-playdeck-part="media"] wistia-player');
    await expect(player).toHaveAttribute('media-id', 'oifkgmxnkb');
    await expect(player).toBeInViewport();
    expect(await player.boundingBox()).toMatchObject({
      width: expect.any(Number)
    });

    // The playhead, not the state word. `playing` can be published by a
    // provider that never decoded a frame; a playhead past a real threshold
    // cannot.
    await expect
      .poll(async () => (await state(page))?.currentTime ?? 0, {
        timeout: 60_000
      })
      .toBeGreaterThan(3);
    // And the media answered for its own shape, which only a decode can.
    expect((await state(page))?.duration ?? 0).toBeGreaterThan(60);
  }
);

// #198: the adapter binds element events by name, and six of those names appear
// nowhere in the shipped `@wistia/wistia-player` bundle — the package is the web
// component shell, and the playback engine that dispatches them is fetched from
// fast.wistia.com at runtime. The unit suite cannot tell a correct name from a
// misread one, because its fixture dispatches the same literals the adapter
// listens for. So each name is driven against the live player here, and both
// halves are asserted: the element really dispatched it, AND the state Playdeck
// publishes moved because of it.
//
// One name is the exception, and it is marked at its own assertion:
// `loaded-metadata` gets the fire half alone. Everything its handler publishes
// is already published by the ready-time `adopt` patch, so on this player no
// state assertion can be attributed to it.
test(
  'every element event the adapter binds fires on the live player and moves Playdeck state',
  { tag: '@real' },
  async ({ page }) => {
    test.setTimeout(300_000);
    await recordElementEvents(page);
    await activate(page);

    // `play`, both halves: the recorder proves the live element dispatched it,
    // and `playback: 'playing'` is published by no other handler.
    expect(await firedTypes(page)).toContain('play');
    expect((await state(page))?.playback).toBe('playing');

    // `loaded-metadata`, FIRE HALF ONLY — deliberately, and this is the file's
    // one gap. `onLoadedMetadata` publishes `duration` and `seekable` and
    // nothing else, both read from `player.duration()`; `attachment.ts` reads
    // the same call at `api-ready` and hands it to `playback.adopt`, which
    // publishes the same two fields. Measured on this media, `api.duration()`
    // already answers 115.434 at `api-ready` (t=2225ms), and `loaded-metadata`
    // lands ~490ms later (t=2714ms), by which time the ready patch has already
    // published both. A probe that recorded Playdeck's state either side of the
    // live dispatch found it unchanged across it:
    //   before {"duration":115.434,"seekable":[{"start":0,"end":115.434}]}
    //   after  {"duration":115.434,"seekable":[{"start":0,"end":115.434}]}
    // So there is no field, and no moment, at which this binding is separable
    // from the ready patch: a state assertion here would pass with the
    // `on('loaded-metadata', …)` line deleted. Rather than dress one up, this
    // records what is proved — the name is real and the live element dispatches
    // it, which is what closes the shared-misreading hole for the literal — and
    // leaves the binding itself covered only by the unit suite.
    expect(await firedTypes(page)).toContain('loaded-metadata');
    // Published by `adopt` at ready, not by the event above. Asserted for the
    // ready patch's sake, and attributed to nothing else.
    expect((await state(page))?.seekable).not.toEqual([]);

    // `time-update`, which carries no detail — the playhead is read back off
    // the handle, so a name that never fires shows up as a frozen currentTime.
    const started = (await state(page))?.currentTime ?? 0;
    await expect
      .poll(async () => (await state(page))?.currentTime ?? 0, {
        timeout: 30_000
      })
      .toBeGreaterThan(started + 1);
    expect(await firedTypes(page)).toContain('time-update');

    // `volume-change`, driven on its own: a volume set does not touch the mute
    // state, so `state.volume` moving proves this event and no other.
    await page.evaluate(() => window.playdeckHandle?.setVolume(0.25));
    await expect.poll(async () => (await state(page))?.volume).toBe(0.25);
    expect(await firedTypes(page)).toContain('volume-change');

    // The detail shape behind `onVolumeChange`'s field guard, asserted rather
    // than assumed. Measured: `{ volume: number, isMuted: boolean }` — both
    // halves on every dispatch, so the handler's "whichever half is there"
    // tolerance is safe rather than necessary.
    const volumeDetail = (await recorded(page))
      .filter((event) => event.type === 'volume-change')
      .at(-1);
    expect(JSON.parse(volumeDetail?.detail ?? 'null') as unknown).toEqual({
      volume: 0.25,
      isMuted: true
    });

    // `mute-change`. The story starts muted, so the unmute is what moves.
    await page.evaluate(() => window.playdeckHandle?.unmute());
    await expect.poll(async () => (await state(page))?.muted).toBe(false);
    await page.evaluate(() => window.playdeckHandle?.mute());
    await expect.poll(async () => (await state(page))?.muted).toBe(true);
    expect(await firedTypes(page)).toContain('mute-change');

    // `rate-change`.
    await page.evaluate(() => window.playdeckHandle?.setPlaybackRate(1.5));
    await expect.poll(async () => (await state(page))?.playbackRate).toBe(1.5);
    expect(await firedTypes(page)).toContain('rate-change');

    // `seeked`. `seeking` is deliberately NOT bound — measured, the element
    // dispatches it about a millisecond after the `seeked` for the same seek,
    // plus one unpaired one during load, so binding the pair pinned Playdeck's
    // `seeking` true for the whole session. This asserts the correction holds:
    // a settled seek leaves `seeking` false, not stuck.
    await page.evaluate(() => window.playdeckHandle?.seekTo(60));
    await expect
      .poll(async () => (await state(page))?.currentTime ?? 0, {
        timeout: 30_000
      })
      .toBeGreaterThan(59);
    expect(await firedTypes(page)).toContain('seeked');
    expect((await state(page))?.seeking).toBe(false);

    // `enter-fullscreen` / `cancel-fullscreen`. Entering needs a real user
    // gesture, so it goes through the fixture's own button; leaving does not,
    // and must not, because in fullscreen the player covers that button.
    await page.getByTestId('fullscreen-toggle').click();
    await expect
      .poll(async () => (await state(page))?.fullscreen, { timeout: 30_000 })
      .toBe(true);
    expect(await firedTypes(page)).toContain('enter-fullscreen');

    await page.evaluate(() => window.playdeckHandle?.exitFullscreen());
    await expect
      .poll(async () => (await state(page))?.fullscreen, { timeout: 30_000 })
      .toBe(false);
    expect(await firedTypes(page)).toContain('cancel-fullscreen');

    // `pause`.
    await page.evaluate(() => window.playdeckHandle?.pause());
    await expect
      .poll(async () => (await state(page))?.playback, { timeout: 30_000 })
      .toBe('paused');
    expect(await firedTypes(page)).toContain('pause');

    // `ended`, last because it consumes the rest of the media.
    await page.evaluate(() => {
      const duration = window.playdeckHandle?.getState().duration ?? 0;
      void window.playdeckHandle?.seekTo(Math.max(0, duration - 3));
    });
    await page.evaluate(() => window.playdeckHandle?.play());
    await expect
      .poll(async () => (await state(page))?.playback, { timeout: 60_000 })
      .toBe('ended');
    expect(await firedTypes(page)).toContain('ended');
  }
);

// #198: `customControls: available` is a claim about the embed attributes in
// `CHROME_OPTIONS`, and nothing deterministic can check it — the chrome is drawn
// by the engine Wistia serves at runtime, inside the element's shadow root.
// `controls-visible-on-load` on its own only hides the controls until the first
// hover or click, which is exactly why the adapter switches each one off by
// name, and exactly what this has to prove.
test(
  'the chromeless embed draws none of Wistia own controls, on load or after input',
  { tag: '@real' },
  async ({ page }) => {
    test.setTimeout(180_000);
    await activate(page);

    const media = page.locator('[data-playdeck-part="media"]');
    // Playwright's CSS engine pierces the open shadow root, so Wistia's chrome
    // is reachable as if it were in the light DOM.
    const control = (handle: string) =>
      media.locator(`wistia-player [data-handle="${handle}"]`);

    const expectNoChrome = async (moment: string) => {
      for (const handle of CONTROL_HANDLES) {
        await expect(
          control(handle),
          `${handle} appeared ${moment}`
        ).toHaveCount(0);
      }
      // And no browser-drawn set either, which the attributes above say
      // nothing about.
      await expect(media.locator('wistia-player video[controls]')).toHaveCount(
        0
      );
    };

    await expectNoChrome('on load');
    await media.hover();
    await media.hover({ position: { x: 100, y: 150 } });
    await expectNoChrome('after hovering the video surface');
    await media.click({ position: { x: 100, y: 150 } });
    await expectNoChrome('after clicking the video surface');

    // The control half of the pair. Without it every assertion above passes on
    // a `data-handle` vocabulary Wistia never used — measured, that is not a
    // hypothetical: a first attempt at this compared against a stock embed of
    // the same media and found no controls on EITHER, because this media's own
    // Wistia settings ship it playbar-less. The attributes have to be forced on.
    await page.evaluate(
      () =>
        new Promise<void>((resolve) => {
          const stock = document.createElement('wistia-player');
          stock.id = 'stock-chrome';
          stock.setAttribute('media-id', 'oifkgmxnkb');
          stock.setAttribute('muted', 'true');
          for (const option of [
            'big-play-button',
            'play-bar-control',
            'volume-control',
            'settings-control',
            'fullscreen-control',
            'play-pause-control',
            'controls-visible-on-load'
          ]) {
            stock.setAttribute(option, 'true');
          }
          stock.style.width = '640px';
          stock.style.height = '360px';
          stock.addEventListener('api-ready', () => resolve(), { once: true });
          document.body.appendChild(stock);
        })
    );
    for (const handle of CONTROL_HANDLES) {
      await expect(
        page.locator(`#stock-chrome [data-handle="${handle}"]`),
        `${handle} is missing from a stock embed, so its absence above proves nothing`
      ).toHaveCount(1, { timeout: 60_000 });
    }
  }
);
