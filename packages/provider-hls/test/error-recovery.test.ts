import { expect, test, vi } from 'vitest';
import type { PlayerError } from '@playdeck/core';
import { createHlsErrorRecovery } from '../src/error-recovery';

const errorTypes = {
  ErrorTypes: { NETWORK_ERROR: 'networkError', MEDIA_ERROR: 'mediaError' }
} as const;

const createFakeInstance = () => ({
  startLoad: vi.fn(),
  recoverMediaError: vi.fn(),
  swapAudioCodec: vi.fn()
});

const createRecovery = (isStale: () => boolean = () => false) => {
  const surfaced: PlayerError[] = [];
  const recovery = createHlsErrorRecovery({
    isStale,
    surfaceFatal: (error) => surfaced.push(error)
  });
  return { recovery, surfaced };
};

test('ignores non-fatal errors entirely', () => {
  const { recovery, surfaced } = createRecovery();
  const instance = createFakeInstance();
  recovery.handleError(instance, errorTypes, {
    type: 'networkError',
    fatal: false
  });
  expect(instance.startLoad).not.toHaveBeenCalled();
  expect(surfaced).toEqual([]);
});

test('ignores errors from a stale or superseded instance', () => {
  const { recovery, surfaced } = createRecovery(() => true);
  const instance = createFakeInstance();
  recovery.handleError(instance, errorTypes, {
    type: 'networkError',
    fatal: true
  });
  expect(instance.startLoad).not.toHaveBeenCalled();
  expect(surfaced).toEqual([]);
});

test('retries a fatal network error twice, then surfaces a network error', () => {
  const { recovery, surfaced } = createRecovery();
  const instance = createFakeInstance();
  const data = { type: 'networkError', fatal: true };
  recovery.handleError(instance, errorTypes, data);
  recovery.handleError(instance, errorTypes, data);
  expect(instance.startLoad).toHaveBeenCalledTimes(2);
  expect(surfaced).toEqual([]);
  recovery.handleError(instance, errorTypes, data);
  expect(instance.startLoad).toHaveBeenCalledTimes(2);
  expect(surfaced).toEqual([
    {
      category: 'network',
      fatal: true,
      recoverable: true,
      message: 'HLS playback failed after bounded network error recovery.',
      cause: data
    }
  ]);
});

test('recovers a fatal media error twice, swapping the audio codec on the second attempt, then surfaces a decode error', () => {
  const { recovery, surfaced } = createRecovery();
  const instance = createFakeInstance();
  const data = { type: 'mediaError', fatal: true };
  recovery.handleError(instance, errorTypes, data);
  expect(instance.recoverMediaError).toHaveBeenCalledTimes(1);
  expect(instance.swapAudioCodec).not.toHaveBeenCalled();
  recovery.handleError(instance, errorTypes, data);
  expect(instance.recoverMediaError).toHaveBeenCalledTimes(2);
  expect(instance.swapAudioCodec).toHaveBeenCalledTimes(1);
  expect(surfaced).toEqual([]);
  recovery.handleError(instance, errorTypes, data);
  expect(instance.recoverMediaError).toHaveBeenCalledTimes(2);
  expect(surfaced).toEqual([
    {
      category: 'decode',
      fatal: true,
      recoverable: true,
      message: 'HLS playback failed after bounded media error recovery.',
      cause: data
    }
  ]);
});

test('keeps the network and media recovery budgets independent', () => {
  const { recovery, surfaced } = createRecovery();
  const instance = createFakeInstance();
  recovery.handleError(instance, errorTypes, {
    type: 'networkError',
    fatal: true
  });
  recovery.handleError(instance, errorTypes, {
    type: 'networkError',
    fatal: true
  });
  recovery.handleError(instance, errorTypes, {
    type: 'mediaError',
    fatal: true
  });
  recovery.handleError(instance, errorTypes, {
    type: 'mediaError',
    fatal: true
  });
  expect(instance.startLoad).toHaveBeenCalledTimes(2);
  expect(instance.recoverMediaError).toHaveBeenCalledTimes(2);
  expect(surfaced).toEqual([]);
});

test('surfaces any other fatal error type as an unrecoverable provider error', () => {
  const { recovery, surfaced } = createRecovery();
  const instance = createFakeInstance();
  recovery.handleError(instance, errorTypes, {
    type: 'muxError',
    details: 'fragParsingError',
    fatal: true
  });
  expect(surfaced).toHaveLength(1);
  expect(surfaced[0]).toMatchObject({
    category: 'provider',
    fatal: true,
    recoverable: true,
    message: 'hls.js reported an unrecoverable fatal error: fragParsingError'
  });
});

test('falls back to a generic message when the fatal error carries no details', () => {
  const { recovery, surfaced } = createRecovery();
  const instance = createFakeInstance();
  recovery.handleError(instance, errorTypes, { fatal: true });
  expect(surfaced).toHaveLength(1);
  expect(surfaced[0]?.message).toBe(
    'hls.js reported an unrecoverable fatal error.'
  );
});

test('reset re-arms both recovery budgets', () => {
  const { recovery, surfaced } = createRecovery();
  const instance = createFakeInstance();
  const network = { type: 'networkError', fatal: true };
  recovery.handleError(instance, errorTypes, network);
  recovery.handleError(instance, errorTypes, network);
  recovery.reset();
  recovery.handleError(instance, errorTypes, network);
  expect(instance.startLoad).toHaveBeenCalledTimes(3);
  expect(surfaced).toEqual([]);
});
