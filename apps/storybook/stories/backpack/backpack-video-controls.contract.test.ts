import type * as Player from '@reely/react';
import { cleanup, render } from '@testing-library/react';
import { createElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BackpackVideo } from './backpack-video';

/**
 * `controls: false` must hide YouTube's own chrome, not just Reely's own
 * composed control bar (`packages/provider-youtube/src/attachment.ts`'s
 * `playerVars.controls`). The wrapper's own contribution is now one prop:
 * `controls` reaches `Player.Root`, whose one home for the setting is what
 * fans it out to whichever provider the source resolves to (ADR-0004,
 * `docs/adr/0004-cross-provider-options-live-on-root.md`). Everything past
 * that point is pinned in `@reely/react` and the provider packages --
 * `packages/react/test/youtube.test.tsx` and `packages/react/test/vimeo.test.tsx`
 * (the prop folding into each provider's own option bag),
 * `packages/react/test/index.test.tsx` (the `<video controls>` attribute for a
 * native or HLS source), and `packages/provider-youtube/test/index.test.ts`
 * (the polarity).
 *
 * So what is left for this file is the wrapper's half, and it is two claims:
 * the prop is passed on rather than dropped, and the wrapper writes no
 * `controls` of its own into the `providerOptions` bag beside it. The second is
 * the one worth a test -- the bag is where this wrapper used to carry the
 * setting, and a bag key would be a second home the fan-out never reads for
 * Vimeo or a native source.
 *
 * Same interception as `external-control.contract.test.ts`: `@reely/react`'s
 * own `Root` is intercepted to record the props it receives, then the genuine
 * component renders underneath so `BackpackVideoSurface`'s hooks still run
 * against a real `PlayerContext.Provider`. Reaching one layer further would
 * need a real embed, which this suite keeps offline.
 */

const { capturedRootProps } = vi.hoisted(() => ({
  capturedRootProps: [] as Player.RootProps[]
}));

vi.mock('@reely/react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@reely/react')>();
  return {
    ...actual,
    Root: (props: Player.RootProps) => {
      capturedRootProps.push(props);
      return createElement(actual.Root, props);
    }
  };
});

/** The last `Player.Root` render's props. */
const rootProps = (): Player.RootProps => capturedRootProps.at(-1)!;

describe('BackpackVideo controls forwarding', () => {
  afterEach(() => {
    cleanup();
    capturedRootProps.length = 0;
  });

  it('hands controls: true to Player.Root, and writes no controls into the option bag', () => {
    render(
      createElement(BackpackVideo, {
        controls: true,
        url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ'
      })
    );

    expect(rootProps().controls).toBe(true);
    // No `youtube` bag at all, rather than one carrying `controls: undefined`:
    // the wrapper wires Wistia's presentation options and nothing else, and
    // `PlayerProviderOptions` has no `controls` key to write here anyway
    // (`packages/react/src/provider-loaders.ts`'s `Omit<..., 'controls'>`).
    expect(rootProps().providerOptions).not.toHaveProperty('youtube');
  });

  it('hands controls: false (the default) to Player.Root', () => {
    render(
      createElement(BackpackVideo, {
        url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ'
      })
    );

    expect(rootProps().controls).toBe(false);
    expect(rootProps().providerOptions).not.toHaveProperty('youtube');
  });
});
