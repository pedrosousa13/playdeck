import type * as Player from '@reely/react';
import { cleanup, render } from '@testing-library/react';
import { createElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BackpackVideo } from './backpack-video';

/**
 * `controls: false` must hide YouTube's own chrome, not just Reely's control
 * bar (`packages/provider-youtube/src/attachment.ts`'s `playerVars.controls`).
 * The wrapper's own contribution is forwarding its `controls` prop into the
 * `youtube` entry of the `providerOptions` bag it hands `Player.Root`
 * (`backpack-video.tsx`'s `providerOptions` memo) -- everything past that
 * point is pinned by `packages/provider-youtube/test/index.test.ts` (the
 * polarity) and `packages/react/test/youtube.test.tsx` (the bag reaching
 * `createYouTubeProvider`).
 *
 * Same interception as `external-control.contract.test.ts`: `@reely/react`'s
 * own `Root` is intercepted to record `providerOptions`, then the genuine
 * component renders underneath so `BackpackVideoSurface`'s hooks still run
 * against a real `PlayerContext.Provider`. Reaching one layer further would
 * need a real embed, which this suite keeps offline.
 */

const { capturedProviderOptions } = vi.hoisted(() => ({
  capturedProviderOptions: [] as unknown[]
}));

vi.mock('@reely/react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@reely/react')>();
  return {
    ...actual,
    Root: (props: Player.RootProps) => {
      capturedProviderOptions.push(props.providerOptions);
      return createElement(actual.Root, props);
    }
  };
});

describe('BackpackVideo controls forwarding', () => {
  afterEach(() => {
    cleanup();
    capturedProviderOptions.length = 0;
  });

  it('forwards controls: true into the youtube provider option bag', () => {
    render(
      createElement(BackpackVideo, {
        controls: true,
        url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ'
      })
    );

    expect(capturedProviderOptions.at(-1)).toMatchObject({
      youtube: { controls: true }
    });
  });

  it('forwards controls: false (the default) into the youtube provider option bag', () => {
    render(
      createElement(BackpackVideo, {
        url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ'
      })
    );

    expect(capturedProviderOptions.at(-1)).toMatchObject({
      youtube: { controls: false }
    });
  });
});
