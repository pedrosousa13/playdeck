import { expect, test } from 'vitest';
import {
  createInitialPlayerState,
  PlayerController,
  type CommandResult,
  type ProviderAdapter,
  type ProviderStateListener
} from '../src/index';

type Harness = {
  readonly provider: ProviderAdapter;
  readonly emit: ProviderStateListener;
};

const createProvider = (overrides: Partial<ProviderAdapter> = {}): Harness => {
  let listener: ProviderStateListener | undefined;
  return {
    provider: {
      provider: 'native',
      attach: () => undefined,
      load: () => undefined,
      destroy: () => (listener = undefined),
      subscribe: (nextListener) => {
        listener = nextListener;
        return () => (listener = undefined);
      },
      ...overrides
    },
    emit: (patch, event) => listener?.(patch, event)
  };
};

test('a fresh state is not command-ready', () => {
  expect(createInitialPlayerState().commandsReady).toBe(false);
  expect(new PlayerController().getState().commandsReady).toBe(false);
});

test('an adapter declares command readiness through a state patch', () => {
  const controller = new PlayerController();
  const { emit, provider } = createProvider();
  controller.setProvider(provider);

  expect(controller.getState().commandsReady).toBe(false);
  emit({ commandsReady: true });
  expect(controller.getState().commandsReady).toBe(true);
});

test('swapping providers drops the previous declaration', () => {
  const controller = new PlayerController();
  const first = createProvider();
  controller.setProvider(first.provider);
  first.emit({ commandsReady: true });

  controller.setProvider(createProvider().provider);

  expect(controller.getState().commandsReady).toBe(false);
});

test('retry drops the declaration while the provider reloads', async () => {
  const controller = new PlayerController();
  let resolveRetry: (result: CommandResult) => void = () => undefined;
  const { emit, provider } = createProvider({
    retry: () =>
      new Promise<CommandResult>((resolve) => (resolveRetry = resolve))
  });
  controller.setProvider(provider);
  emit({ commandsReady: true, lifecycle: 'ready', activation: 'ready' });

  const pending = controller.retry();
  expect(controller.getState().commandsReady).toBe(false);

  resolveRetry({ ok: true });
  await pending;
});

test('a retry refused without an error restores the declaration', async () => {
  const controller = new PlayerController();
  const { emit, provider } = createProvider({
    retry: async () => ({ ok: false, reason: 'unsupported' })
  });
  controller.setProvider(provider);
  emit({ commandsReady: true, lifecycle: 'ready', activation: 'ready' });

  // The sequence, not just the endpoint: a flag that was never dropped would
  // also end up `true`, so asserting the final value alone passes against the
  // unfixed code and proves nothing.
  const seen: boolean[] = [];
  controller.subscribe((state) => seen.push(state.commandsReady));

  await controller.retry();

  expect(seen).toContain(false);
  expect(controller.getState().commandsReady).toBe(true);
});
