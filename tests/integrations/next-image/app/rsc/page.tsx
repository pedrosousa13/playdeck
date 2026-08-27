// The RSC route. There is deliberately no `'use client'` in this file: it is a
// React Server Component that imports the player primitives directly, so the
// only thing that can put a client boundary under them is the directive
// `@playdeck/react` ships on its own entry. Remove that directive and
// `next build` fails on this file, once for each React API it finds the
// package's built entry reaching for.
//
// `@playdeck/core` is imported alongside it and used on the server, which is
// the other half of the claim: that package touches no React API, carries no
// directive, and stays usable from server code.
import { detectSource } from '@playdeck/core';
import * as Player from '@playdeck/react';

const detected = detectSource('/fixture.mp4');

export default function Page() {
  return (
    <Player.Root loading="interaction" source="/fixture.mp4">
      <Player.Viewport
        data-source-status={detected.status}
        style={{ aspectRatio: '16 / 9', width: 640 }}
      >
        <Player.ActivationButton />
      </Player.Viewport>
    </Player.Root>
  );
}
