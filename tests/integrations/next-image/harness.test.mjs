import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';
import { runWithCleanup, startNext } from './harness.mjs';

class FakeServer extends EventEmitter {
  stdout = new EventEmitter();
  stderr = new EventEmitter();
  /** @type {number | null} */
  exitCode = null;
  /** @type {(string | undefined)[]} */
  signals = [];

  /** @param {string} [signal] */
  kill(signal) {
    this.signals.push(signal);
    this.exitCode = 0;
    this.emit('exit', 0);
    return true;
  }
}

test('terminates Next before rejecting a startup timeout', async () => {
  const server = new FakeServer();

  await assert.rejects(
    startNext('fixture', { spawnProcess: () => server, startupTimeoutMs: 1 }),
    /Timed out waiting for next start/
  );

  assert.deepEqual(server.signals, ['SIGTERM']);
  assert.equal(server.listenerCount('error'), 0);
  assert.equal(server.listenerCount('exit'), 0);
  assert.equal(server.stdout.listenerCount('data'), 0);
  assert.equal(server.stderr.listenerCount('data'), 0);
});

test('rejects the original spawn error after lifecycle cleanup', async () => {
  const server = new FakeServer();
  const spawnFailure = new Error('spawn failed');
  const startup = startNext('fixture', {
    spawnProcess: () => server,
    startupTimeoutMs: 1_000
  });

  server.emit('error', spawnFailure);

  await assert.rejects(startup, spawnFailure);
  assert.deepEqual(server.signals, ['SIGTERM']);
  assert.equal(server.listenerCount('error'), 0);
  assert.equal(server.listenerCount('exit'), 0);
  assert.equal(server.stdout.listenerCount('data'), 0);
  assert.equal(server.stderr.listenerCount('data'), 0);
});

test('terminates Next after browser cleanup fails', async () => {
  const browserFailure = new Error('browser close failed');
  /** @type {string[]} */
  const calls = [];

  await assert.rejects(
    runWithCleanup({
      run: async () => undefined,
      closeBrowser: async () => {
        calls.push('browser');
        throw browserFailure;
      },
      terminateServer: async () => calls.push('server')
    }),
    browserFailure
  );

  assert.deepEqual(calls, ['browser', 'server']);
});

test('preserves the production failure after both cleanup attempts', async () => {
  const productionFailure = new Error('production assertion failed');
  /** @type {string[]} */
  const calls = [];

  await assert.rejects(
    runWithCleanup({
      run: async () => {
        throw productionFailure;
      },
      closeBrowser: async () => calls.push('browser'),
      terminateServer: async () => calls.push('server')
    }),
    productionFailure
  );

  assert.deepEqual(calls, ['browser', 'server']);
});
