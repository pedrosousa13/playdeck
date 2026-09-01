import type { CSSProperties, ReactElement } from 'react';
import * as Player from '@playdeck/react';
import { createPortal } from 'react-dom';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect } from 'storybook/test';
import { available, ready } from './support';

const viewportStyle = {
  position: 'relative' as const,
  aspectRatio: '16 / 9',
  // Wide enough for the full control row at the largest size these stories
  // demonstrate (`--playdeck-control-size: 3.5rem` in AccentAndSizeTokens). The
  // buttons are `flex: 0 0 auto` so they push out of the box rather than
  // shrink, and at 480 the row overflowed by 49px once AirPlayButton made it
  // six buttons.
  width: 640
};

// Icon children, supplied here as a consumer supplies them -- the theme sizes
// every button-shaped control to `--playdeck-control-size` and its `svg` to
// `--playdeck-control-icon-size`, so the default text labels ("Enter
// fullscreen", "Enter picture-in-picture", ...) do not fit a 44px box.
//
// The icons are the static enter-state ones. These stories are static: none of
// them plays, mutes, or enters picture-in-picture or fullscreen, so a
// state-driven icon swap would be dead in every one of them. That swap is
// demonstrated where it belongs, in reference/reference-player.tsx.
const ThemedPlayer = () => (
  <Player.Viewport style={viewportStyle}>
    <Player.Controls
      style={{ position: 'absolute', inset: 'auto 0 0 0' }}
      aria-label="Video player controls"
    >
      <Player.PlayButton>
        <Player.PlayIcon />
      </Player.PlayButton>
      <Player.Time />
      <Player.SeekSlider />
      <Player.MuteButton>
        <Player.VolumeHighIcon />
      </Player.MuteButton>
      <Player.VolumeSlider />
      <Player.CaptionsButton>
        <Player.CaptionsIcon />
      </Player.CaptionsButton>
      <Player.PipButton>
        <Player.PipEnterIcon />
      </Player.PipButton>
      <Player.AirPlayButton>
        <Player.AirPlayIcon />
      </Player.AirPlayButton>
      <Player.FullscreenButton>
        <Player.FullscreenEnterIcon />
      </Player.FullscreenButton>
    </Player.Controls>
  </Player.Viewport>
);

// The row fits inside its own box, on both axes.
//
// Oversized children never widen a control: every button is `flex: 0 0 auto`
// with a fixed `inline-size` (packages/react/theme.css) floored by an inline
// `min-width`/`min-height` of 44 (packages/react/src/index.tsx), so the
// measured box never grows to fit its content. A default text label wraps
// inside that fixed box and spills out of it instead -- downwards on whichever
// control carries it, and past the inline end when that control is the
// trailing one. So the vertical axis is the one that has to be asserted: it is
// the only one that catches a wrapped interior control, whose spill overlaps
// its neighbours without ever reaching the row's inline end. With the default
// text labels at 44px controls, this row measures scrollWidth 645 against
// clientWidth 640, and scrollHeight 70 against clientHeight 64.
const expectControlsFit = async (controls: HTMLElement) => {
  await expect(controls.scrollWidth).toBeLessThanOrEqual(controls.clientWidth);
  await expect(controls.scrollHeight).toBeLessThanOrEqual(
    controls.clientHeight
  );
};

const fullyCapable = ready({
  seek: available,
  setVolume: available,
  selectTextTrack: available,
  pictureInPicture: available,
  airPlay: available,
  fullscreen: available
});

const meta = {
  title: 'Theme/Theme',
  component: ThemedPlayer,
  // These stories are about the stylesheet, so they pin the toolbar's Theme
  // toggle on for themselves. The mounting is the shared decorator's, in
  // .storybook/preview.tsx -- there is one mechanism, and this is it turned on.
  globals: { theme: 'themed' },
  parameters: {
    ...fullyCapable,
    docs: {
      description: {
        component: [
          'The optional `@playdeck/react/theme.css`. Everything lives in an',
          '`@layer playdeck` cascade layer with `:where()` selectors, so unlayered',
          'consumer CSS wins without `!important` and a single class of your own',
          'outranks any theme rule. Tokens are set on the viewport part, so',
          'dropping a player into a page leaks no names into the document.'
        ].join(' ')
      }
    }
  }
} satisfies Meta<typeof ThemedPlayer>;

export default meta;

type Story = StoryObj<typeof meta>;

/**
 * The bundled stylesheet as it ships, over a full control row. This is what
 * `@playdeck/react/theme.css` buys you with no tokens set and no overrides:
 * sized, spaced, pointer-cursored controls that the headless primitives do not
 * paint themselves.
 *
 * The icon children are the story's, not the theme's. A themed control is a
 * fixed 44px box, and the primitives' default text labels ("Enter fullscreen")
 * do not fit one — so a consumer adopting this stylesheet supplies icons, and
 * the play function checks the row fits to keep that honest.
 */
export const Default: Story = {
  play: async ({ canvas }) => {
    const play = await canvas.findByRole('button', { name: 'Play' });
    const styles = globalThis.getComputedStyle(play);
    // The theme reached the control: a 44px box is the locked minimum target,
    // and the theme's control size has to agree with it rather than shrink it.
    await expect(styles.width).toBe('44px');
    await expect(styles.height).toBe('44px');
    await expect(styles.cursor).toBe('pointer');

    // Icon children fit the box; the primitives' default text labels do not.
    const controls = await canvas.findByRole('group', {
      name: 'Video player controls'
    });
    await expectControlsFit(controls);
  }
};

// The consumer rule is rigged to lose on every cascade axis except the layer,
// so that the layer is the only thing left that can explain the win. It is
// `:where(.consumer-tint)`, 0-0-0, exactly tying the theme's
// `:where([data-playdeck-part='controls'])` on specificity -- a bare
// `.consumer-tint` would be 0-1-0 and win outright, layer or no layer. And it
// is declared earlier, so on source order alone the theme would take the tie.
// What remains is the cascade layer: unlayered declarations beat layered ones
// before specificity is ever consulted. Delete `@layer playdeck` from theme.css
// and this story goes red.
//
// Earlier means portalled into `document.head`, not mounted with `withCss`:
// that puts the `<style>` inside the story tree (.storybook/theme.tsx), which
// is the one thing this story has to escape. The theme is mounted by the
// project decorator in .storybook/preview.tsx, which wraps this story-level
// one, so its `<style>` lands ahead of anything rendered here in `<body>`
// (measured: theme at document index 2, a sibling `<style>` at 4). Everything
// in `<head>` precedes everything in `<body>`, and the portal still unmounts
// with the story. What it does not do is scope to this subtree the way
// `withCss` does -- it is document-global while mounted, which is visible only
// on the autodocs page discussed below, where the whole file co-mounts. Nothing
// else here carries `.consumer-tint`, so it stays harmless. The play function
// asserts the ordering rather than assuming it -- it is what silently inverted
// and left this story proving nothing.

/**
 * The override contract, which is the whole reason for the layer and
 * `:where()`: one unlayered rule of your own beats the theme without
 * `!important`. The canvas shows a control row painted `rgb(1, 2, 3)` by a
 * consumer class while the theme is fully mounted. If this ever fails,
 * consumers are back to specificity fights.
 *
 * This story owns the layer half of that. The `:where()` half is asserted over
 * the stylesheet text in `packages/react/test/theme.test.ts`, not here.
 */
export const ConsumerCssWins: Story = {
  decorators: [
    (Story: () => ReactElement) => (
      <>
        {createPortal(
          <style>{`:where(.consumer-tint) { background-color: rgb(1, 2, 3); }`}</style>,
          document.head
        )}
        <Story />
      </>
    )
  ],
  render: () => (
    <Player.Viewport style={viewportStyle}>
      <Player.Controls
        className="consumer-tint"
        style={{ position: 'absolute', inset: 'auto 0 0 0' }}
        aria-label="Video player controls"
      >
        <Player.PlayButton>
          <Player.PlayIcon />
        </Player.PlayButton>
      </Player.Controls>
    </Player.Viewport>
  ),
  play: async ({ canvas }) => {
    // The premise, checked rather than trusted: a layered theme is in the
    // document, and the consumer rule really is the earlier declaration, so
    // source order is working against it.
    const styles = [...document.querySelectorAll('style')];
    // Matched on the at-rule itself, brace included: theme.css's header comment
    // says "@layer playdeck" in prose too, and a bare substring match resolves to
    // the stylesheet even after the real wrapper is deleted -- which would let
    // the de-layered case pass this probe and then throw somewhere else. The
    // brace is optionally spaced because the production Storybook build
    // minifies `?inline` CSS to `@layer playdeck{`.
    const themeStyle = styles.find((style) =>
      /@layer\s+playdeck\s*\{/.test(style.textContent ?? '')
    )!;
    const consumerStyle = styles.find((style) =>
      style.textContent?.includes('.consumer-tint')
    )!;
    // Both found, asserted by name: with `@layer playdeck` deleted the theme probe
    // matches nothing, and this reports that as the missing layer rather than
    // crashing on an undefined argument to compareDocumentPosition below.
    await expect({
      layeredTheme: Boolean(themeStyle),
      consumerRule: Boolean(consumerStyle)
    }).toEqual({ layeredTheme: true, consumerRule: true });
    await expect(
      consumerStyle.compareDocumentPosition(themeStyle) &
        Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeGreaterThan(0);

    const controls = await canvas.findByRole('group', {
      name: 'Video player controls'
    });
    // One unlayered class beats the theme's own rule for the same property.
    await expect(globalThis.getComputedStyle(controls).backgroundColor).toBe(
      'rgb(1, 2, 3)'
    );
  }
};

/**
 * Retheming by custom property alone: a larger control size and a different
 * accent, set on an ancestor of the player. No stylesheet edit, no build step,
 * and no `!important` — the tokens are read where the theme reads them, so a
 * variant is a few declarations on a wrapper.
 *
 * The `3.5rem` set here is the size `viewportStyle`'s width is chosen against;
 * that choice is explained where the width is written.
 */
export const AccentAndSizeTokens: Story = {
  render: () => (
    <div
      style={
        {
          '--playdeck-control-size': '3.5rem',
          '--playdeck-color-accent': 'rgb(255, 0, 128)'
        } as CSSProperties
      }
    >
      <ThemedPlayer />
    </div>
  ),
  play: async ({ canvas }) => {
    const play = await canvas.findByRole('button', { name: 'Play' });
    // Tokens cascade in from an ancestor, no stylesheet edit required.
    await expect(globalThis.getComputedStyle(play).width).toBe('56px');

    // And the row still fits at the largest size these stories demonstrate.
    // A guard on the row, not on the icon children: at 3.5rem the labels have
    // enough box to wrap into (640/640 and 72/72 either way), so it is Default
    // that proves the icons are load-bearing. This one catches the row itself
    // outgrowing the viewport, the way it did at width 480.
    const controls = await canvas.findByRole('group', {
      name: 'Video player controls'
    });
    await expectControlsFit(controls);
  }
};

/**
 * The limit of the token above. The 44px minimum touch target is locked, and
 * the primitives enforce it with an inline `min-width`/`min-height` that no
 * stylesheet can undercut. A theme asking for 2.25rem controls is therefore
 * clamped to 44px rather than obeyed — the accessibility floor is not themeable
 * away, on purpose.
 *
 * The other two tokens set here do apply — the play function checks the
 * squared-off `border-radius` arrives — which is the half that makes the story
 * readable: tokens are not being ignored, one guarantee is being defended.
 */
export const ControlSizeFloorHolds: Story = {
  render: () => (
    <div
      style={
        {
          '--playdeck-control-size': '2.25rem',
          '--playdeck-color-surface': 'rgb(20, 20, 30)',
          '--playdeck-radius': '0px'
        } as CSSProperties
      }
    >
      <ThemedPlayer />
    </div>
  ),
  play: async ({ canvas }) => {
    const play = await canvas.findByRole('button', { name: 'Play' });
    const styles = globalThis.getComputedStyle(play);
    // Clamped up to the locked minimum, not shrunk to 36px.
    await expect(styles.width).toBe('44px');
    await expect(styles.height).toBe('44px');
    // Tokens that do not fight a locked guarantee still apply.
    await expect(styles.borderRadius).toBe('0px');
  }
};

// Themed through the meta-level `globals`, and with no example stylesheet in
// the tree: `Player/ActivationButton`'s own `Styled` story mounts
// `examples/css-activation.css` unlayered, which beats `@layer playdeck` and would
// measure that file instead of the theme.

/**
 * The activation overlay is the one part whose box the theme replaces rather
 * than decorates: the primitive pins `position: absolute; inset: 0` inline so
 * an unstyled overlay is a full-bleed click target, and the theme sizes it down
 * to a 4rem circle. A fixed size against four zero offsets is over-constrained,
 * and the circle landed in the corner (#160) until the primitive started
 * stating `margin: auto` alongside the offsets it over-constrains. The theme
 * itself says nothing about position — this story is the bundled-theme case of
 * that inline default, and `Player/ActivationButton`'s `SizedByConsumerCss` is
 * the general one. `place-items: center` does not do it — that centres the icon
 * inside the circle, not the circle inside the viewport.
 */
export const ActivationIsCentred: Story = {
  parameters: {
    player: { state: { activation: 'dormant', lifecycle: 'idle' } }
  },
  render: () => (
    // Not the shared `viewportStyle`: its 640 is sized to fit the control row,
    // which this story does not render, and 480x270 is where #160 was measured.
    <Player.Viewport style={{ width: 480, height: 270 }}>
      <Player.ActivationButton>
        <Player.PlayIcon />
      </Player.ActivationButton>
    </Player.Viewport>
  ),
  play: async ({ canvas }) => {
    const button = await canvas.findByRole('button', { name: 'Play video' });
    const styles = globalThis.getComputedStyle(button);
    // First that the theme reached the part at all -- an unthemed overlay fills
    // the viewport, and a full-bleed box is trivially concentric with it, so
    // the centring assertion below is only meaningful once the box is 4rem.
    await expect(styles.width).toBe('64px');
    await expect(styles.height).toBe('64px');
    await expect(styles.borderRadius).toBe('50%');

    const viewport = button.closest('[data-playdeck-part="viewport"]')!;
    const centre = (element: Element) => {
      const box = element.getBoundingClientRect();
      return { x: box.left + box.width / 2, y: box.top + box.height / 2 };
    };
    const buttonCentre = centre(button);
    const viewportCentre = centre(viewport);
    await expect(
      Math.abs(buttonCentre.x - viewportCentre.x)
    ).toBeLessThanOrEqual(1);
    await expect(
      Math.abs(buttonCentre.y - viewportCentre.y)
    ).toBeLessThanOrEqual(1);
  }
};

// Its strength is entirely that ordering: run alone (`-t`, or opened directly
// in the UI), or with these exports reordered, it passes without proving
// anything. It is the only test that exercises real DOM teardown, so it stays;
// the unconditional cover for the decorator's two branches is
// `stories/theme.contract.test.ts`, which asserts them structurally.

/**
 * The theme leaves with the story that mounted it. Every story above is themed
 * through the meta-level `globals`; this one opts back out, and runs last, so
 * it renders in a document five themed stories have already used. An unthemed
 * control here is the proof that the toolbar decorator's `<style>` was torn
 * down with each of them rather than left behind in the shared preview
 * document — which is the reason the theme is mounted per story at all.
 *
 * **On this docs page it renders themed**, so do not read the canvas as the
 * headless look. Autodocs co-mounts every story in a file into one document,
 * and the themed ones bring the stylesheet with them. That is a property of
 * autodocs, not a leak — open the story on its own to see it unthemed.
 */
export const TearsDownWithTheStory: Story = {
  globals: { theme: 'headless' },
  play: async ({ canvas }) => {
    const play = await canvas.findByRole('button', { name: 'Play' });
    // `cursor: pointer` is the theme's, and Default above asserts it arrives.
    await expect(globalThis.getComputedStyle(play).cursor).toBe('default');
    const viewport = play.closest('[data-playdeck-part="viewport"]')!;
    // The theme paints the viewport `--playdeck-color-backdrop` (#000).
    await expect(globalThis.getComputedStyle(viewport).backgroundColor).toBe(
      'rgba(0, 0, 0, 0)'
    );
  }
};
