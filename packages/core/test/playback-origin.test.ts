// @vitest-environment node

import { expect, test } from 'vitest';
import {
  PlayerController,
  type PlayerEventOrigin,
  type ProviderAdapter,
  type ProviderStateListener
} from '../src/index';

type FakeProviderOptions = {
  readonly provider?: ProviderAdapter['provider'];
};

const createProvider = (options: FakeProviderOptions = {}) => {
  let emit: ProviderStateListener | undefined;
  const provider: ProviderAdapter = {
    provider: options.provider ?? 'native',
    attach: () => undefined,
    load: () => undefined,
    destroy: () => undefined,
    subscribe: (listener) => {
      emit = listener;
      return () => undefined;
    },
    play: async () => ({ ok: true }),
    pause: async () => ({ ok: true })
  };

  return {
    provider,
    emit: (...args: Parameters<ProviderStateListener>) => emit?.(...args)
  };
};

const playEvent = {
  type: 'play',
  detail: undefined,
  origin: 'provider'
} as const;

const pauseEvent = {
  type: 'pause',
  detail: undefined,
  origin: 'provider'
} as const;

// A patch that reports something other than a play/pause confirmation, the
// shape `onRateChange`-style reporting takes: it carries a `playback` key
// (several adapters echo the current state on every report) but no event
// that `confirmsPlayback` recognises.
const rateChangeEvent = {
  type: 'ratechange',
  detail: { playbackRate: 1 },
  origin: 'provider'
} as const;

const recordPlayOrigins = (controller: PlayerController) => {
  const origins: PlayerEventOrigin[] = [];
  controller.on('play', (event) => origins.push(event.origin));
  controller.on('pause', (event) => origins.push(event.origin));
  return origins;
};

// The origin-consumption defect, found while diagnosing #695:
// `provider-native`'s `onPlaying` emits `{ playback: 'playing' }` with no
// event of its own, so an engine that reports `playing` ahead of `play`
// delivers that patch first. Before the fix, the eventless patch consumed
// the pending `'autoplay'` origin `playWithOrigin` had just registered, and
// the real `play` event that followed fell back to `event.origin` —
// `'provider'`. This does not fix #695, whose WebKit reproduction stays red.
test('does not let an eventless playback patch consume the pending play origin', async () => {
  const fake = createProvider();
  const controller = new PlayerController();
  controller.setProvider(fake.provider);
  const origins = recordPlayOrigins(controller);

  await controller.playWithOrigin('autoplay');
  fake.emit({ playback: 'playing' });
  fake.emit({ playback: 'playing' }, playEvent);

  expect(origins).toEqual(['autoplay']);
});

test('does not let a non-play event carrying a playback patch consume the pending play origin', async () => {
  const fake = createProvider();
  const controller = new PlayerController();
  controller.setProvider(fake.provider);
  const origins = recordPlayOrigins(controller);

  await controller.playWithOrigin('autoplay');
  fake.emit({ playback: 'playing' }, rateChangeEvent);
  fake.emit({ playback: 'playing' }, playEvent);

  expect(origins).toEqual(['autoplay']);
});

test('leaves an uncommanded play as provider', () => {
  const fake = createProvider();
  const controller = new PlayerController();
  controller.setProvider(fake.provider);
  const origins = recordPlayOrigins(controller);

  fake.emit({ playback: 'playing' }, playEvent);

  expect(origins).toEqual(['provider']);
});

test('does not let an eventless playback patch consume the pending pause origin', async () => {
  const fake = createProvider();
  const controller = new PlayerController();
  controller.setProvider(fake.provider);
  const origins = recordPlayOrigins(controller);

  await controller.pauseWithOrigin('autoplay');
  fake.emit({ playback: 'paused' });
  fake.emit({ playback: 'paused' }, pauseEvent);

  expect(origins).toEqual(['autoplay']);
});
