// @vitest-environment happy-dom

import { afterEach, expect, test, vi } from 'vitest';
import type {
  MediaDimensions,
  ProviderAdapter,
  ProviderEvent,
  ProviderStateListener,
  ProviderStatePatch,
  WistiaSource
} from '@reely/core';
import {
  API_READY_TIMEOUT_MS,
  createWistiaProvider,
  type WistiaMountElement,
  type WistiaProviderOptions
} from '../src/index';
import {
  installFakeWistiaPlayer,
  namedError,
  WISTIA_EVENTS,
  type FakePlayerOptions,
  type FakeWistiaPlayerElement,
  type FakeWistiaSdk
} from './fixtures/fake-sdk';

const sdkState = vi.hoisted(() => ({
  load: undefined as (() => Promise<CustomElementConstructor>) | undefined
}));

vi.mock('../src/loader', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/loader')>()),
  loadWistiaPlayer: () =>
    sdkState.load
      ? sdkState.load()
      : Promise.reject(new Error('No fake Wistia player is installed.'))
}));

afterEach(() => {
  sdkState.load = undefined;
  document.body.replaceChildren();
});

const source: WistiaSource = { type: 'wistia', mediaId: 'oifkgmxnkb' };

type Setup = {
  readonly mount: WistiaMountElement;
  readonly sdk: FakeWistiaSdk;
  readonly provider: ReturnType<typeof createWistiaProvider>;
  readonly patches: ProviderStatePatch[];
  readonly events: ProviderEvent[];
  readonly dimensions: Array<MediaDimensions | undefined>;
};

const setup = async ({
  fake = {},
  options,
  prepareMount
}: {
  fake?: FakePlayerOptions;
  options?: WistiaProviderOptions;
  prepareMount?: (mount: WistiaMountElement) => void;
} = {}): Promise<Setup> => {
  const mount = document.createElement('div') as WistiaMountElement;
  document.body.appendChild(mount);
  prepareMount?.(mount);
  const sdk = installFakeWistiaPlayer(fake);
  sdkState.load = sdk.load;
  const provider = createWistiaProvider(mount, source, options);
  const patches: ProviderStatePatch[] = [];
  const events: ProviderEvent[] = [];
  provider.subscribe((patch, event) => {
    patches.push(patch);
    if (event) events.push(event);
  });
  const dimensions: Array<MediaDimensions | undefined> = [];
  provider.subscribeDimensions?.((next) => dimensions.push(next));
  await provider.attach();
  await provider.load();
  return { mount, sdk, provider, patches, events, dimensions };
};

const element = (result: Setup): FakeWistiaPlayerElement => {
  const player = result.sdk.elements.at(-1);
  expect(player).toBeDefined();
  return player!;
};

const readyPatch = (patches: ProviderStatePatch[]): ProviderStatePatch => {
  const patch = patches.find((candidate) => candidate.lifecycle === 'ready');
  expect(patch).toBeDefined();
  return patch!;
};

const lastEvent = (events: ProviderEvent[]): ProviderEvent => {
  const event = events.at(-1);
  expect(event).toBeDefined();
  return event!;
};

// --- shared provider contract ---

type ContractAdapter = {
  provider: ProviderAdapter;
  confirmPlayback: () => void;
};

const createFakeContractAdapter = (): ContractAdapter => {
  let listener: ProviderStateListener | undefined;
  return {
    provider: {
      provider: 'wistia',
      attach: () => undefined,
      load: () => undefined,
      destroy: () => (listener = undefined),
      subscribe: (nextListener) => {
        listener = nextListener;
        return () => (listener = undefined);
      },
      play: async () => ({ ok: true })
    },
    confirmPlayback: () => listener?.({ playback: 'playing' })
  };
};

const createWistiaContractAdapter = (): ContractAdapter => {
  const mount = document.createElement('div') as WistiaMountElement;
  document.body.appendChild(mount);
  const sdk = installFakeWistiaPlayer();
  sdkState.load = sdk.load;
  return {
    provider: createWistiaProvider(mount, source),
    confirmPlayback: () => sdk.elements.at(-1)?.emit(WISTIA_EVENTS.play)
  };
};

const testProviderContract = (
  name: string,
  createAdapter: () => ContractAdapter
): void =>
  test(`${name} adapter conforms to lifecycle and event-confirmed playback`, async () => {
    const { confirmPlayback, provider } = createAdapter();
    const patches: unknown[] = [];
    provider.subscribe((patch) => patches.push(patch));

    await provider.attach();
    await provider.load();
    await expect(provider.play?.()).resolves.toEqual({ ok: true });
    expect(patches).not.toContainEqual(
      expect.objectContaining({ playback: 'playing' })
    );

    confirmPlayback();
    expect(patches).toContainEqual(
      expect.objectContaining({ playback: 'playing' })
    );

    const patchCount = patches.length;
    await provider.destroy();
    await provider.destroy();
    confirmPlayback();
    expect(patches).toHaveLength(patchCount);
  });

testProviderContract('fake', createFakeContractAdapter);
testProviderContract('wistia', createWistiaContractAdapter);

// --- embed construction ---

test('embeds a chromeless, Do-Not-Track player by default', async () => {
  const result = await setup();
  const player = element(result);
  expect(player.parentElement).toBe(result.mount);
  expect(player.tagName.toLowerCase()).toBe('wistia-player');
  expect(player.getAttribute('media-id')).toBe('oifkgmxnkb');
  expect(player.getAttribute('do-not-track')).toBe('true');
  expect(player.getAttribute('controls-visible-on-load')).toBe('false');
  // `controls-visible-on-load` only hides the chrome on load — a hover or a
  // click brings it back — so every individual control is switched off too.
  expect(player.getAttribute('play-pause-control')).toBe('false');
  expect(player.getAttribute('play-bar-control')).toBe('false');
  expect(player.getAttribute('volume-control')).toBe('false');
  expect(player.getAttribute('settings-control')).toBe('false');
  expect(player.getAttribute('fullscreen-control')).toBe('false');
  expect(player.getAttribute('big-play-button')).toBe('false');
  expect(player.getAttribute('play-pause-notifier')).toBe('false');
  expect(player.getAttribute('end-video-behavior')).toBeNull();
});

test('keeps Wistia controls as the single layer when requested', async () => {
  const result = await setup({ options: { controls: true } });
  const player = element(result);
  expect(player.getAttribute('controls-visible-on-load')).toBe('true');
  expect(player.getAttribute('play-pause-control')).toBeNull();
  expect(player.getAttribute('play-bar-control')).toBeNull();
  expect(player.getAttribute('volume-control')).toBeNull();
  expect(player.getAttribute('settings-control')).toBeNull();
  expect(player.getAttribute('fullscreen-control')).toBeNull();
  expect(player.getAttribute('big-play-button')).toBeNull();
  expect(player.getAttribute('play-pause-notifier')).toBeNull();
});

// `attach()` must not build the element. `<wistia-player>` is a custom element,
// so appending it once anything on the page has registered the tag upgrades it
// synchronously and it fetches its media data — a network request before the
// host has permitted loading, which `loading="interaction"` forbids. The fake
// registers the tag in `installFakeWistiaPlayer`, so this is the already-defined
// case: any construction would show up in `sdk.elements`.
test('builds nothing on attach, so no media data is fetched before load', async () => {
  const mount = document.createElement('div') as WistiaMountElement;
  document.body.appendChild(mount);
  const sdk = installFakeWistiaPlayer({ deferApiReady: true });
  sdkState.load = sdk.load;
  expect(customElements.get('wistia-player')).toBeDefined();
  const provider = createWistiaProvider(mount, source);

  await provider.attach();

  expect(sdk.elements).toHaveLength(0);
  expect(mount.querySelector('wistia-player')).toBeNull();

  void provider.load();
  await Promise.resolve();

  expect(sdk.elements).toHaveLength(1);
  const player = mount.querySelector('wistia-player');
  expect(player).not.toBeNull();
  expect(player?.getAttribute('media-id')).toBe('oifkgmxnkb');
});

test('turns Do-Not-Track off only when the host asks', async () => {
  const result = await setup({ options: { dnt: false } });
  expect(element(result).getAttribute('do-not-track')).toBe('false');
});

test('maps loop onto the end-of-video behavior', async () => {
  const result = await setup({ options: { loop: true } });
  expect(element(result).getAttribute('end-video-behavior')).toBe('loop');
});

test('sets the player color as an attribute', async () => {
  const result = await setup({ options: { playerColor: 'ff0000' } });
  expect(element(result).getAttribute('player-color')).toBe('ff0000');
});

test('keeps a hashed hex player color', async () => {
  const result = await setup({ options: { playerColor: '#ff0000' } });
  expect(element(result).getAttribute('player-color')).toBe('#ff0000');
});

test.each([
  ['four digits', 'f00f'],
  ['four hashed digits', '#f00f'],
  ['eight digits', 'ff0000ff'],
  ['eight hashed digits', '#ff0000ff']
])('keeps an alpha hex player color of %s', async (_form, playerColor) => {
  const result = await setup({ options: { playerColor } });
  expect(element(result).getAttribute('player-color')).toBe(playerColor);
});

test.each([
  ['a color keyword', 'red'],
  ['an rgb() function', 'rgb(255, 0, 0)'],
  ['a non-hex digit', 'gg0000'],
  ['too many digits', 'ff00001'],
  ['an empty string', ''],
  ['a javascript: URL', 'javascript:alert(1)']
])('drops a player color that is %s', async (_form, playerColor) => {
  const result = await setup({ options: { playerColor } });
  expect(element(result).getAttribute('player-color')).toBeNull();
});

test('sets swatch as a boolean-string attribute', async () => {
  const result = await setup({ options: { swatch: false } });
  expect(element(result).getAttribute('swatch')).toBe('false');
});

test('sets the poster as an attribute', async () => {
  const result = await setup({
    options: { poster: 'https://example.test/poster.png' }
  });
  expect(element(result).getAttribute('poster')).toBe(
    'https://example.test/poster.png'
  );
});

test.each([
  ['an http: URL', 'http://example.test/poster.png'],
  ['a data: URL', 'data:image/png;base64,iVBORw0KGgo='],
  ['a javascript: URL', 'javascript:alert(1)'],
  ['a root-relative path', '/poster.png'],
  ['a protocol-relative URL', '//example.test/poster.png'],
  ['an unparseable string', 'not a url'],
  ['an empty string', ''],
  ['a scheme-prefixed relative path', 'https:poster.png'],
  ['a scheme-prefixed single-slash path', 'https:/example.test/poster.png'],
  ['an https: URL padded with whitespace', ' https://example.test/poster.png ']
])('drops a poster that is %s', async (_form, poster) => {
  const result = await setup({ options: { poster } });
  expect(element(result).getAttribute('poster')).toBeNull();
});

// One bad presentation option must not fail playback: the drop is silent and
// the rest of the attach runs, so the player still reaches ready.
test('reaches ready with the dropped presentation options unset', async () => {
  const result = await setup({
    options: { playerColor: 'red', poster: 'http://example.test/poster.png' }
  });
  const player = element(result);
  expect(player.getAttribute('player-color')).toBeNull();
  expect(player.getAttribute('poster')).toBeNull();
  expect(readyPatch(result.patches)).toMatchObject({ lifecycle: 'ready' });
});

test('sets transparent letterbox as a boolean-string attribute', async () => {
  const result = await setup({ options: { transparentLetterbox: true } });
  expect(element(result).getAttribute('transparent-letterbox')).toBe('true');
});

test('leaves the presentation attributes unset when the options are omitted', async () => {
  const result = await setup();
  const player = element(result);
  expect(player.getAttribute('player-color')).toBeNull();
  expect(player.getAttribute('swatch')).toBeNull();
  expect(player.getAttribute('poster')).toBeNull();
  expect(player.getAttribute('transparent-letterbox')).toBeNull();
});

test('seeds the embed muted state from the mount preference', async () => {
  const result = await setup({
    prepareMount: (mount) => {
      mount.muted = true;
    }
  });
  expect(element(result).getAttribute('muted')).toBe('true');
});

test('applies seeded volume and playback rate preferences after ready', async () => {
  const result = await setup({
    fake: { volume: 1, playbackRate: 1 },
    prepareMount: (mount) => {
      mount.volume = 0.4;
      mount.playbackRate = 1.5;
    }
  });
  const api = element(result).handle;
  expect(api.volume).toHaveBeenCalledWith(0.4);
  expect(api.playbackRate).toHaveBeenCalledWith(1.5);
});

test('publishes the seeded volume and rate, not the ones they replaced', async () => {
  // The player reports 1 and 1; the mount asks for 0.4 and 1.5, and the
  // overrides are pushed into the player before ready is published. Reporting
  // the pre-override reads would have the host showing 1 while the player runs
  // at 0.4 — and nothing confirms a rate override afterwards at all.
  const result = await setup({
    fake: { volume: 1, playbackRate: 1 },
    prepareMount: (mount) => {
      mount.volume = 0.4;
      mount.playbackRate = 1.5;
    }
  });
  expect(readyPatch(result.patches)).toMatchObject({
    volume: 0.4,
    playbackRate: 1.5
  });

  // And the seam tracks the seeded volume too: `mute-change` carries no volume,
  // so the pair its event publishes is drawn from whatever the seam holds.
  element(result).emit(WISTIA_EVENTS.muteChange, { isMuted: true });
  expect(lastEvent(result.events)).toMatchObject({
    type: 'volumechange',
    detail: { muted: true, volume: 0.4 }
  });
});

// --- ready state ---

test('emits confirmed ready state read off the handle', async () => {
  const { patches } = await setup({
    fake: {
      duration: 62,
      muted: true,
      volume: 0.5,
      playbackRate: 1.25,
      state: 'paused'
    }
  });
  expect(readyPatch(patches)).toMatchObject({
    lifecycle: 'ready',
    activation: 'ready',
    playback: 'paused',
    buffering: false,
    seeking: false,
    commandsReady: true,
    currentTime: 0,
    duration: 62,
    muted: true,
    volume: 0.5,
    playbackRate: 1.25,
    seekable: [{ start: 0, end: 62 }]
  });
});

test('maps every Wistia player state onto core playback state', async () => {
  // `beforeplay` has no counterpart in core; `playing` and `ended` do, and
  // folding either of those into `paused` would lose a real distinction.
  expect(
    readyPatch((await setup({ fake: { state: 'beforeplay' } })).patches)
      .playback
  ).toBe('paused');
  expect(
    readyPatch((await setup({ fake: { state: 'playing' } })).patches).playback
  ).toBe('playing');
  expect(
    readyPatch((await setup({ fake: { state: 'ended' } })).patches).playback
  ).toBe('ended');
});

test('reports the whole capability record it can justify', async () => {
  const { patches } = await setup();
  expect(readyPatch(patches).capabilities).toEqual({
    seek: { status: 'available' },
    setVolume: { status: 'available' },
    setPlaybackRate: { status: 'available' },
    selectQuality: { status: 'unavailable', reason: 'provider' },
    selectTextTrack: { status: 'unavailable', reason: 'provider' },
    fullscreen: { status: 'available' },
    pictureInPicture: { status: 'unavailable', reason: 'provider' },
    airPlay: { status: 'unavailable', reason: 'provider' },
    customControls: { status: 'available' }
  });
});

test('publishes the media shape the handle measures', async () => {
  const { dimensions } = await setup({
    fake: { videoWidth: 1280, videoHeight: 720 }
  });
  expect(dimensions).toContainEqual({ width: 1280, height: 720 });
});

test('leaves the media shape unknown when the handle answers nothing usable', async () => {
  const { dimensions } = await setup({ fake: { videoWidth: 0 } });
  expect(dimensions.at(-1)).toBeUndefined();
});

test('republishes duration and shape when metadata lands late', async () => {
  const result = await setup({ fake: { duration: 0 } });
  expect(readyPatch(result.patches).duration).toBeNull();
  const player = element(result);
  player.handle.duration.mockReturnValue(90);
  player.emit(WISTIA_EVENTS.loadedMetadata);
  expect(result.patches).toContainEqual(
    expect.objectContaining({
      duration: 90,
      seekable: [{ start: 0, end: 90 }]
    })
  );
  expect(result.dimensions.at(-1)).toEqual({ width: 1920, height: 1080 });
});

// --- element events ---

test('publishes playback transitions the player reports', async () => {
  const result = await setup();
  const player = element(result);

  player.emit(WISTIA_EVENTS.play);
  expect(result.patches).toContainEqual({
    playback: 'playing',
    buffering: false
  });
  expect(lastEvent(result.events)).toMatchObject({
    type: 'play',
    origin: 'provider'
  });

  player.emit(WISTIA_EVENTS.pause);
  expect(result.patches).toContainEqual({ playback: 'paused' });
  expect(lastEvent(result.events)).toMatchObject({ type: 'pause' });

  player.handle.currentTime = 60;
  player.emit(WISTIA_EVENTS.ended);
  expect(result.patches).toContainEqual({
    playback: 'ended',
    buffering: false,
    currentTime: 60
  });
  expect(lastEvent(result.events)).toMatchObject({ type: 'ended' });
});

test('tracks the playhead from time-update, which carries no detail', async () => {
  const result = await setup();
  const player = element(result);
  player.handle.currentTime = 12.5;
  player.emit(WISTIA_EVENTS.timeUpdate);
  expect(result.patches).toContainEqual({ currentTime: 12.5 });
});

// Only the settled half. `seeking` is not bound at all — measured against the
// live player, it arrives AFTER the `seeked` for the same seek, so binding it
// would leave the state seeking for ever. Asserting the element's `seeking`
// publishes nothing is what keeps that decision from being undone by accident.
test('publishes the settled playhead from seeked, and nothing from seeking', async () => {
  const result = await setup();
  const player = element(result);

  player.handle.currentTime = 4;
  player.emit(WISTIA_EVENTS.seeking);
  // `objectContaining`, not a bare `{ seeking: true }`: `toContainEqual` is
  // exact deep equality, so re-binding `seeking` alongside anything else --
  // a playhead, say -- would slip past the literal form.
  expect(result.patches).not.toContainEqual(
    expect.objectContaining({ seeking: true })
  );

  player.handle.currentTime = 30;
  player.emit(WISTIA_EVENTS.seeked);
  expect(result.patches).toContainEqual({ seeking: false, currentTime: 30 });
  expect(lastEvent(result.events)).toMatchObject({
    type: 'seeked',
    detail: { currentTime: 30 }
  });
});

test('publishes volume and mute changes from their own event details', async () => {
  const result = await setup();
  const player = element(result);

  player.emit(WISTIA_EVENTS.volumeChange, { isMuted: false, volume: 0.3 });
  expect(result.patches).toContainEqual({ muted: false, volume: 0.3 });
  expect(lastEvent(result.events)).toMatchObject({
    type: 'volumechange',
    detail: { muted: false, volume: 0.3 }
  });

  // `mute-change` carries the mute state alone, so the volume it reports has
  // to be the one already published rather than a guess.
  player.emit(WISTIA_EVENTS.muteChange, { isMuted: true });
  expect(result.patches).toContainEqual({ muted: true });
  expect(lastEvent(result.events)).toMatchObject({
    type: 'volumechange',
    detail: { muted: true, volume: 0.3 }
  });
});

test('publishes whichever half of the volume pair the detail carries', async () => {
  // Wistia's shipped declarations describe no `volume-change` payload, so a
  // detail carrying one half has to be published rather than dropped.
  const result = await setup({ fake: { volume: 0.8, muted: false } });
  const player = element(result);

  player.emit(WISTIA_EVENTS.volumeChange, { volume: 0.3 });
  expect(result.patches.at(-1)).toEqual({ volume: 0.3 });
  expect(lastEvent(result.events)).toMatchObject({
    type: 'volumechange',
    detail: { muted: false, volume: 0.3 }
  });

  player.emit(WISTIA_EVENTS.volumeChange, { isMuted: true });
  expect(result.patches.at(-1)).toEqual({ muted: true });
  expect(lastEvent(result.events)).toMatchObject({
    detail: { muted: true, volume: 0.3 }
  });

  // The mute a `mute-change` reported has to survive into the next
  // volume-only report, or the pair the event carries goes stale.
  player.emit(WISTIA_EVENTS.muteChange, { isMuted: false });
  player.emit(WISTIA_EVENTS.volumeChange, { volume: 0.6 });
  expect(lastEvent(result.events)).toMatchObject({
    detail: { muted: false, volume: 0.6 }
  });
});

test('publishes playback rate changes', async () => {
  const result = await setup();
  element(result).emit(WISTIA_EVENTS.rateChange, { playbackRate: 2 });
  expect(result.patches).toContainEqual({ playbackRate: 2 });
  expect(lastEvent(result.events)).toMatchObject({
    type: 'ratechange',
    detail: { playbackRate: 2 }
  });
});

test('publishes the fullscreen round trip', async () => {
  const result = await setup();
  const player = element(result);

  player.emit(WISTIA_EVENTS.enterFullscreen);
  expect(result.patches).toContainEqual({ fullscreen: true });
  expect(lastEvent(result.events)).toMatchObject({
    type: 'fullscreenchange',
    detail: { fullscreen: true }
  });

  player.emit(WISTIA_EVENTS.cancelFullscreen);
  expect(result.patches).toContainEqual({ fullscreen: false });
  expect(lastEvent(result.events)).toMatchObject({
    type: 'fullscreenchange',
    detail: { fullscreen: false }
  });
});

test('ignores an event whose detail carries nothing it can act on', async () => {
  const result = await setup();
  const before = result.patches.length;
  element(result).emit(WISTIA_EVENTS.volumeChange, {});
  element(result).emit(WISTIA_EVENTS.volumeChange, { volume: 'loud' });
  element(result).emit(WISTIA_EVENTS.muteChange, {});
  element(result).emit(WISTIA_EVENTS.rateChange, {});
  expect(result.patches).toHaveLength(before);
});

// --- commands ---

test('answers every transport command against the handle', async () => {
  const { provider, sdk } = await setup({ fake: { duration: 60 } });
  const api = sdk.elements.at(-1)!.handle;

  await expect(provider.play()).resolves.toEqual({ ok: true });
  expect(api.play).toHaveBeenCalled();
  await expect(provider.pause()).resolves.toEqual({ ok: true });
  expect(api.pause).toHaveBeenCalled();
  await expect(provider.seekTo(10)).resolves.toEqual({ ok: true });
  expect(api.time).toHaveBeenCalledWith(10);
  await expect(provider.mute()).resolves.toEqual({ ok: true });
  expect(api.mute).toHaveBeenCalled();
  await expect(provider.unmute()).resolves.toEqual({ ok: true });
  expect(api.unmute).toHaveBeenCalled();
  await expect(provider.setVolume(0.25)).resolves.toEqual({ ok: true });
  expect(api.volume).toHaveBeenCalledWith(0.25);
  await expect(provider.setPlaybackRate(1.5)).resolves.toEqual({ ok: true });
  expect(api.playbackRate).toHaveBeenCalledWith(1.5);
  await expect(provider.requestFullscreen()).resolves.toEqual({ ok: true });
  expect(api.requestFullscreen).toHaveBeenCalled();
  await expect(provider.exitFullscreen()).resolves.toEqual({ ok: true });
  expect(api.cancelFullscreen).toHaveBeenCalled();
});

test('seeks relative to the playhead the player last reported', async () => {
  const result = await setup({ fake: { duration: 60 } });
  const player = element(result);
  player.handle.currentTime = 20;
  player.emit(WISTIA_EVENTS.timeUpdate);

  await result.provider.seekBy(5);
  expect(player.handle.time).toHaveBeenCalledWith(25);
});

test('clamps a seek to the timeline the player confirmed', async () => {
  const result = await setup({ fake: { duration: 60 } });
  const api = element(result).handle;

  await result.provider.seekTo(999);
  expect(api.time).toHaveBeenLastCalledWith(60);
  await result.provider.seekTo(-5);
  expect(api.time).toHaveBeenLastCalledWith(0);
  await result.provider.seekBy(-999);
  expect(api.time).toHaveBeenLastCalledWith(0);
});

test('clamps a volume command into the range the player accepts', async () => {
  const result = await setup();
  const api = element(result).handle;

  await result.provider.setVolume(4);
  expect(api.volume).toHaveBeenLastCalledWith(1);
  await result.provider.setVolume(-1);
  expect(api.volume).toHaveBeenLastCalledWith(0);
});

test('refuses a command the player cannot act on rather than forwarding it', async () => {
  const result = await setup();
  const api = element(result).handle;
  // The handle's getters and setters share one name each, so a refused command
  // is proved by the absence of a call that carries a value.
  const settersCalled = (): number =>
    [
      ...api.time.mock.calls,
      ...api.volume.mock.calls,
      ...api.playbackRate.mock.calls
    ].filter((call) => call.length > 0).length;
  expect(settersCalled()).toBe(0);

  await expect(result.provider.seekTo(Number.NaN)).resolves.toEqual({
    ok: false,
    reason: 'provider-error'
  });
  await expect(
    result.provider.seekBy(Number.POSITIVE_INFINITY)
  ).resolves.toEqual({ ok: false, reason: 'provider-error' });
  await expect(result.provider.setVolume(Number.NaN)).resolves.toEqual({
    ok: false,
    reason: 'provider-error'
  });
  await expect(result.provider.setPlaybackRate(0)).resolves.toEqual({
    ok: false,
    reason: 'provider-error'
  });
  await expect(result.provider.setPlaybackRate(-2)).resolves.toEqual({
    ok: false,
    reason: 'provider-error'
  });

  expect(settersCalled()).toBe(0);
});

test('answers not-ready for a command issued before the handle arrives', async () => {
  const mount = document.createElement('div') as WistiaMountElement;
  document.body.appendChild(mount);
  const sdk = installFakeWistiaPlayer({ deferApiReady: true });
  sdkState.load = sdk.load;
  const provider = createWistiaProvider(mount, source);
  provider.attach();

  await expect(provider.play()).resolves.toEqual({
    ok: false,
    reason: 'not-ready'
  });
});

test('reports a refused volume as a capability the platform withholds', async () => {
  const result = await setup({
    fake: {
      volumeCommand: () => {
        throw namedError(
          'NotSupportedError',
          'Volume is fixed on this device.'
        );
      }
    }
  });

  await expect(result.provider.setVolume(0.5)).resolves.toMatchObject({
    ok: false,
    reason: 'unsupported'
  });
  expect(result.patches.at(-1)?.capabilities).toMatchObject({
    setVolume: { status: 'unavailable', reason: 'browser' }
  });
});

test('drops a refusal that describes a player already replaced', async () => {
  const result = await setup({
    fake: {
      volumeCommand: () => {
        throw namedError(
          'NotSupportedError',
          'Volume is fixed on this device.'
        );
      }
    }
  });

  // The command is still in flight when the player under it is swapped, so
  // what it proves is about a player nobody is watching any more.
  const command = result.provider.setVolume(0.5);
  await result.provider.retry();
  await expect(command).resolves.toMatchObject({ reason: 'unsupported' });

  expect(
    result.patches.filter(
      (patch) => patch.capabilities?.setVolume.status === 'unavailable'
    )
  ).toHaveLength(0);
});

test('reports a refused playback rate as a capability the provider withholds', async () => {
  const result = await setup({
    fake: {
      playbackRateCommand: () => {
        throw namedError('NotSupportedError', 'This media has one rate.');
      }
    }
  });

  await expect(result.provider.setPlaybackRate(2)).resolves.toMatchObject({
    ok: false,
    reason: 'unsupported'
  });
  expect(result.patches.at(-1)?.capabilities).toMatchObject({
    setPlaybackRate: { status: 'unavailable', reason: 'provider' }
  });
});

test('reports a blocked command as policy rather than a provider fault', async () => {
  const result = await setup({
    fake: {
      requestFullscreen: () => {
        throw namedError('NotAllowedError', 'Fullscreen needs a gesture.');
      }
    }
  });

  await expect(result.provider.requestFullscreen()).resolves.toMatchObject({
    ok: false,
    reason: 'blocked',
    error: { category: 'policy', recoverable: true }
  });
});

// --- teardown, retry and staleness ---

test('destroy removes the player and stops publishing', async () => {
  const result = await setup();
  const player = element(result);

  result.provider.destroy();
  expect(player.handle.remove).toHaveBeenCalled();
  expect(player.parentElement).toBeNull();
  expect(result.mount.querySelector('wistia-player')).toBeNull();
  // A shape left behind describes a video that is no longer on screen.
  expect(result.dimensions.at(-1)).toBeUndefined();

  const patchCount = result.patches.length;
  player.emit(WISTIA_EVENTS.play);
  expect(result.patches).toHaveLength(patchCount);
});

test('drops the events the player fires on its way out', async () => {
  const result = await setup();
  const player = element(result);
  // Wistia's own teardown reports state as it unwinds; that report describes a
  // player the adapter has already discarded.
  player.handle.remove.mockImplementation(() => {
    player.emit(WISTIA_EVENTS.pause);
    player.emit(WISTIA_EVENTS.ended);
  });

  const patchCount = result.patches.length;
  result.provider.destroy();
  expect(result.patches).toHaveLength(patchCount);
});

test('destroy during load leaves no player behind', async () => {
  const mount = document.createElement('div') as WistiaMountElement;
  document.body.appendChild(mount);
  const sdk = installFakeWistiaPlayer();
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  sdkState.load = async () => {
    await held;
    return sdk.load();
  };
  const provider = createWistiaProvider(mount, source);
  const patches: ProviderStatePatch[] = [];
  provider.subscribe((patch) => patches.push(patch));
  provider.attach();

  const loading = provider.load();
  provider.destroy();
  release();
  await loading;

  expect(mount.querySelector('wistia-player')).toBeNull();
  expect(patches.some((patch) => patch.lifecycle === 'ready')).toBe(false);
});

test('retry replaces the player and ignores the superseded one', async () => {
  const result = await setup();
  const first = element(result);

  await expect(result.provider.retry()).resolves.toEqual({ ok: true });
  const second = element(result);
  expect(second).not.toBe(first);
  expect(first.handle.remove).toHaveBeenCalled();
  expect(first.parentElement).toBeNull();
  expect(second.parentElement).toBe(result.mount);
  expect(
    result.patches.filter((patch) => patch.lifecycle === 'ready')
  ).toHaveLength(2);

  const patchCount = result.patches.length;
  first.emit(WISTIA_EVENTS.play);
  expect(result.patches).toHaveLength(patchCount);

  second.emit(WISTIA_EVENTS.play);
  expect(result.patches.at(-1)).toEqual({
    playback: 'playing',
    buffering: false
  });
});

test('retry after destroy is refused', async () => {
  const result = await setup();
  result.provider.destroy();
  await expect(result.provider.retry()).resolves.toEqual({
    ok: false,
    reason: 'not-ready'
  });
});

test('reports a handshake that never arrives rather than hanging in loading', async () => {
  // Aurora fires no failure event: media data that asks for the legacy iframe
  // embed, or an engine fetch a blocker stops, leaves the element silent.
  vi.useFakeTimers();
  try {
    const mount = document.createElement('div') as WistiaMountElement;
    document.body.appendChild(mount);
    const sdk = installFakeWistiaPlayer({ deferApiReady: true });
    sdkState.load = sdk.load;
    const provider = createWistiaProvider(mount, source);
    const patches: ProviderStatePatch[] = [];
    const events: ProviderEvent[] = [];
    provider.subscribe((patch, event) => {
      patches.push(patch);
      if (event) events.push(event);
    });
    provider.attach();

    const loading = provider.load();
    await vi.advanceTimersByTimeAsync(API_READY_TIMEOUT_MS);
    await loading;

    expect(patches).toContainEqual(
      expect.objectContaining({
        lifecycle: 'error',
        activation: 'error',
        error: expect.objectContaining({
          category: 'provider',
          fatal: true,
          // The host has to be able to offer `retry()`, which is the only way
          // out of this.
          recoverable: true,
          message: expect.stringContaining('did not become ready')
        })
      })
    );
    expect(lastEvent(events)).toMatchObject({ type: 'error' });
    expect(mount.querySelector('wistia-player')).toBeNull();
  } finally {
    vi.useRealTimers();
  }
});

test('leaves no deadline pending once the handshake lands', async () => {
  vi.useFakeTimers();
  try {
    const result = await setup();
    expect(readyPatch(result.patches).lifecycle).toBe('ready');
    // A deadline left armed would fire long after the player was ready and
    // report a healthy attach as failed.
    expect(vi.getTimerCount()).toBe(0);
  } finally {
    vi.useRealTimers();
  }
});

test('reports a load that never produced a player as a fatal provider error', async () => {
  const mount = document.createElement('div') as WistiaMountElement;
  document.body.appendChild(mount);
  sdkState.load = () =>
    Promise.reject(namedError('Error', 'The Wistia bundle failed to load.'));
  const provider = createWistiaProvider(mount, source);
  const patches: ProviderStatePatch[] = [];
  const events: ProviderEvent[] = [];
  provider.subscribe((patch, event) => {
    patches.push(patch);
    if (event) events.push(event);
  });
  provider.attach();
  await provider.load();

  expect(patches).toContainEqual(
    expect.objectContaining({
      lifecycle: 'error',
      activation: 'error',
      error: expect.objectContaining({
        category: 'provider',
        fatal: true,
        recoverable: true,
        message: 'The Wistia bundle failed to load.'
      })
    })
  );
  expect(lastEvent(events)).toMatchObject({ type: 'error' });
  expect(mount.querySelector('wistia-player')).toBeNull();
});

test('takes the handle from the property the element actually exposes', async () => {
  const viaApi = await setup({ fake: { apiProperty: 'api' } });
  expect(readyPatch(viaApi.patches).lifecycle).toBe('ready');

  const viaLegacy = await setup({ fake: { apiProperty: 'wistiaApi' } });
  expect(readyPatch(viaLegacy.patches).lifecycle).toBe('ready');
});
