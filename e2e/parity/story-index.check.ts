import { expect, test } from '@playwright/test';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { fetchStoryIndex } from './story-index';

// A tiny local server, not the real Storybook dev servers: this pins how the
// module reads `/index.json`'s shape without paying for a Storybook boot, and
// without depending on either checkout being present.
const serve = (
  handler: (
    req: import('node:http').IncomingMessage,
    res: import('node:http').ServerResponse
  ) => void
): Promise<{ baseURL: string; close: () => Promise<void> }> =>
  new Promise((resolve) => {
    const server: Server = createServer(handler);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo;
      resolve({
        baseURL: `http://127.0.0.1:${port}`,
        close: () => new Promise((r) => server.close(() => r()))
      });
    });
  });

test('flattens index.json entries into a list', async () => {
  const { baseURL, close } = await serve((req, res) => {
    res.setHeader('content-type', 'application/json');
    res.end(
      JSON.stringify({
        v: 5,
        entries: {
          'a--default': {
            id: 'a--default',
            title: 'Components/Video/Video',
            name: 'Default',
            type: 'story'
          },
          'a--docs': {
            id: 'a--docs',
            title: 'Components/Video/Video',
            name: 'Docs',
            type: 'docs'
          }
        }
      })
    );
  });
  try {
    const entries = await fetchStoryIndex(baseURL);
    expect(entries).toContainEqual(
      expect.objectContaining({ id: 'a--default', name: 'Default' })
    );
    expect(entries).toHaveLength(2);
  } finally {
    await close();
  }
});

test('throws with the status code when index.json is not served', async () => {
  const { baseURL, close } = await serve((req, res) => {
    res.statusCode = 404;
    res.end('not found');
  });
  try {
    await expect(fetchStoryIndex(baseURL)).rejects.toThrow(/404/);
  } finally {
    await close();
  }
});
