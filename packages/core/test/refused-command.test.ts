// @vitest-environment node

import { expect, test, vi } from 'vitest';
import {
  PlayerController,
  type PlayerCommand,
  type ProviderAdapter,
  type ProviderStateListener,
  type RefusedCommand
} from '../src/index';

const createProvider = () => {
  let emit: ProviderStateListener | undefined;
  const provider: ProviderAdapter = {
    provider: 'native',
    attach: () => undefined,
    load: () => undefined,
    destroy: () => undefined,
    subscribe: (listener) => {
      emit = listener;
      return () => undefined;
    },
    play: async () => ({ ok: true }),
    pause: async () => ({ ok: true }),
    mute: async () => ({ ok: true })
  };

  return {
    provider,
    emit: (...args: Parameters<ProviderStateListener>) => emit?.(...args)
  };
};

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

test('publishes an untagged refusal for every command that carries no origin', async () => {
  const issue: ReadonlyArray<
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

  for (const [command, run] of issue) {
    const controller = new PlayerController();

    expect(await run(controller)).toEqual(notReady);
    expect(controller.getState().refusedCommand).toEqual({
      command,
      origin: null,
      reason: 'not-ready'
    });
  }
});

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
  controller.setProvider(fake.provider);

  // Withdrawn in the same update that hands the consumer a provider, so no
  // snapshot ever says "loading a provider" beside "there was none".
  expect(seen[0]).toEqual({ activation: 'loading-provider', refused: null });
  expect(controller.getState()).toMatchObject({
    activation: 'loading-provider',
    refusedCommand: null,
    refusedPlay: null
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
  controller.setProvider(fake.provider);

  expect(controller.getState().refusedCommand).toBeNull();

  controller.setProvider(undefined);
  await controller.mute();

  expect(controller.getState().refusedCommand).toEqual({
    command: 'mute',
    origin: null,
    reason: 'not-ready'
  });
});
