// @vitest-environment node

import { expect, test, vi } from 'vitest';
import {
  PlayerController,
  type PlayerCommand,
  type ProviderAdapter,
  type RefusedCommand
} from '../src/index';

// Nothing here drives provider events, so unlike the fake in
// `refused-play.test.ts` this one keeps no `emit` handle: every test below
// refuses its command before a provider is ever in hand, and the attach cases
// only need something to attach.
const createProvider = (): ProviderAdapter => ({
  provider: 'native',
  attach: () => undefined,
  load: () => undefined,
  destroy: () => undefined,
  subscribe: () => () => undefined,
  play: async () => ({ ok: true }),
  pause: async () => ({ ok: true }),
  mute: async () => ({ ok: true })
});

const notReady = { ok: false, reason: 'not-ready' } as const;

test('publishes a pre-attach play refusal on refusedPlay, which the early return left unwritten', async () => {
  const controller = new PlayerController();

  const result = await controller.playWithOrigin('user');

  expect(result).toEqual(notReady);
  expect(controller.getState().refusedPlay).toEqual({
    origin: 'user',
    reason: 'not-ready'
  });
});

test('publishes a pre-attach play refusal as a refused command carrying its origin', async () => {
  const controller = new PlayerController();

  await controller.playWithOrigin('user');

  expect(controller.getState().refusedCommand).toEqual({
    command: 'play',
    origin: 'user',
    reason: 'not-ready'
  });
});

test('publishes a pre-attach pause refusal, and leaves refusedPlay alone', async () => {
  const controller = new PlayerController();

  const result = await controller.pauseWithOrigin('user');

  expect(result).toEqual(notReady);
  expect(controller.getState()).toMatchObject({
    refusedCommand: { command: 'pause', origin: 'user', reason: 'not-ready' },
    refusedPlay: null
  });
});

test('publishes a pre-attach seek refusal from either seek entry point', async () => {
  const controller = new PlayerController();

  expect(await controller.seekToWithOrigin(5, 'user')).toEqual(notReady);
  expect(controller.getState().refusedCommand).toEqual({
    command: 'seek',
    origin: 'user',
    reason: 'not-ready'
  });

  expect(await controller.seekByWithOrigin(-5, 'api')).toEqual(notReady);
  expect(controller.getState().refusedCommand).toEqual({
    command: 'seek',
    origin: 'api',
    reason: 'not-ready'
  });
});

const untagged: ReadonlyArray<
  readonly [PlayerCommand, (c: PlayerController) => Promise<unknown>]
> = [
  ['mute', (c) => c.mute()],
  ['unmute', (c) => c.unmute()],
  ['setVolume', (c) => c.setVolume(0.5)],
  ['setPlaybackRate', (c) => c.setPlaybackRate(2)],
  ['selectQuality', (c) => c.selectQuality(null)],
  ['selectTextTrack', (c) => c.selectTextTrack(null)],
  ['requestFullscreen', (c) => c.requestFullscreen()],
  ['exitFullscreen', (c) => c.exitFullscreen()],
  ['requestPictureInPicture', (c) => c.requestPictureInPicture()],
  ['exitPictureInPicture', (c) => c.exitPictureInPicture()],
  ['showAirPlayPicker', (c) => c.showAirPlayPicker()]
];

test.each(untagged)(
  'publishes an untagged refusal for %s, which carries no origin',
  async (command, run) => {
    const controller = new PlayerController();

    expect(await run(controller)).toEqual(notReady);
    expect(controller.getState().refusedCommand).toEqual({
      command,
      origin: null,
      reason: 'not-ready'
    });
  }
);

test('records no refused command for a retry, which is not one of them', async () => {
  const controller = new PlayerController();

  expect(await controller.retry()).toEqual(notReady);
  expect(controller.getState().refusedCommand).toBeNull();
});

test('states the last command refused rather than a log of them', async () => {
  const controller = new PlayerController();

  await controller.playWithOrigin('user');
  await controller.mute();

  expect(controller.getState()).toMatchObject({
    refusedCommand: { command: 'mute', origin: null, reason: 'not-ready' },
    // Its own clearing rule, untouched by a later command of any kind.
    refusedPlay: { origin: 'user', reason: 'not-ready' }
  });
});

test('holds a pre-attach refusal until a provider attaches, and withdraws it there', async () => {
  const controller = new PlayerController();
  const fake = createProvider();

  await controller.playWithOrigin('user');
  // An unrelated report, so the refusal is carried through a rebuilt snapshot
  // rather than merely read back off the one that published it.
  const withdraw = controller.reportRefusedUrl('poster src');
  expect(controller.getState().refusedCommand).toMatchObject({
    command: 'play'
  });
  withdraw();
  expect(controller.getState().refusedCommand).toMatchObject({
    command: 'play'
  });

  const seen: { activation: string; refused: RefusedCommand | null }[] = [];
  controller.subscribe((state) =>
    seen.push({ activation: state.activation, refused: state.refusedCommand })
  );
  seen.length = 0;
  controller.setProvider(fake);

  // Withdrawn in the same update that hands the consumer a provider, so no
  // snapshot ever says "loading a provider" beside "there was none".
  expect(seen[0]).toEqual({ activation: 'loading-provider', refused: null });
  expect(controller.getState()).toMatchObject({
    activation: 'loading-provider',
    refusedCommand: null,
    refusedPlay: null
  });
});

// The clearing rule is `setProvider`, not "a provider arrived" — so a detach
// ends the refusal even though no provider ever attached and "no provider was
// attached" is still true of the world. `setProvider(undefined)` reaches the
// clear rather than its early-return guard whenever something occupies the
// error slot, and a standing refused-URL notice does exactly that, which is the
// ordinary case here because the poster reports before a provider loads.
// Keeping the record instead would leave it standing while the published field
// went back to null, and the next patch would resurrect it into reset state.
test('ends a pre-attach refusal on a detach, with no provider ever attached', async () => {
  const controller = new PlayerController();

  controller.reportRefusedUrl('poster src');
  await controller.playWithOrigin('user');
  expect(controller.getState().refusedCommand).toMatchObject({
    command: 'play'
  });

  controller.setProvider(undefined);

  expect(controller.getState()).toMatchObject({
    provider: null,
    refusedCommand: null
  });
});

test('leaves a standing refused-URL notice exactly where a pre-attach refusal found it', async () => {
  const controller = new PlayerController();
  controller.reportRefusedUrl('poster src');
  const notice = controller.getState().error;
  expect(notice).not.toBeNull();

  const before = controller.getState();
  await controller.playWithOrigin('user');
  const after = controller.getState();

  // The snapshot the refusal republishes is the one it found, plus the two
  // fields it wrote — the error slot re-ranked to the same notice, by identity.
  expect(after.error).toBe(notice);
  expect(after).toEqual({
    ...before,
    refusedPlay: { origin: 'user', reason: 'not-ready' },
    refusedCommand: { command: 'play', origin: 'user', reason: 'not-ready' }
  });
});

test('publishes a pre-attach refusal to subscribers rather than only recording it', async () => {
  const controller = new PlayerController();
  const listener = vi.fn();
  controller.subscribe(listener);
  listener.mockClear();

  await controller.playWithOrigin('user');

  expect(listener).toHaveBeenCalledTimes(1);
  expect(listener.mock.calls[0]?.[0]).toMatchObject({
    refusedCommand: { command: 'play', origin: 'user', reason: 'not-ready' }
  });
});

test('refuses a command again once the provider detaches', async () => {
  const controller = new PlayerController();
  const fake = createProvider();
  controller.setProvider(fake);

  expect(controller.getState().refusedCommand).toBeNull();

  controller.setProvider(undefined);
  await controller.mute();

  expect(controller.getState().refusedCommand).toEqual({
    command: 'mute',
    origin: null,
    reason: 'not-ready'
  });
});
