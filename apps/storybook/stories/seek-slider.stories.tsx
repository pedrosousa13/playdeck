import * as Player from '@reely/react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, waitFor } from 'storybook/test';
import { withCss } from '../.storybook/theme';
import { available, notReady, ready } from './support';
// The stylesheet the Styled story mounts, read as text so the same string is
// both what renders and what the docs block below prints. `?raw` and not
// `?inline` for the reason spelled out in play-button.stories.tsx: a production
// build minifies `?inline` css, and the printed example has to stay readable.
import partCss from '../../../examples/css-seek-slider.css?raw';

const meta = {
  title: 'Player/SeekSlider',
  component: Player.SeekSlider,
  parameters: {
    docs: {
      description: {
        component: [
          '`Player.SeekSlider` scrubs the current time; a child `seek-buffered` element reflects buffered ranges.',
          '',
          '**Usage** — compose it under `Player.Root` (a `Player.Viewport` or `Player.Controls` gives it layout context):',
          '```tsx',
          '<Player.Root source={source}>',
          '  <Player.Viewport>',
          '    <Player.SeekSlider />',
          '  </Player.Viewport>',
          '</Player.Root>',
          '```',
          '',
          '**Contract** — renders `data-reely-part="seek-slider"` (with a child `data-reely-part="seek-buffered"`), `data-provider="<provider>"`, `data-state="idle" | "ready"` (`ready` once a duration is known), and `data-buffering="true" | "false"`.',
          '',
          '**Stalls** — `data-buffering` is a separate axis from `data-state`: it reports a stall, `data-state` reports whether a seek window exists. It is debounced (500ms before a stall is admitted, 500ms held once admitted) so a short rebuffer never twitches the slider; `state.buffering` remains the raw signal. The slider stays interactive during a stall — seeking away is how a user escapes one.',
          '',
          '**Accessibility** — a range control; arrow keys seek. With no seek window (`data-state="idle"`) it is `aria-disabled`, its `aria-valuetext` reads `Unavailable` rather than a clock time it does not have, and a change on it seeks nowhere. `aria-disabled` and not the native `disabled` attribute: the state ends the moment a duration or a seekable extent arrives, and `disabled` would move focus out from under a keyboard user each time.',
          '',
          '**Capability** — gated by `seek`; renders nothing until `seek` resolves `available`.',
          '',
          '**Styling** — plain CSS against the parts. The `Styled` story below mounts this file as its own `<style>`. Turning the Theme toolbar toggle on adds `theme.css` underneath, not over: everything here is unlayered, and unlayered CSS beats the `@layer reely` the whole theme lives in:',
          '```css',
          partCss.trim(),
          '```'
        ].join('\n')
      }
    }
  },
  render: () => (
    <Player.Viewport style={{ width: 480, height: 270, background: '#0b0e13' }}>
      <Player.SeekSlider style={{ width: '90%', margin: '2rem auto' }} />
    </Player.Viewport>
  )
} satisfies Meta<typeof Player.SeekSlider>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Midway: Story = {
  parameters: ready({ seek: available }, { currentTime: 30, duration: 100 }),
  play: async ({ canvas }) => {
    const slider = await canvas.findByRole('slider', { name: 'Seek' });
    await expect(slider).toHaveAttribute('max', '100');
    await expect(slider).toHaveAttribute('aria-valuetext', '0:30 of 1:40');
  }
};

export const WithBufferedRanges: Story = {
  parameters: ready(
    { seek: available },
    {
      currentTime: 30,
      duration: 100,
      buffered: [
        { start: 0, end: 45 },
        { start: 60, end: 80 }
      ]
    }
  ),
  play: async ({ canvasElement }) => {
    const ranges = canvasElement.querySelectorAll(
      '[data-reely-part="seek-buffered-range"]'
    );
    await expect(ranges).toHaveLength(2);
  }
};

/** Mid-playback stall: `data-buffering` flips once the debounce admits it. */
export const Stalled: Story = {
  parameters: ready(
    { seek: available },
    {
      playback: 'playing',
      currentTime: 30,
      duration: 100,
      buffered: [{ start: 0, end: 35 }],
      buffering: true
    }
  ),
  play: async ({ canvas, canvasElement }) => {
    await canvas.findByRole('slider', { name: 'Seek' });
    const root = canvasElement.querySelector(
      '[data-reely-part="seek-slider"]'
    ) as HTMLElement;
    // A stall must persist 500ms before it is admitted (#35). The timeout is
    // explicit so this does not silently depend on waitFor's default being
    // larger than the delay.
    await waitFor(
      () => expect(root).toHaveAttribute('data-buffering', 'true'),
      {
        timeout: 2_000
      }
    );
    // The seek window is a separate axis and must not move during a stall.
    await expect(root).toHaveAttribute('data-state', 'ready');
  }
};

/**
 * The same slider with the CSS from this page's **Styling** section applied.
 * Mounted as a `<style>` inside this story's own tree, so it is torn down with
 * the story and no other story on the page sees it.
 */
export const Styled: Story = {
  decorators: [withCss(partCss)],
  // Stalled mid-playback, so the story exercises the fixture's state-derived
  // rule and not only its base paint. A seek window still exists, so the
  // buffered ranges render and the example is shown doing its actual job.
  parameters: ready(
    { seek: available },
    {
      playback: 'playing',
      currentTime: 30,
      duration: 100,
      buffered: [
        { start: 0, end: 45 },
        { start: 60, end: 80 }
      ],
      buffering: true
    }
  ),
  play: async ({ canvas, canvasElement }) => {
    const input = await canvas.findByRole('slider', { name: 'Seek' });
    const root = canvasElement.querySelector(
      '[data-reely-part="seek-slider"]'
    ) as HTMLElement;
    const buffered = canvasElement.querySelector(
      '[data-reely-part="seek-buffered"]'
    ) as HTMLElement;

    // The buffered layer is a child part with no size of its own until CSS
    // gives it one, so a measurable height is the example having applied.
    await expect(globalThis.getComputedStyle(buffered).height).toBe('4px');
    // The example selects the input by part name rather than by tag, as this
    // page's own rule demands. Nothing else would fail if that part name were
    // wrong, so it is asserted here.
    await expect(input).toHaveAttribute('data-reely-part', 'seek-slider-input');
    await expect(globalThis.getComputedStyle(input).accentColor).toBe(
      'rgb(122, 167, 255)'
    );

    // The `[data-buffering='true']` rule. A stall must persist 500ms before it
    // is admitted (#35), hence the explicit timeout, as in `Stalled`.
    await waitFor(
      () => expect(root).toHaveAttribute('data-buffering', 'true'),
      { timeout: 2_000 }
    );
    await waitFor(() =>
      expect(globalThis.getComputedStyle(buffered).backgroundColor).toBe(
        'rgb(107, 74, 18)'
      )
    );
    // And the other axis is untouched by the stall, so the fixture's
    // `[data-state='idle']` rule must NOT be firing. That rule's positive case
    // needs a player with no seek window, which is a different story than this
    // one — a story is in one state at a time.
    await expect(root).toHaveAttribute('data-state', 'ready');
    await expect(globalThis.getComputedStyle(root).opacity).toBe('1');
  }
};

/** Focus behavior: the native slider is keyboard-reachable. */
export const KeyboardFocusable: Story = {
  parameters: ready({ seek: available }, { currentTime: 30, duration: 100 }),
  play: async ({ canvas, userEvent }) => {
    const slider = await canvas.findByRole('slider', { name: 'Seek' });
    await userEvent.tab();
    await expect(slider).toHaveFocus();
  }
};

/** Capability absent: an unresolved seek capability renders nothing. */
export const CapabilityAbsent: Story = {
  parameters: ready({ seek: notReady }, { currentTime: 30, duration: 100 }),
  play: async ({ canvas }) => {
    await expect(canvas.queryByRole('slider')).toBeNull();
  }
};
