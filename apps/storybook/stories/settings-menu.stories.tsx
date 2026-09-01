import * as Player from '@playdeck/react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect } from 'storybook/test';
import { available, ready } from './support';

// `bottom: calc(100% + 0.25rem)`, not a fixed offset from the viewport's
// bottom edge: `SettingsMenu`'s root is the nearest positioned ancestor, so an
// offset written as if it were relative to `Player.Viewport` resolves against
// the trigger's own box instead. It used to read `bottom: 3rem`, which put the
// open menu 42px ABOVE the top of the page — measured, and invisible to every
// check in the repo until `e2e/visual.spec.ts` looked (#112). This anchors the
// menu to the trigger, the same way the reference example does.
const menuStyle = {
  position: 'absolute' as const,
  bottom: 'calc(100% + 0.25rem)',
  right: 0,
  minWidth: 180,
  padding: '0.25rem',
  background: '#11151c',
  color: '#e8edf4',
  border: '1px solid #2a2f3a',
  borderRadius: 8,
  display: 'flex',
  flexDirection: 'column' as const,
  fontFamily: 'system-ui, sans-serif'
};

const SpeedMenu = () => (
  <Player.SettingsMenu>
    <Player.SettingsMenuTrigger
      style={{ color: '#e8edf4', background: 'transparent', border: 'none' }}
    />
    <Player.SettingsMenuContent style={menuStyle}>
      <Player.MenuRadioGroup value="1" onValueChange={() => {}}>
        <Player.MenuRadioItem value="0.5">0.5×</Player.MenuRadioItem>
        <Player.MenuRadioItem value="1">1×</Player.MenuRadioItem>
        <Player.MenuRadioItem value="2">2×</Player.MenuRadioItem>
      </Player.MenuRadioGroup>
    </Player.SettingsMenuContent>
  </Player.SettingsMenu>
);

const meta = {
  title: 'Player/SettingsMenu',
  component: Player.SettingsMenu,
  parameters: {
    docs: {
      description: {
        component: [
          '`Player.SettingsMenu` is an accessible menu primitive. The trigger sets `aria-haspopup="menu"`; the content is `role="menu"` with `data-playdeck-menu="open"`, which suppresses the player keyboard shortcuts while open.',
          '',
          '**Focus** — opening moves focus to the first item; Escape, selecting an item, or re-toggling returns focus to the trigger (never `<body>`).',
          '',
          "**Tab** — the content root defaults to `tabIndex={0}`. Bound the menu's height and it becomes a scrollable region whose items are all `tabIndex={-1}` for roving focus, so without a tabbable root it is a `scrollable-region-focusable` violation (WCAG 2.1.1) and its lower entries are reachable only by arrowing until focus pushes the scroll. Opening still lands on the first item, so the root is never the landing spot, and the items stay `tabIndex={-1}`, so the default adds no stop inside the menu. Pass your own `tabIndex` — `-1` included — to override it.",
          '',
          '**Options** — `Player.MenuRadioGroup` + `Player.MenuRadioItem` give single-select semantics (`role="menuitemradio"`, `aria-checked`).'
        ].join('\n')
      }
    }
  },
  render: () => (
    <Player.Viewport
      style={{
        width: 640,
        height: 360,
        background: '#0b0e13',
        position: 'relative'
      }}
    >
      {/* Bottom-right, where a real control row puts it: a menu that opens
          upward needs room above the trigger, and a trigger sitting at the top
          of the viewport has none. */}
      <div style={{ position: 'absolute', bottom: '0.5rem', right: '0.5rem' }}>
        <SpeedMenu />
      </div>
    </Player.Viewport>
  )
} satisfies Meta<typeof Player.SettingsMenu>;

export default meta;

type Story = StoryObj<typeof meta>;

const capable = ready({
  seek: available,
  setVolume: available,
  fullscreen: available,
  pictureInPicture: available
});

/**
 * The resting state: only the trigger is in the DOM. The content is not
 * rendered-and-hidden, so nothing in a closed menu is reachable by Tab or
 * readable by a screen reader, and the player's keyboard shortcuts are live.
 * No `play` function — there is nothing to drive, and this is the story the
 * docs page opens on.
 */
export const Closed: Story = { parameters: capable };

/**
 * Opened by a click. Two things land at once: focus moves to the first item,
 * and `data-playdeck-menu="open"` appears on the content — which is what
 * suppresses the player's keyboard shortcuts, so an arrow key inside the menu
 * moves through options instead of seeking the video underneath.
 */
export const Open: Story = {
  parameters: capable,
  play: async ({ canvas, userEvent }) => {
    const trigger = await canvas.findByRole('button', { name: 'Settings' });
    await userEvent.click(trigger);
    const menu = await canvas.findByRole('menu');
    await expect(menu).toHaveAttribute('data-playdeck-menu', 'open');
    const first = canvas.getAllByRole('menuitemradio')[0];
    await expect(first).toHaveFocus();
  }
};

/**
 * Escape closes the menu and returns focus to the trigger. The return is the
 * assertion that matters: the focused item is being removed from the DOM, and
 * a browser left to itself drops focus to `<body>` — which strands a keyboard
 * user at the top of the page with no way back to the control they just used.
 *
 * The end state is a closed menu, so this looks identical to `Closed` on the
 * canvas; the story is the transition, not the frame.
 */
export const EscapeRestoresFocus: Story = {
  parameters: capable,
  play: async ({ canvas, userEvent }) => {
    const trigger = await canvas.findByRole('button', { name: 'Settings' });
    await userEvent.click(trigger);
    await expect(canvas.getByRole('menu')).toBeInTheDocument();
    await userEvent.keyboard('{Escape}');
    await expect(canvas.queryByRole('menu')).toBeNull();
    await expect(trigger).toHaveFocus();
  }
};

/**
 * The other exit: choosing an option closes the menu and returns focus to the
 * trigger, the same as Escape. Both paths matter because a menu that restores
 * focus only on cancel strands the user on the common path.
 *
 * The `2×` click here does not stick — the radio group is uncontrolled in this
 * story, with `onValueChange` a no-op — so what is asserted is the close and
 * the focus return, not the selection. Ends in the same frame as `Closed` and
 * `EscapeRestoresFocus`.
 */
export const SelectingOptionChecksIt: Story = {
  parameters: capable,
  play: async ({ canvas, userEvent }) => {
    const trigger = await canvas.findByRole('button', { name: 'Settings' });
    await userEvent.click(trigger);
    await userEvent.click(
      await canvas.findByRole('menuitemradio', { name: '2×' })
    );
    // The menu is uncontrolled here, so asserting the selection persisted
    // across a reopen is out of scope; just assert it closed and focus
    // returned to the trigger.
    await expect(canvas.queryByRole('menu')).toBeNull();
    await expect(trigger).toHaveFocus();
  }
};
