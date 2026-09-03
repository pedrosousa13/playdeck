import * as Player from '@playdeck/react';
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
          '**Contract** — renders `data-playdeck-part="seek-slider"` (with a child `data-playdeck-part="seek-buffered"`), `data-provider="<provider>"`, `data-state="idle" | "ready"` (`ready` once a duration is known), and `data-buffering="true" | "false"`.',
          '',
          '**Stalls** — `data-buffering` is a separate axis from `data-state`: it reports a stall, `data-state` reports whether a seek window exists. It is debounced (500ms before a stall is admitted, 500ms held once admitted) so a short rebuffer never twitches the slider; `state.buffering` remains the raw signal. The slider stays interactive during a stall — seeking away is how a user escapes one.',
          '',
          '**Accessibility** — a range control; arrow keys seek. Inside a `Player.Controls` region the shortcut layer owns them, so `ArrowLeft`/`ArrowRight` seek 5s and `ArrowUp`/`ArrowDown` adjust the volume; on its own the input steps by its own `step` on all four. `Home` and `End` stay native either way. In `data-state="idle"` it announces itself `aria-disabled` with an `aria-valuetext` of `Unavailable`. The buffered geometry stays `aria-hidden`; its text equivalent is `seek-buffered-description`, a visually hidden share of the seek window (`45% loaded`) referenced by `aria-describedby`. It is not a live region, and it is absent rather than zero wherever nothing is measured.',
          '',
          '**Step** — the default is derived from the seek window: `min(1, span / 20)`, so twenty positions on a short clip and the same 1s it has always been on anything 20s or longer. A `step` through `inputProps` overrides it.',
          '',
          '**Capability** — gated by `seek`; renders nothing until `seek` resolves `available`.',
          '',
          '**Styling** — plain CSS against the parts. The `Styled` story below mounts this file as its own `<style>`. Turning the Theme toolbar toggle on adds `theme.css` underneath, not over: everything here is unlayered, and unlayered CSS beats the `@layer playdeck` the whole theme lives in:',
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

/**
 * The ordinary case: a known duration, so `data-state` is `ready` and the
 * window is scrubbable. The read-out worth noticing is `aria-valuetext` —
 * `0:30 of 1:40` rather than the raw `30` a range input would otherwise
 * announce, which is meaningless spoken aloud.
 */
export const Midway: Story = {
  parameters: ready({ seek: available }, { currentTime: 30, duration: 100 }),
  play: async ({ canvas }) => {
    const slider = await canvas.findByRole('slider', { name: 'Seek' });
    await expect(slider).toHaveAttribute('max', '100');
    await expect(slider).toHaveAttribute('aria-valuetext', '0:30 of 1:40');
  }
};

/**
 * Two disjoint buffered ranges — what a player looks like after a viewer has
 * seeked ahead and left a gap behind. The bars have no size until your CSS
 * gives them one (see `Styled`), so the canvas here shows the same track as
 * `Midway`.
 *
 * The accessibility half is the reason two ranges is the interesting fixture:
 * the geometry is `aria-hidden`, and the whole of it reaches assistive
 * technology as one `65% loaded` description — the total of both ranges over
 * the window, not one announcement per bar.
 */
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
  play: async ({ canvas, canvasElement }) => {
    const ranges = canvasElement.querySelectorAll(
      '[data-playdeck-part="seek-buffered-range"]'
    );
    await expect(ranges).toHaveLength(2);
    // The geometry is `aria-hidden`, so the two ranges above reach assistive
    // technology only through this one description: 65 of the window's 100
    // seconds, counted once rather than per range.
    const slider = await canvas.findByRole('slider', { name: 'Seek' });
    const description = canvasElement.querySelector(
      '[data-playdeck-part="seek-buffered-description"]'
    );
    await expect(description).not.toBeNull();
    await expect(description).toHaveTextContent('65% loaded');
    await expect(slider).toHaveAttribute('aria-describedby', description!.id);
  }
};

/**
 * The same fixture as `WithBufferedRanges`, under a deliberately different
 * inherited font. #541: the input sits on a text baseline and gains a
 * descender gap below it, so the offset between `seek-buffered`'s 50% and the
 * input's own centre is a function of the consumer's font — this is the
 * fixture `e2e/thumb-contrast.spec.ts` points its second measurement at, so
 * the fix is checked at more than one font size and not only Storybook's own
 * default.
 */
export const WithBufferedRangesLargeInheritedFont: Story = {
  render: () => (
    <Player.Viewport
      style={{
        width: 480,
        height: 270,
        background: '#0b0e13',
        fontFamily: 'Georgia, serif',
        fontSize: '32px'
      }}
    >
      <Player.SeekSlider style={{ width: '90%', margin: '2rem auto' }} />
    </Player.Viewport>
  ),
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
  )
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
      '[data-playdeck-part="seek-slider"]'
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

/** No seek window: the `seek` capability is available, but there is nothing to scrub. */
export const Idle: Story = {
  parameters: ready(
    { seek: available },
    { currentTime: 0, duration: null, seekable: [] }
  ),
  play: async ({ canvas }) => {
    const slider = await canvas.findByRole('slider', { name: 'Seek' });
    await expect(slider).toHaveAttribute('aria-disabled', 'true');
    await expect(slider).toHaveAttribute('aria-valuetext', 'Unavailable');
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
      '[data-playdeck-part="seek-slider"]'
    ) as HTMLElement;
    const buffered = canvasElement.querySelector(
      '[data-playdeck-part="seek-buffered"]'
    ) as HTMLElement;

    // The buffered layer is a child part with no size of its own until CSS
    // gives it one, so a measurable height is the example having applied.
    await expect(globalThis.getComputedStyle(buffered).height).toBe('4px');
    // The example selects the input by part name rather than by tag, as this
    // page's own rule demands. Nothing else would fail if that part name were
    // wrong, so it is asserted here.
    await expect(input).toHaveAttribute(
      'data-playdeck-part',
      'seek-slider-input'
    );
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

/**
 * A seek window short enough that a 1s step could only express its two ends —
 * the ~1s reference clip is one — showing a position between them.
 *
 * This runs in a real engine, and that is the whole reason it is a story rather
 * than a node test. A range input keeps only the values its `step` grid can
 * express: hand it `0.6` on a `[0, 1]` window stepping by 1 and it keeps `1`.
 * The node suite runs on happy-dom, which implements no value sanitisation at
 * all (measured: `step = '1'` then `value = '0.75'` reads back `'0.75'`), so it
 * cannot see that happen and a test written there to watch it would pass
 * against any implementation whatsoever.
 *
 * Past the step it renders, the assertions are the input's view and the
 * library's view of the same value, and the point is that they agree. They
 * used to not: the library
 * rendered `0.6`, the engine kept `1`, and React's value tracker went on
 * holding `'0.6'` — so React would drop the next change event that landed on
 * `0.6`, and the press behind it issued no seek at all while every other signal
 * said it had been seen (#277).
 *
 * The value they agree on is now `0.6` rather than `1`. The step is derived
 * from the window — `min(1, span / 20)`, so 0.05 here — and a window this short
 * has twenty positions instead of two (#383). Before that, the thumb sat hard
 * right and the valuetext read `0:01 of 0:01` for the whole second half of the
 * clip; the read-out still describes the thumb rather than the media, and the
 * thumb is now where the media is.
 */
export const ShortWindowDerivesItsStep: Story = {
  parameters: ready({ seek: available }, { currentTime: 0.6, duration: 1 }),
  play: async ({ canvas }) => {
    const slider = await canvas.findByRole('slider', { name: 'Seek' });
    await expect(slider).toHaveAttribute('step', '0.05');
    await expect((slider as HTMLInputElement).value).toBe('0.6');
    await expect(slider).toHaveAttribute('aria-valuetext', '0:00 of 0:01');
  }
};

// A `Home` or `End` press from mid-clip is the other half of #383 — whether the
// press becomes an event at all — and it cannot be staged here. Storybook's
// `userEvent` simulates events in the document rather than driving the engine's
// own input, so a range input's native `End` handling is not exercised: it
// refuses the press outright ("Not implemented. The result of this interaction
// is unreliable."). Those tests live in Playwright, over this same window, in
// `e2e/reference.spec.ts`.
