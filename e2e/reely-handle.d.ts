import type { PlayerHandle } from '@reely/react';

// `player-fixture.stories.tsx` publishes the story's handle on the window, and
// the specs drive it from `page.evaluate`. Declaring it once, as the real
// `PlayerHandle`, is what makes the e2e suite a consumer of the public types:
// a spec that reads a state field the player does not expose now fails
// `pnpm typecheck` instead of at runtime in a browser. Four specs each used to
// declare their own narrower approximation of this, which TypeScript merged
// into whichever one it saw first.
declare global {
  interface Window {
    reelyHandle?: PlayerHandle;
  }
}
