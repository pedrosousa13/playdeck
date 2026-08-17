import { notifySafely, type ProviderStateListener } from '@reely/core';

// What a provider adapter owes the subscribers it fans out to. `Set.forEach`
// stops at the first throw, so one broken listener would abandon the emit:
// every listener registered behind it misses that notification, and the throw
// escapes back into whatever called the emit — often a vendor SDK's own event
// dispatch, or the adapter's start path, where it would be reported as a
// provider load failure rather than as the consumer's bug it is.
const listeners = new Set<ProviderStateListener>();

export const subscribe = (listener: ProviderStateListener): (() => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

// Isolated, not silenced: a listener that throws has its error rethrown on a
// fresh task, so it still reaches the page's uncaught-error handling the way a
// listener throwing at top level would.
export const emit: ProviderStateListener = (patch, event) => {
  listeners.forEach((listener) => notifySafely(listener, patch, event));
};

subscribe(() => {
  throw new Error('a subscriber defect');
});
const seen: string[] = [];
subscribe((patch) => {
  seen.push(patch.lifecycle ?? 'unchanged');
});

emit({ lifecycle: 'ready' });

console.log(seen); // ['ready'] — the subscriber behind the thrower still ran
