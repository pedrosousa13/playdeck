'use client';

import Image from 'next/image';
import { useEffect } from 'react';
import * as Player from '@playdeck/react';

export const PlayerFixture = () => {
  useEffect(() => {
    document.documentElement.dataset.hydrated = 'true';
  }, []);

  return (
    <Player.Root source="/fixture.mp4">
      <Player.Viewport style={{ aspectRatio: '16 / 9', width: 640 }}>
        <Player.Poster>
          <Image
            alt=""
            fill
            preload
            sizes="(max-width: 640px) 100vw, 640px"
            src="/poster.svg"
          />
        </Player.Poster>
      </Player.Viewport>
    </Player.Root>
  );
};
