import { onTestFinished } from 'vitest';

// A listener that throws inside one of the adapter's fan-outs has its error
// rethrown on a fresh task, so it still reaches the page's uncaught-error
// handling. In the runner that lands as an unhandled error and fails the whole
// file, so a test that throws from a listener on purpose captures those
// rethrows instead — and the test that owns the surfacing contract asserts
// against what was captured.
//
// The scheduler is wrapped rather than replaced: the fixtures schedule
// microtasks of their own, and swallowing those would stall the very work these
// tests drive. Collected rather than discarded, so a rethrow nobody expected is
// still visible to the test that wants to look. Restored when the test ends.
export const captureRethrows = (): unknown[] => {
  const errors: unknown[] = [];
  const real = globalThis.queueMicrotask;
  globalThis.queueMicrotask = (task: () => void) =>
    real(() => {
      try {
        task();
      } catch (error) {
        errors.push(error);
      }
    });
  onTestFinished(() => {
    globalThis.queueMicrotask = real;
  });
  return errors;
};
