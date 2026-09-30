// @vitest-environment node
// Pure chain logic, no DOM: exercises `createCommandChain` directly rather
// than through a control, so a coalescing defect is traced to the chain
// itself rather than inferred from a rendered slider.

import { afterEach, describe, expect, test, vi } from 'vitest';
import type { CommandResult } from '@playdeck/core';
import { createCommandChain } from '../src/optimistic-request';

// A promise this file settles by hand, standing in for a command still in
// flight -- the controllable-promise half of the brief's "no real 4s waits".
const deferred = <Value>(): {
  readonly promise: Promise<Value>;
  readonly resolve: (value: Value) => void;
} => {
  let resolve!: (value: Value) => void;
  const promise = new Promise<Value>((res) => {
    resolve = res;
  });
  return { promise, resolve };
};

const ok: CommandResult = { ok: true };
const failed: CommandResult = { ok: false, reason: 'provider-error' };

afterEach(() => {
  vi.useRealTimers();
});

describe('createCommandChain', () => {
  // The baseline coalescing behaviour, with no invalidation involved at all.
  // A guard, not a red case: it already holds on the unfixed code.
  test('coalesces a value sent while one is already in flight', async () => {
    const first = deferred<CommandResult>();
    const calls: number[] = [];
    const command = vi.fn((value: number) => {
      calls.push(value);
      return value === 1 ? first.promise : Promise.resolve(ok);
    });
    const chain = createCommandChain<number>({ command, onDrained: vi.fn() });

    chain.send(1);
    chain.send(2);
    chain.send(3);
    expect(calls).toEqual([1]);

    first.resolve(ok);
    await vi.waitFor(() => expect(calls).toEqual([1, 3]));
  });

  // Ordering (a): in-flight -> invalidate -> send(new) -> old settles -> new
  // value delivered once.
  test('delivers a value sent after invalidate, once the in-flight command drains', async () => {
    const first = deferred<CommandResult>();
    const calls: number[] = [];
    const command = vi.fn((value: number) => {
      calls.push(value);
      return value === 1 ? first.promise : Promise.resolve(ok);
    });
    const onDrained = vi.fn();
    const chain = createCommandChain<number>({ command, onDrained });

    chain.send(1);
    expect(calls).toEqual([1]);

    chain.invalidate();
    chain.send(2);
    // Still behind the in-flight command -- coalescing waits for the drain,
    // it does not start a second command alongside the first.
    expect(calls).toEqual([1]);

    first.resolve(ok);
    await vi.waitFor(() => expect(calls).toEqual([1, 2]));
    expect(onDrained).toHaveBeenCalledTimes(1);
  });

  // Ordering (b): in-flight -> send(old pending) -> invalidate -> old settles
  // -> old pending discarded. This is acceptance criterion 2 and already
  // holds on the unfixed code -- a guard, not a red case.
  test('discards a value sent before invalidate when the in-flight command drains', async () => {
    const first = deferred<CommandResult>();
    const calls: number[] = [];
    const command = vi.fn((value: number) => {
      calls.push(value);
      return value === 1 ? first.promise : Promise.resolve(ok);
    });
    const onDrained = vi.fn();
    const chain = createCommandChain<number>({ command, onDrained });

    chain.send(1);
    chain.send(2);
    chain.invalidate();

    first.resolve(ok);
    await vi.waitFor(() => expect(onDrained).toHaveBeenCalledTimes(1));
    expect(calls).toEqual([1]);
  });

  // Ordering (c): in-flight -> send(old pending) -> invalidate -> send(new)
  // -> old settles -> only the new value is delivered.
  test('delivers only the value sent after invalidate when it supersedes one sent before it', async () => {
    const first = deferred<CommandResult>();
    const calls: number[] = [];
    const command = vi.fn((value: number) => {
      calls.push(value);
      return value === 1 ? first.promise : Promise.resolve(ok);
    });
    const chain = createCommandChain<number>({ command, onDrained: vi.fn() });

    chain.send(1);
    chain.send(2); // aimed at the media that is about to go
    chain.invalidate();
    chain.send(3); // aimed at whatever replaces it

    first.resolve(ok);
    await vi.waitFor(() => expect(calls).toEqual([1, 3]));
    expect(calls).not.toContain(2);
  });

  // Ordering (d): two invalidates in a row with sends between each.
  test('keeps only the value sent after the last invalidate across repeated swaps', async () => {
    const first = deferred<CommandResult>();
    const calls: number[] = [];
    const command = vi.fn((value: number) => {
      calls.push(value);
      return value === 1 ? first.promise : Promise.resolve(ok);
    });
    const chain = createCommandChain<number>({ command, onDrained: vi.fn() });

    chain.send(1);
    chain.send(2);
    chain.invalidate();
    chain.send(3);
    chain.invalidate();
    chain.send(4);

    first.resolve(ok);
    await vi.waitFor(() => expect(calls).toEqual([1, 4]));
    expect(calls).not.toContain(2);
    expect(calls).not.toContain(3);
  });

  // Ordering (e), settle path: the in-flight command resolves with a failure
  // rather than succeeding. The post-invalidate value must still be delivered
  // -- discarding it is a fact about generation, not about `ok`.
  test('delivers a value sent after invalidate even when the in-flight command reports failure', async () => {
    const first = deferred<CommandResult>();
    const calls: number[] = [];
    const command = vi.fn((value: number) => {
      calls.push(value);
      return value === 1 ? first.promise : Promise.resolve(ok);
    });
    const chain = createCommandChain<number>({ command, onDrained: vi.fn() });

    chain.send(1);
    chain.invalidate();
    chain.send(2);

    first.resolve(failed);
    await vi.waitFor(() => expect(calls).toEqual([1, 2]));
  });

  // Ordering (e), timeout path: the in-flight command never settles at all,
  // so `COMMAND_TIMEOUT_MS` is what drains the chain rather than a resolution.
  test('delivers a value sent after invalidate even when the in-flight command times out', async () => {
    vi.useFakeTimers();
    const calls: number[] = [];
    const command = vi.fn((value: number) => {
      calls.push(value);
      // The first command never settles; the second answers at once.
      return value === 1
        ? new Promise<CommandResult>(() => {})
        : Promise.resolve(ok);
    });
    const onDrained = vi.fn();
    const chain = createCommandChain<number>({ command, onDrained });

    chain.send(1);
    chain.invalidate();
    chain.send(2);

    await vi.advanceTimersByTimeAsync(4000);
    expect(calls).toEqual([1, 2]);
  });
});
