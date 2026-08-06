import type { PlayerHandle, RootProps } from '@reely/react';
import { Root } from '@reely/react';
import type { StoryContext } from '@storybook/react-vite';
import { act, cleanup, render } from '@testing-library/react';
import { createElement, useEffect, type RefObject } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import {
  useMockPlayer,
  withMockPlayer,
  type MockPlayerParameters
} from '../.storybook/mock-player';
import { ready } from './support';

// Directly exercises the tag-gate branch in `withMockPlayer`. Before this,
// the `real-playback` opt-out was only covered transitively (by CI actually
// running the real-playback stories); a typo in the tag string would slip
// past every fast unit test. Structural assertions on the returned element
// keep this in the node suite without rendering Player.Root.

const Story = () => createElement('div');

const decorate = (tags: string[]) =>
  withMockPlayer(Story, {
    tags,
    parameters: {}
  } as unknown as StoryContext);

describe('withMockPlayer tag gate', () => {
  it('renders the story bare (no mock Root wrapper) when tagged real-playback', () => {
    const element = decorate(['real-playback']);
    expect(element.type).toBe(Story);
  });

  it('wraps the story in the mock Root when not tagged real-playback', () => {
    const element = decorate([]);
    expect(element.type).not.toBe(Story);
    // The bare story is nested inside the wrapper, not returned directly.
    const children = (element.props as { children: { type: unknown } })
      .children;
    expect(children.type).toBe(Story);
  });
});

/*
 * `seekTo`, the one command the mock adapter answers with a state report, and the
 * only one whose report is gated on a knob named for something else. It exists so
 * that a story can put a position on a player that decodes nothing — which is what
 * `Backpack parity/Mock/VideoHoverPreview` needs to watch a preview window enforced by
 * position — and the gate exists so that a story asking for a non-reporting player
 * still gets one. Both halves are asserted here because the second has no story:
 * nothing in the workbench seeks a mock without `reportsPlayback`, so only a test
 * can keep the gate honest.
 */

/** Never fetched: `Player.Root` commits no source unless something activates it. */
const source: RootProps['source'] = {
  type: 'video',
  sources: [{ src: 'mock://reely/video.mp4', mimeType: 'video/mp4' }]
};

/**
 * A `Player.Root` with the mock staged into it, and a getter for the handle it
 * staged through — which is the same handle a story holds, so what the assertions
 * below drive is exactly what a story would.
 */
const stageMockPlayer = (parameters: MockPlayerParameters) => {
  // Handed out from an effect rather than assigned during render: a render-time
  // write to a variable outside the component is a side effect, and the rule that
  // forbids it is right even in a test.
  const staged: { current?: RefObject<PlayerHandle | null> } = {};
  const Harness = () => {
    const ref = useMockPlayer(parameters);
    useEffect(() => {
      staged.current = ref;
    }, [ref]);
    return createElement(Root, {
      children: null,
      loading: 'interaction',
      ref,
      source
    });
  };
  render(createElement(Harness));
  return () => staged.current!.current!;
};

describe('mock player seekTo', () => {
  afterEach(cleanup);

  it('reports the new position when reportsPlayback is set', async () => {
    const player = stageMockPlayer({
      ...ready({}, { playback: 'paused' }).player,
      reportsPlayback: true
    });

    let result;
    await act(async () => {
      result = await player().seekTo(4);
    });

    expect(result).toEqual({ ok: true });
    expect(player().getState().currentTime).toBe(4);
  });

  it('answers a seek without reporting anything when it is not', async () => {
    const player = stageMockPlayer(ready({}, { playback: 'paused' }).player);

    let result;
    await act(async () => {
      result = await player().seekTo(4);
    });

    // Supported — a real provider can seek whether or not a story wants to watch
    // the result — and silent, which is what "not set" has always meant for this
    // mock. `unsupported` here would misdescribe the player's capabilities.
    expect(result).toEqual({ ok: true });
    expect(player().getState().currentTime).toBe(0);
  });
});
