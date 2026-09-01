import * as Player from '@playdeck/react';
import type { ProviderStatePatch, TextCue, TextTrack } from '@playdeck/core';
import type { Meta, StoryObj } from '@storybook/react-vite';
import type { CSSProperties } from 'react';
import { expect } from 'storybook/test';
import type { MockPlayerParameters } from '../.storybook/mock-player';
import { available, ready } from './support';

const track: TextTrack = {
  id: 'en',
  label: 'English',
  language: 'en',
  kind: 'subtitles',
  readiness: 'loaded'
};

const cue = (text: string): TextCue => ({
  id: '1',
  startTime: 0,
  endTime: 10,
  text
});

/** A ready, `captionRendering: 'custom'` player with the given active cues. */
const captionsReady = (
  cues: readonly TextCue[],
  patch: ProviderStatePatch = {}
): { player: MockPlayerParameters } => {
  const base = ready(
    {},
    {
      captionRendering: 'custom',
      textTracks: [track],
      selectedTextTrackId: track.id,
      ...patch
    }
  );
  return { player: { ...base.player, cues } };
};

const meta = {
  title: 'Player/Captions',
  component: Player.Captions,
  parameters: {
    docs: {
      description: {
        component: [
          '`Player.Captions` overlays the active cues (driven by `state.textTracks`/`selectedTextTrackId` and the provider\'s cue events) when `state.captionRendering === "custom"`; it renders nothing otherwise, leaving native or provider-drawn captions alone.',
          '',
          '**Contract** — `data-playdeck-part="captions"`, `data-state="custom"`; each cue is `data-playdeck-part="caption-cue"`, and its lines (the cue text split on `\\n`) are `data-playdeck-part="caption-line"`.',
          '',
          '**Theming** — CSS custom properties set on `Player.Captions` (or an ancestor) style the default cue box without overriding its structure: `--playdeck-caption-font-size` (default `1.05rem`), `--playdeck-caption-color` (default `#fff`), `--playdeck-caption-background` (default `rgba(0, 0, 0, 0.75)`), `--playdeck-caption-edge` (a `text-shadow` value, default `none`).',
          '',
          "**`renderCue`** — a render-prop child replaces the default per-cue rendering entirely. The cue handed to it is normalized to its public shape (`id`/`startTime`/`endTime`/`text`), stripping any engine-only fields a provider's cue objects carry.",
          '',
          '**Safe area** — the overlay reserves `env(safe-area-inset-bottom/left/right)` so cues clear device chrome such as home indicators.'
        ].join('\n')
      }
    }
  }
} satisfies Meta<typeof Player.Captions>;

export default meta;

type Story = StoryObj<typeof meta>;

const viewportStyle: CSSProperties = {
  width: 480,
  height: 270,
  background: '#0b0e13',
  position: 'relative'
};

/**
 * The default rendering, with one active cue. This is the shape everything
 * below varies: a `captions` overlay in `data-state="custom"` holding one
 * `caption-cue`, which holds one `caption-line`.
 */
export const OneLine: Story = {
  parameters: captionsReady([cue('Hello, this is a caption.')]),
  render: () => (
    <Player.Viewport style={viewportStyle}>
      <Player.Captions />
    </Player.Viewport>
  ),
  play: async ({ canvasElement, canvas }) => {
    await canvas.findByText('Hello, this is a caption.');
    const captions = canvasElement.querySelector(
      '[data-playdeck-part="captions"]'
    );
    await expect(captions).toHaveAttribute('data-state', 'custom');
    await expect(captions).toHaveTextContent('Hello, this is a caption.');
  }
};

/**
 * One cue carrying an author-intended line break. The `\n` becomes two
 * `caption-line` elements rather than a `<br>`, so the break is structural and
 * a stylesheet can address a line. Both still sit inside the one `caption-cue`
 * box that carries the background, so a two-line cue reads as one plate rather
 * than two stacked ones.
 */
export const MultiLine: Story = {
  parameters: captionsReady([cue('Line one\nLine two')]),
  render: () => (
    <Player.Viewport style={viewportStyle}>
      <Player.Captions />
    </Player.Viewport>
  ),
  play: async ({ canvasElement, canvas }) => {
    await canvas.findByText('Line one');
    const lines = canvasElement.querySelectorAll(
      '[data-playdeck-part="caption-line"]'
    );
    await expect(lines).toHaveLength(2);
    await expect(lines[0]).toHaveTextContent('Line one');
    await expect(lines[1]).toHaveTextContent('Line two');
  }
};

const longText =
  'This is a deliberately long caption line, long enough that it must wrap across several visual rows inside the fixed-width video viewport instead of overflowing it.';

/**
 * A cue with no author line break, long enough that the engine has to wrap it.
 * The failure this guards is the cue box growing past the viewport instead of
 * wrapping inside it, which is what happens to an overlay that forgets to bound
 * its width — so the play function checks both that the text occupies more than
 * one visual row and that the box still fits.
 */
export const LongText: Story = {
  parameters: captionsReady([cue(longText)]),
  render: () => (
    <Player.Viewport style={viewportStyle}>
      <Player.Captions />
    </Player.Viewport>
  ),
  play: async ({ canvasElement, canvas }) => {
    await canvas.findByText(longText);
    const cueBox = canvasElement.querySelector(
      '[data-playdeck-part="caption-cue"]'
    );
    await expect(cueBox).not.toBeNull();
    // Count the rows the text actually occupies rather than comparing the cue
    // box to a pixel threshold: a threshold tracks the font size and viewport
    // width, and stays green for any tall box however the wrapping broke. A
    // Range over the TEXT NODE reports one rect per visual row — measured, 3
    // here and 1 with `white-space: nowrap` forced onto the cue box. Ranging
    // over the cue box element instead does not discriminate: that reports
    // fragment rects, 4 wrapped against 2 unwrapped.
    const text = cueBox!.querySelector('[data-playdeck-part="caption-line"]')
      ?.firstChild as Text;
    const range = document.createRange();
    range.selectNodeContents(text);
    expect(range.getClientRects().length).toBeGreaterThan(1);
    // The other way wrapping breaks: overflowing the viewport instead of
    // wrapping inside it, which a row count alone cannot tell from a narrow
    // viewport.
    const viewportWidth = cueBox!
      .closest('[data-playdeck-part="viewport"]')!
      .getBoundingClientRect().width;
    expect(cueBox!.getBoundingClientRect().width).toBeLessThanOrEqual(
      viewportWidth
    );
  }
};

/**
 * The **Theming** custom properties in use — the accessibility preset a
 * consumer builds a "high contrast captions" setting out of. Set as inline
 * `style` on `Player.Captions` here, but they cascade, so an ancestor works
 * too. Nothing about the cue structure changes: this is four values, not a
 * variant.
 */
export const HighContrast: Story = {
  parameters: captionsReady([cue('High-contrast captions')]),
  render: () => (
    <Player.Viewport style={viewportStyle}>
      <Player.Captions
        style={
          {
            '--playdeck-caption-font-size': '1.6rem',
            '--playdeck-caption-color': '#ffff00',
            '--playdeck-caption-background': '#000000',
            '--playdeck-caption-edge': 'none'
          } as CSSProperties
        }
      />
    </Player.Viewport>
  ),
  play: async ({ canvas }) => {
    const line = await canvas.findByText('High-contrast captions');
    const cueBox = line.closest(
      '[data-playdeck-part="caption-cue"]'
    ) as HTMLElement;
    const style = getComputedStyle(cueBox);
    await expect(style.color).toBe('rgb(255, 255, 0)');
    await expect(style.backgroundColor).toBe('rgb(0, 0, 0)');
    expect(parseFloat(style.fontSize)).toBeGreaterThan(20);
  }
};

/**
 * The overlay's `env(safe-area-inset-*)` padding, which keeps cues clear of a
 * home indicator or a notch.
 *
 * The canvas cannot show it working. `env()` resolves to its fallback unless
 * the engine reports a real inset, and no desktop browser does, so the striped
 * bar below the viewport is a picture of the device chrome rather than a
 * stand-in for it. What is checked here is structural — that all three insets
 * are reserved. That a real inset moves the cue box is asserted in
 * `e2e/captions.spec.ts`, which sets one through Chromium's CDP.
 */
export const SafeArea: Story = {
  parameters: captionsReady([cue('Above the home indicator')]),
  render: () => (
    <div style={{ width: 480 }}>
      <Player.Viewport style={viewportStyle}>
        <Player.Captions />
      </Player.Viewport>
      {/* Illustrates the device chrome the inset stands for. It cannot stand
          in for the inset itself: env() resolves to its fallback unless the
          engine reports a real inset, so nothing rendered here changes what
          the component computes. */}
      <div
        style={{
          height: 34,
          background:
            'repeating-linear-gradient(45deg, #1a1a1a, #1a1a1a 6px, #2a2a2a 6px, #2a2a2a 12px)'
        }}
      />
    </div>
  ),
  play: async ({ canvas }) => {
    const line = await canvas.findByText('Above the home indicator');
    const captions = line.closest(
      '[data-playdeck-part="captions"]'
    ) as HTMLElement;
    // The previous assertion compared the cue box against the stand-in strip
    // below the viewport, which the layout guarantees regardless of any
    // padding — it would have passed with the safe-area handling deleted.
    // Here the check is structural: all three insets are reserved, with a
    // floor under the bottom one. That a real inset MOVES the cue box is
    // asserted behaviourally in e2e/captions.spec.ts, which sets one through
    // Chromium's CDP — it does not need hardware.
    expect(captions.style.paddingBottom).toContain(
      'env(safe-area-inset-bottom'
    );
    expect(captions.style.paddingLeft).toContain('env(safe-area-inset-left');
    expect(captions.style.paddingRight).toContain('env(safe-area-inset-right');
    expect(
      parseFloat(getComputedStyle(captions).paddingBottom)
    ).toBeGreaterThan(0);
  }
};

/**
 * Track selection rather than cue rendering: `Player.CaptionsButton` opening
 * `Player.CaptionsMenu`. The menu lists an `Off` entry alongside the tracks in
 * `state.textTracks` and marks the selected one `aria-checked`, so turning
 * captions off is a menu choice and not a separate control. Staged with two
 * tracks because a one-track menu cannot show the radio group doing its job.
 */
export const Menu: Story = {
  parameters: ready(
    { selectTextTrack: available },
    {
      textTracks: [
        track,
        {
          id: 'fr',
          label: 'French',
          language: 'fr',
          kind: 'subtitles',
          readiness: 'loaded'
        }
      ],
      selectedTextTrackId: track.id
    }
  ),
  render: () => (
    <Player.Viewport
      style={{
        width: 640,
        height: 360,
        background: '#0b0e13',
        position: 'relative'
      }}
    >
      <Player.CaptionsButton
        style={{
          position: 'absolute',
          bottom: '0.75rem',
          left: '0.75rem',
          color: '#e8edf4',
          background: 'transparent',
          border: 'none'
        }}
      />
      <Player.CaptionsMenu
        style={{ position: 'absolute', bottom: '0.75rem', right: '0.75rem' }}
      />
    </Player.Viewport>
  ),
  play: async ({ canvas, userEvent }) => {
    const trigger = await canvas.findByRole('button', { name: 'Captions' });
    await userEvent.click(trigger);
    const off = await canvas.findByRole('menuitemradio', { name: 'Off' });
    const english = canvas.getByRole('menuitemradio', { name: 'English' });
    const french = canvas.getByRole('menuitemradio', { name: 'French' });
    await expect(off).toBeInTheDocument();
    await expect(english).toHaveAttribute('aria-checked', 'true');
    await expect(french).toHaveAttribute('aria-checked', 'false');
  }
};
