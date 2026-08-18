import type { StoryContext } from '@storybook/react-vite';
import { createElement } from 'react';
import { describe, expect, it } from 'vitest';
import { withTheme } from '../.storybook/theme';

// Directly exercises the toolbar branch in `withTheme`. Before this, the
// `themed` value was only covered transitively (by stories/theme.stories.tsx
// pinning itself on); a typo in the global's string would slip past every fast
// unit test and silently leave every story headless. Structural assertions on
// the returned element keep this in the node suite without rendering a story.

const Story = () => createElement('div');

const decorate = (theme: string) =>
  withTheme(Story, {
    globals: { theme },
    parameters: {}
  } as unknown as StoryContext);

type ThemedChildren = readonly {
  readonly type: unknown;
  readonly props: { readonly children: string };
}[];

describe('withTheme toolbar gate', () => {
  it('renders the story bare (no theme <style>) when the toggle is headless', () => {
    const element = decorate('headless');
    expect(element.type).toBe(Story);
  });

  it('mounts the stylesheet alongside the story when the toggle is themed', () => {
    const element = decorate('themed');
    expect(element.type).not.toBe(Story);
    // A fragment holding the theme `<style>` and the bare story, in that order.
    const [style, story] = (element.props as { children: ThemedChildren })
      .children;
    expect(style.type).toBe('style');
    expect(style.props.children).toContain('@layer playdeck');
    expect(story.type).toBe(Story);
  });
});
