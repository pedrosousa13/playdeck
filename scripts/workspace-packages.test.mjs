import assert from 'node:assert/strict';
import test from 'node:test';
import { selectPublishable } from './workspace-packages.mjs';

test('keeps the workspace projects that are not private', () => {
  assert.deepEqual(
    selectPublishable([
      { name: 'reely', path: '/w', private: true },
      {
        name: '@reely/core',
        version: '0.0.0',
        path: '/w/packages/core',
        private: false
      },
      { name: '@reely/storybook', path: '/w/apps/storybook', private: true }
    ]).map((entry) => entry.name),
    ['@reely/core']
  );
});

test('refuses a listing with nothing publishable in it', () => {
  // An empty result is never a legitimate answer here: it means the discovery
  // command changed shape, and every caller would then silently check nothing.
  assert.throws(
    () => selectPublishable([{ name: 'reely', path: '/w', private: true }]),
    /No publishable workspace packages were discovered/
  );
});
