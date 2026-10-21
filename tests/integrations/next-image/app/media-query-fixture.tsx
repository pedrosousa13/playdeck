'use client';

import { useEffect } from 'react';
import * as Player from '@playdeck/react';

// #913's real-browser check for the server-rendered path: `loading="eager"`
// commits a `video` file source at render time, so Next's own SSR pass puts
// every `sources[].media` candidate in the HTML it streams, exactly the
// shape `packages/react/test/eager-video-ssr.test.tsx` proves against
// `renderToString` directly, and `test-media-query.mjs` (this package)
// drives it through a real `next start` + a real browser instead.
export const MediaQueryFixture = () => {
  useEffect(() => {
    document.documentElement.dataset.hydrated = 'true';
  }, []);

  return (
    <Player.Root
      loading="eager"
      source={{
        type: 'video',
        sources: [
          {
            src: '/mobile.mp4',
            mimeType: 'video/mp4',
            media: '(max-width: 600px)'
          },
          {
            src: '/desktop.mp4',
            mimeType: 'video/mp4',
            media: '(min-width: 601px)'
          }
        ]
      }}
    >
      <Player.Viewport style={{ aspectRatio: '16 / 9', width: 640 }}>
        <Player.Media />
      </Player.Viewport>
    </Player.Root>
  );
};
