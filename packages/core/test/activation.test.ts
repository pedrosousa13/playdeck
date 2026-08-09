import { expect, expectTypeOf, test } from 'vitest';
import {
  PlayerController,
  type PlayerError,
  type PreProviderActivation
} from '../src/index';

const failure: PlayerError = {
  category: 'configuration',
  fatal: false,
  recoverable: false,
  message: 'Viewport activation requires Player.Viewport.'
};

test.each([
  [
    { activation: 'dormant' } satisfies PreProviderActivation,
    { activation: 'dormant', lifecycle: 'idle', error: null }
  ],
  [
    { activation: 'eligible' } satisfies PreProviderActivation,
    { activation: 'eligible', lifecycle: 'idle', error: null }
  ],
  [
    { activation: 'loading-provider' } satisfies PreProviderActivation,
    { activation: 'loading-provider', lifecycle: 'loading', error: null }
  ],
  [
    { activation: 'error', error: failure } satisfies PreProviderActivation,
    { activation: 'error', lifecycle: 'error', error: failure }
  ]
] as const)('publishes pre-provider state %#', (next, expected) => {
  const controller = new PlayerController();

  controller.setActivation(next);

  expect(controller.getState()).toMatchObject(expected);
  expect(Object.isFrozen(controller.getState())).toBe(true);
  if (controller.getState().error) {
    expect(Object.isFrozen(controller.getState().error)).toBe(true);
  }
});

test('clears a pre-provider error when a new attempt becomes eligible', () => {
  const controller = new PlayerController();
  controller.setActivation({ activation: 'error', error: failure });

  controller.setActivation({ activation: 'eligible' });

  expect(controller.getState()).toMatchObject({
    activation: 'eligible',
    lifecycle: 'idle',
    error: null
  });
});

test('does not let a pre-provider transition replace an installed provider', () => {
  const controller = new PlayerController();
  controller.setProvider({
    provider: 'native',
    attach: () => undefined,
    load: () => undefined,
    destroy: () => undefined,
    subscribe: () => () => undefined
  });

  controller.setActivation({ activation: 'eligible' });

  expect(controller.getState()).toMatchObject({
    activation: 'loading-provider',
    lifecycle: 'loading',
    provider: 'native'
  });
});

test('does not accept ready as a pre-provider transition', () => {
  expectTypeOf<{ readonly activation: 'ready' }>().not.toMatchTypeOf<
    Parameters<PlayerController['setActivation']>[0]
  >();
});
