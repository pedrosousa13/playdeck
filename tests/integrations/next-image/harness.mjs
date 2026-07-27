/* global clearTimeout, process, setTimeout */

import { spawn } from 'node:child_process';

/**
 * The subset of a spawned process this harness actually drives. Narrower than
 * `ChildProcess` on purpose -- it is exactly what the fake in harness.test.mjs
 * implements, so the fake and the real thing are checked against one contract.
 * @typedef {import('node:events').EventEmitter & {
 *   exitCode: number | null;
 *   stdout: import('node:events').EventEmitter;
 *   stderr: import('node:events').EventEmitter;
 *   kill: (signal?: NodeJS.Signals) => boolean;
 * }} NextServer
 */

/**
 * @typedef {(
 *   command: string,
 *   args: readonly string[],
 *   options: { cwd: string; stdio: 'pipe' }
 * ) => NextServer} SpawnProcess
 */

/** @param {string} output */
const localUrl = (output) =>
  output.match(/- Local:\s+(http:\/\/127\.0\.0\.1:\d+)/)?.[1];

/** @param {NextServer} server */
export const terminate = async (server) => {
  if (server.exitCode !== null) return;
  const exited = new Promise((resolve) => server.once('exit', resolve));
  const timeout = setTimeout(() => {
    if (server.exitCode === null) server.kill('SIGKILL');
  }, 5_000);
  try {
    if (!server.kill('SIGTERM')) return;
    await exited;
  } finally {
    clearTimeout(timeout);
  }
};

/**
 * @param {string} cwd
 * @param {{ spawnProcess?: SpawnProcess; startupTimeoutMs?: number }} [options]
 * @returns {Promise<{ origin: string; server: NextServer }>}
 */
export const startNext = async (cwd, options) => {
  // `stdio: 'pipe'` is what guarantees stdout and stderr are non-null, which
  // the ChildProcess type cannot express at the call site.
  const {
    spawnProcess = /** @type {SpawnProcess} */ (/** @type {unknown} */ (spawn)),
    startupTimeoutMs = 10_000
  } = options ?? {};
  const server = spawnProcess(
    process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm',
    ['exec', 'next', 'start', '--hostname', '127.0.0.1', '--port', '0'],
    { cwd, stdio: 'pipe' }
  );

  return new Promise((resolve, reject) => {
    let settled = false;
    let output = '';
    /** @type {NodeJS.Timeout | undefined} */
    let startupTimeout;
    const cleanup = () => {
      clearTimeout(startupTimeout);
      server.stdout.off('data', capture);
      server.stderr.off('data', capture);
      server.off('error', onError);
      server.off('exit', onExit);
    };
    /** @param {{ origin: string; server: NextServer }} value */
    const settle = (value) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(value);
    };
    /** @param {unknown} error */
    const fail = async (error) => {
      if (settled) return;
      settled = true;
      cleanup();
      try {
        await terminate(server);
      } catch {
        // Preserve the startup error as the primary failure.
      }
      reject(error);
    };
    const ready = () => {
      const origin = localUrl(output);
      if (origin && output.includes('Ready')) settle({ origin, server });
    };
    /** @param {unknown} chunk */
    const capture = (chunk) => {
      output += chunk;
      ready();
    };
    /** @param {unknown} error */
    const onError = (error) => void fail(error);
    /** @param {number | null} code */
    const onExit = (code) =>
      void fail(new Error(`next start exited with code ${code}.\n${output}`));
    server.stdout.on('data', capture);
    server.stderr.on('data', capture);
    server.once('error', onError);
    server.once('exit', onExit);
    startupTimeout = setTimeout(
      () => void fail(new Error('Timed out waiting for next start.')),
      startupTimeoutMs
    );
  });
};

/**
 * @template T
 * @param {{
 *   run: () => Promise<T>;
 *   closeBrowser: () => Promise<unknown>;
 *   terminateServer: () => Promise<unknown>;
 * }} lifecycle
 * @returns {Promise<T | undefined>}
 */
export const runWithCleanup = async ({
  run,
  closeBrowser,
  terminateServer
}) => {
  /** @type {T | undefined} */
  let result;
  /** @type {unknown} */
  let primaryError;
  try {
    result = await run();
  } catch (error) {
    primaryError = error;
  }

  /** @type {unknown} */
  let cleanupError;
  try {
    await closeBrowser();
  } catch (error) {
    cleanupError = error;
  }
  try {
    await terminateServer();
  } catch (error) {
    cleanupError ??= error;
  }

  if (primaryError) throw primaryError;
  if (cleanupError) throw cleanupError;
  return result;
};
