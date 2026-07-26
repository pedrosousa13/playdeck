import { expect, test } from 'vitest';
import {
  PlayerController,
  createInitialPlayerState,
  type ProviderStateListener
} from '../src/index';

const createProvider = (
  overrides: {
    onSubscribe?: (listener: ProviderStateListener) => void;
    selectQuality?: (id: string | null) => Promise<{ ok: true }>;
  } = {}
) => ({
  provider: 'hls' as const,
  attach: () => undefined,
  load: () => undefined,
  destroy: () => undefined,
  subscribe: (listener: ProviderStateListener) => {
    overrides.onSubscribe?.(listener);
    return () => undefined;
  },
  ...(overrides.selectQuality ? { selectQuality: overrides.selectQuality } : {})
});

test('initial state reports no effective HLS engine and no quality', () => {
  const state = createInitialPlayerState();

  expect(state.hlsEngine).toBeNull();
  expect(state.quality).toBeNull();
  expect(state.qualities).toEqual([]);
  expect(Object.isFrozen(state.qualities)).toBe(true);
  expect(state.selectedQualityId).toBeNull();
});

test('reflects provider hlsEngine and quality patches in frozen state', () => {
  const controller = new PlayerController();
  let emit: ProviderStateListener | undefined;
  controller.setProvider(
    createProvider({ onSubscribe: (listener) => (emit = listener) })
  );

  emit?.({ hlsEngine: 'hls.js' });
  emit?.({
    quality: {
      id: 'hls:720x1280@2000000',
      height: 720,
      width: 1280,
      bitrate: 2_000_000
    }
  });

  const state = controller.getState();
  expect(state.hlsEngine).toBe('hls.js');
  expect(state.quality).toEqual({
    id: 'hls:720x1280@2000000',
    height: 720,
    width: 1280,
    bitrate: 2_000_000
  });
  expect(Object.isFrozen(state.quality)).toBe(true);

  emit?.({ quality: null });
  expect(controller.getState().quality).toBeNull();
  expect(controller.getState().hlsEngine).toBe('hls.js');
});

test('resets hlsEngine and quality when the provider detaches', () => {
  const controller = new PlayerController();
  let emit: ProviderStateListener | undefined;
  controller.setProvider(
    createProvider({ onSubscribe: (listener) => (emit = listener) })
  );
  emit?.({
    hlsEngine: 'native',
    quality: { id: 'hls:180x320@-', height: 180, width: 320, bitrate: null },
    qualities: [
      { id: 'hls:180x320@-', height: 180, width: 320, bitrate: null }
    ],
    selectedQualityId: 'hls:180x320@-'
  });

  controller.setProvider(undefined);

  expect(controller.getState().hlsEngine).toBeNull();
  expect(controller.getState().quality).toBeNull();
  expect(controller.getState().qualities).toEqual([]);
  expect(controller.getState().selectedQualityId).toBeNull();
});

test('copies and freezes the qualities list out of the patch', () => {
  const controller = new PlayerController();
  let emit: ProviderStateListener | undefined;
  controller.setProvider(
    createProvider({ onSubscribe: (listener) => (emit = listener) })
  );
  const mutable = [
    { id: 'hls:180x320@400000', height: 180, width: 320, bitrate: 400_000 }
  ];

  emit?.({ qualities: mutable });
  mutable.push({
    id: 'hls:90x160@150000',
    height: 90,
    width: 160,
    bitrate: 150_000
  });

  const published = controller.getState().qualities;
  expect(published).toHaveLength(1);
  expect(Object.isFrozen(published)).toBe(true);
  expect(Object.isFrozen(published[0])).toBe(true);
});

test('forwards selectQuality to the provider command', async () => {
  const ids: Array<string | null> = [];
  const controller = new PlayerController();
  controller.setProvider(
    createProvider({
      selectQuality: async (id) => {
        ids.push(id);
        return { ok: true };
      }
    })
  );

  await expect(
    controller.selectQuality('hls:720x1280@2000000')
  ).resolves.toEqual({ ok: true });
  await expect(controller.selectQuality(null)).resolves.toEqual({ ok: true });

  expect(ids).toEqual(['hls:720x1280@2000000', null]);
});

test('reports selectQuality as unsupported when the provider lacks it', async () => {
  const controller = new PlayerController();
  controller.setProvider(createProvider());

  await expect(
    controller.selectQuality('hls:720x1280@2000000')
  ).resolves.toEqual({
    ok: false,
    reason: 'unsupported'
  });
});

test('reports selectQuality as not ready without a provider', async () => {
  const controller = new PlayerController();

  await expect(
    controller.selectQuality('hls:720x1280@2000000')
  ).resolves.toEqual({
    ok: false,
    reason: 'not-ready'
  });
});
