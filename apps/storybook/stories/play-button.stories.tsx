import * as Player from '@reely/react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect } from 'storybook/test';
import { withCss } from '../.storybook/theme';
import { ready } from './support';
// The stylesheet the Styled story mounts, read as text so the same string is
// both what renders and what the docs block below prints. Nothing to keep in
// sync: there is one copy, and `pnpm docs:check` gates the copy of it that
// Overview/Contract shows.
//
// `?raw` rather than `?inline`: a production build runs `?inline` css through
// the minifier, which would print this example as one comment-less line while
// Overview/Contract kept the readable source. `?raw` is unprocessed, so the two
// surfaces stay byte-identical. It mounts in a `<style>` just the same.
import partCss from '../../../examples/css-play-button.css?raw';

const meta = {
  title: 'Player/PlayButton',
  component: Player.PlayButton,
  parameters: {
    docs: {
      description: {
        component: [
          '`Player.PlayButton` toggles play/pause on the active provider.',
          '',
          '**Usage** — compose it under `Player.Root` (a `Player.Viewport` or `Player.Controls` gives it layout context):',
          '```tsx',
          '<Player.Root source={source}>',
          '  <Player.Viewport>',
          '    <Player.PlayButton />',
          '  </Player.Viewport>',
          '</Player.Root>',
          '```',
          '',
          '**Contract** — renders `data-reely-part="play-button"`, `data-provider="<provider>"`, and `data-state="paused" | "playing"`.',
          '',
          '**Accessibility** — a native `<button>`; label switches between "Play" and "Pause"; reachable and operable by keyboard (Tab to focus, Enter/Space to toggle).',
          '',
          '**Capability** — not capability-gated; always renders (`data-provider` is set once a provider attaches).',
          '',
          '**Styling** — plain CSS against the part. The `Styled` story below mounts this file as its own `<style>`. Turning the Theme toolbar toggle on adds `theme.css` underneath, not over: everything here is unlayered, and unlayered CSS beats the `@layer reely` the whole theme lives in:',
          '```css',
          partCss.trim(),
          '```'
        ].join('\n')
      }
    }
  },
  render: () => (
    <Player.Viewport style={{ width: 480, height: 270, background: '#0b0e13' }}>
      <Player.PlayButton />
    </Player.Viewport>
  )
} satisfies Meta<typeof Player.PlayButton>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Paused: Story = {
  parameters: ready({}, { playback: 'paused' }),
  play: async ({ canvas }) => {
    const button = await canvas.findByRole('button', { name: 'Play' });
    await expect(button).toHaveAttribute('data-state', 'paused');
    await expect(button.tagName).toBe('BUTTON');
  }
};

export const Playing: Story = {
  parameters: ready({}, { playback: 'playing' }),
  play: async ({ canvas }) => {
    const button = await canvas.findByRole('button', { name: 'Pause' });
    await expect(button).toHaveAttribute('data-state', 'playing');
  }
};

/**
 * Autoplay was blocked by the browser: the configured autoplay attempt hits a
 * failing `play()` with `reason: 'blocked'`, so the button surfaces
 * `data-autoplay-state="blocked"` for styling a "tap to play" affordance.
 */
export const AutoplayBlocked: Story = {
  parameters: {
    player: {
      state: ready().player.state,
      autoplay: 'audible',
      playResult: { ok: false, reason: 'blocked' }
    }
  },
  play: async ({ canvas }) => {
    const button = await canvas.findByRole('button', { name: 'Play' });
    await expect(button).toHaveAttribute('data-autoplay-state', 'blocked');
  }
};

/** Autoplay was attempted and failed for a non-policy (provider) reason. */
export const AutoplayFailed: Story = {
  parameters: {
    player: {
      state: ready().player.state,
      autoplay: 'audible',
      playResult: { ok: false, reason: 'provider-error' }
    }
  },
  play: async ({ canvas }) => {
    const button = await canvas.findByRole('button', { name: 'Play' });
    await expect(button).toHaveAttribute('data-autoplay-state', 'failed');
  }
};

/**
 * The same button with the CSS from this page's **Styling** section applied.
 * Mounted as a `<style>` inside this story's own tree, so it is torn down with
 * the story and no other story on the page sees it.
 */
export const Styled: Story = {
  decorators: [withCss(partCss)],
  parameters: ready({}, { playback: 'playing' }),
  play: async ({ canvas }) => {
    const button = await canvas.findByRole('button', { name: 'Pause' });
    const styles = globalThis.getComputedStyle(button);
    await expect(styles.borderRadius).toBe('50%');
    // The `[data-state='playing']` rule, not the base one: an example whose
    // state selector never fires teaches the wrong thing.
    await expect(styles.backgroundColor).toBe('rgb(46, 90, 172)');
  }
};

/** Focus behavior: the native button is reachable by keyboard. */
export const KeyboardFocusable: Story = {
  parameters: ready({}, { playback: 'paused' }),
  play: async ({ canvas, userEvent }) => {
    const button = await canvas.findByRole('button', { name: 'Play' });
    await userEvent.tab();
    await expect(button).toHaveFocus();
  }
};
