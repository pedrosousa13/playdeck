// @vitest-environment node

import { expect, test, vi } from 'vitest';
import { loadWistiaPlayer } from '../src/loader';

test('rejects without injecting a script when no browser document exists', async () => {
  const injectScript = vi.fn();

  await expect(loadWistiaPlayer(injectScript)).rejects.toThrow(
    'The Wistia player requires a browser document.'
  );
  expect(injectScript).not.toHaveBeenCalled();
});
