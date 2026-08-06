import { expect, test } from '@playwright/test';
import { BACKPACK_ORIGIN, REELY_ORIGIN } from './origins';
import { fetchStoryIndex } from './story-index';

// The one test that makes a broken prerequisite obvious: if either dev
// server did not come up (most often the Backpack one, missing its
// checkout or its `predev` build), this fails here rather than as an
// unresolved story id somewhere downstream.
test('both Storybooks answer /index.json and carry the video stories this issue cares about', async () => {
  const [reely, backpack] = await Promise.all([
    fetchStoryIndex(REELY_ORIGIN),
    fetchStoryIndex(BACKPACK_ORIGIN)
  ]);

  expect(reely).toContainEqual(
    expect.objectContaining({
      title: 'Backpack parity/Mock/Video',
      name: 'Default'
    })
  );
  expect(backpack).toContainEqual(
    expect.objectContaining({
      title: 'Components/Video/Video',
      name: 'Default'
    })
  );
});
