// @vitest-environment node

import { expect, test, vi } from 'vitest';
import { loadWistiaPlayer } from '../src/loader';

test('rejects without importing the SDK when no browser document exists', async () => {
  const importSdk = vi.fn();

  await expect(loadWistiaPlayer(importSdk)).rejects.toThrow(
    'The Wistia player requires a browser document.'
  );
  expect(importSdk).not.toHaveBeenCalled();
});
