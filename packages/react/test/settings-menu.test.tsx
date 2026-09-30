// @vitest-environment happy-dom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor
} from '@testing-library/react';
import { createRef, useState } from 'react';
import { afterEach, describe, expect, test, vi } from 'vitest';
import * as Player from '../src/index';

afterEach(cleanup);

const Menu = () => (
  <Player.SettingsMenu>
    <Player.SettingsMenuTrigger />
    <Player.SettingsMenuContent>
      <Player.MenuItem>Quality</Player.MenuItem>
      <Player.MenuItem>Speed</Player.MenuItem>
    </Player.SettingsMenuContent>
  </Player.SettingsMenu>
);

// Drives the item list the way QualityMenu/AudioTrackMenu do: a real
// re-render with a shorter (or longer) list of `MenuItem`s, keyed by label
// so React's own reconciliation -- not a hand-removed DOM node -- is what
// unmounts the removed item.
const ShrinkableMenu = ({ items }: { items: readonly string[] }) => (
  <Player.SettingsMenu>
    <Player.SettingsMenuTrigger />
    <Player.SettingsMenuContent>
      {items.map((item) => (
        <Player.MenuItem key={item}>{item}</Player.MenuItem>
      ))}
    </Player.SettingsMenuContent>
  </Player.SettingsMenu>
);

// A parent whose own state update both removes the focused item's `MenuItem`
// and, via `onSelect`, drives the same click's `close()` -- so the item
// removal and the menu closing land in the same commit.
const ClosingShrinkMenu = () => {
  const [items, setItems] = useState(['A', 'B']);
  return (
    <Player.SettingsMenu>
      <Player.SettingsMenuTrigger />
      <Player.SettingsMenuContent>
        {items.map((item) => (
          <Player.MenuItem key={item} onSelect={() => setItems(['A'])}>
            {item}
          </Player.MenuItem>
        ))}
      </Player.SettingsMenuContent>
    </Player.SettingsMenu>
  );
};

const attr = (el: Element | null, n: string) => el?.getAttribute(n) ?? null;
const hasFocus = (el: Element | null) => document.activeElement === el;

describe('SettingsMenu', () => {
  test('trigger is a labelled button that is closed by default', () => {
    render(<Menu />);
    const trigger = screen.getByRole('button', { name: 'Settings' });
    expect(attr(trigger, 'aria-haspopup')).toBe('menu');
    expect(attr(trigger, 'aria-expanded')).toBe('false');
    expect(screen.queryByRole('menu')).toBeNull();
  });

  test('clicking the trigger opens the menu and moves focus to the first item', async () => {
    render(<Menu />);
    fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
    const menu = screen.getByRole('menu');
    expect(attr(menu, 'data-playdeck-menu')).toBe('open');
    expect(attr(menu, 'data-playdeck-part')).toBe('settings-menu');
    await waitFor(() =>
      expect(hasFocus(screen.getAllByRole('menuitem')[0])).toBe(true)
    );
  });

  test('arrow keys move roving focus and wrap', async () => {
    render(<Menu />);
    fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
    const items = screen.getAllByRole('menuitem');
    await waitFor(() => expect(hasFocus(items[0])).toBe(true));
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'ArrowDown' });
    expect(hasFocus(items[1])).toBe(true);
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'ArrowDown' });
    expect(hasFocus(items[0])).toBe(true); // wraps
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'End' });
    expect(hasFocus(items[1])).toBe(true);
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Home' });
    expect(hasFocus(items[0])).toBe(true);
  });

  test('roving focus skips items hidden with CSS', async () => {
    // Found building the #114 reference example, which renders PiP and AirPlay
    // both as buttons and as menu entries and lets a container query hide
    // whichever does not apply at the current player width. The hidden entry
    // stayed in `querySelectorAll`, so wrapping from the first item landed on
    // an unfocusable element and ArrowUp and End became dead keys — measured in
    // a real browser as focus never leaving the first item.
    render(
      <Player.SettingsMenu>
        <Player.SettingsMenuTrigger />
        <Player.SettingsMenuContent>
          <Player.MenuItem>Quality</Player.MenuItem>
          <Player.MenuItem>Speed</Player.MenuItem>
          <Player.MenuItem style={{ display: 'none' }}>AirPlay</Player.MenuItem>
        </Player.SettingsMenuContent>
      </Player.SettingsMenu>
    );
    fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
    const items = screen.getAllByRole('menuitem');
    await waitFor(() => expect(hasFocus(items[0])).toBe(true));

    // Wrap backwards past the hidden last item onto the last visible one.
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'ArrowUp' });
    expect(hasFocus(items[1])).toBe(true);

    // Forwards from there wraps to the first, not onto the hidden item.
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'ArrowDown' });
    expect(hasFocus(items[0])).toBe(true);

    // End means the last item a user can actually reach.
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'End' });
    expect(hasFocus(items[1])).toBe(true);
  });

  test('Escape closes the menu and returns focus to the trigger', async () => {
    render(<Menu />);
    const trigger = screen.getByRole('button', { name: 'Settings' });
    fireEvent.click(trigger);
    await waitFor(() => expect(screen.getByRole('menu')).toBeTruthy());
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' });
    expect(screen.queryByRole('menu')).toBeNull();
    expect(hasFocus(trigger)).toBe(true);
    expect(attr(trigger, 'aria-expanded')).toBe('false');
  });

  test('Tab closes the menu without pulling focus back to the trigger', async () => {
    // Unlike Escape, Tab must not call close(): the browser's own focus move
    // has to continue past the trigger to the next control, which it cannot
    // do if the handler puts focus back on the trigger first.
    render(<Menu />);
    const trigger = screen.getByRole('button', { name: 'Settings' });
    fireEvent.click(trigger);
    await waitFor(() => expect(screen.getByRole('menu')).toBeTruthy());
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Tab' });
    expect(screen.queryByRole('menu')).toBeNull();
    expect(hasFocus(trigger)).toBe(false);
  });

  test('selecting an item fires onSelect, closes, and restores focus to trigger', async () => {
    let picked = '';
    render(
      <Player.SettingsMenu>
        <Player.SettingsMenuTrigger />
        <Player.SettingsMenuContent>
          <Player.MenuItem onSelect={() => (picked = 'quality')}>
            Quality
          </Player.MenuItem>
        </Player.SettingsMenuContent>
      </Player.SettingsMenu>
    );
    const trigger = screen.getByRole('button', { name: 'Settings' });
    fireEvent.click(trigger);
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Quality' }));
    expect(picked).toBe('quality');
    expect(screen.queryByRole('menu')).toBeNull();
    expect(hasFocus(trigger)).toBe(true);
  });

  test('outside pointerdown closes the menu without stealing focus', async () => {
    render(
      <div>
        <button type="button">outside</button>
        <Menu />
      </div>
    );
    const trigger = screen.getByRole('button', { name: 'Settings' });
    fireEvent.click(trigger);
    await waitFor(() => expect(screen.getByRole('menu')).toBeTruthy());
    fireEvent.pointerDown(screen.getByRole('button', { name: 'outside' }));
    expect(screen.queryByRole('menu')).toBeNull();
    expect(hasFocus(trigger)).toBe(false);
  });

  test('the content root is keyboard-focusable by default', () => {
    // The fixture deliberately doesn't scroll. The default is unconditional,
    // so no test here has to stage an overflowing menu to observe it.
    render(<Menu />);
    fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
    expect(screen.getByRole('menu').tabIndex).toBe(0);
  });

  test('a consumer-supplied tabIndex wins over the default, including -1', () => {
    render(
      <Player.SettingsMenu>
        <Player.SettingsMenuTrigger />
        <Player.SettingsMenuContent tabIndex={-1}>
          <Player.MenuItem>Quality</Player.MenuItem>
        </Player.SettingsMenuContent>
      </Player.SettingsMenu>
    );
    fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
    expect(screen.getByRole('menu').tabIndex).toBe(-1);
  });

  test('the default adds no tab stop inside the menu', () => {
    // The content root becoming tabbable must not make the items tabbable
    // too: roving focus owns movement inside the menu, and a second stop per
    // item would change the composition's Tab order.
    render(<Menu />);
    fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
    expect(
      screen.getAllByRole('menuitem').map((item) => item.tabIndex)
    ).toEqual([-1, -1]);
  });

  test('ArrowUp from the focused root goes to the last item', async () => {
    // The root is tabbable, so it is a click target too: a user landing on
    // the menu's padding focuses it and no item is current. Index math that
    // reads that as index -1 wraps ArrowUp onto the second-to-last item.
    render(<Menu />);
    fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
    const items = screen.getAllByRole('menuitem');
    await waitFor(() => expect(hasFocus(items[0])).toBe(true));

    const menu = screen.getByRole('menu');
    menu.focus();
    expect(hasFocus(menu)).toBe(true);
    fireEvent.keyDown(menu, { key: 'ArrowUp' });
    expect(hasFocus(items[items.length - 1])).toBe(true);
  });

  test('ArrowDown from the focused root goes to the first item', async () => {
    render(<Menu />);
    fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
    const items = screen.getAllByRole('menuitem');
    await waitFor(() => expect(hasFocus(items[0])).toBe(true));

    const menu = screen.getByRole('menu');
    menu.focus();
    fireEvent.keyDown(menu, { key: 'ArrowDown' });
    expect(hasFocus(items[0])).toBe(true);
  });

  test('ArrowUp on the closed trigger opens the menu with focus on the last item', async () => {
    // WAI-ARIA menu button pattern: ArrowUp opens with the last item
    // focused, the mirror of ArrowDown's first-item default below.
    render(<Menu />);
    const trigger = screen.getByRole('button', { name: 'Settings' });
    fireEvent.keyDown(trigger, { key: 'ArrowUp' });
    const items = await screen.findAllByRole('menuitem');
    await waitFor(() => {
      expect(document.activeElement).toBe(items[items.length - 1]);
    });
    expect(document.activeElement).not.toBe(document.body);
    expect(attr(screen.getByRole('menu'), 'data-playdeck-menu')).toBe('open');
  });

  test('ArrowDown on the closed trigger opens the menu with focus on the first item', async () => {
    render(<Menu />);
    const trigger = screen.getByRole('button', { name: 'Settings' });
    fireEvent.keyDown(trigger, { key: 'ArrowDown' });
    const items = await screen.findAllByRole('menuitem');
    await waitFor(() => {
      expect(document.activeElement).toBe(items[0]);
    });
    expect(document.activeElement).not.toBe(document.body);
  });

  test('opening with ArrowUp then reopening with ArrowDown does not leak the last-item target', async () => {
    // The "which key opened it" signal must be set fresh on every open, not
    // just read once -- otherwise an ArrowUp open followed by Escape and an
    // ArrowDown open would still focus the last item on the second open.
    render(<Menu />);
    const trigger = screen.getByRole('button', { name: 'Settings' });
    fireEvent.keyDown(trigger, { key: 'ArrowUp' });
    let items = await screen.findAllByRole('menuitem');
    await waitFor(() => {
      expect(document.activeElement).toBe(items[items.length - 1]);
    });

    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' });
    expect(screen.queryByRole('menu')).toBeNull();
    expect(hasFocus(trigger)).toBe(true);

    fireEvent.keyDown(trigger, { key: 'ArrowDown' });
    items = await screen.findAllByRole('menuitem');
    await waitFor(() => {
      expect(document.activeElement).toBe(items[0]);
    });
  });

  test('removing the focused middle item moves focus to the item now at its index', async () => {
    const { rerender } = render(<ShrinkableMenu items={['A', 'B', 'C']} />);
    fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
    let items = screen.getAllByRole('menuitem');
    await waitFor(() => expect(hasFocus(items[0])).toBe(true));
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'ArrowDown' });
    expect(hasFocus(items[1])).toBe(true); // focus on B, index 1

    rerender(<ShrinkableMenu items={['A', 'C']} />); // remove B

    await waitFor(() => {
      items = screen.getAllByRole('menuitem');
      expect(document.activeElement).toBe(items[1]); // C, now at index 1
    });
    expect(document.activeElement?.textContent).toBe('C');
    expect(document.activeElement).not.toBe(document.body);

    // The menu still responds to the keyboard after the repair (Home/End/Escape).
    const menu = screen.getByRole('menu');
    fireEvent.keyDown(menu, { key: 'Home' });
    expect(hasFocus(items[0])).toBe(true);
    fireEvent.keyDown(menu, { key: 'End' });
    expect(hasFocus(items[1])).toBe(true);
    fireEvent.keyDown(menu, { key: 'Escape' });
    expect(screen.queryByRole('menu')).toBeNull();
    expect(hasFocus(screen.getByRole('button', { name: 'Settings' }))).toBe(
      true
    );
  });

  test('removing the focused last item moves focus to the new last item', async () => {
    const { rerender } = render(<ShrinkableMenu items={['A', 'B', 'C']} />);
    fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
    let items = screen.getAllByRole('menuitem');
    await waitFor(() => expect(hasFocus(items[0])).toBe(true));
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'End' });
    expect(hasFocus(items[2])).toBe(true); // focus on C, the last item

    rerender(<ShrinkableMenu items={['A', 'B']} />); // remove C

    await waitFor(() => {
      items = screen.getAllByRole('menuitem');
      expect(document.activeElement).toBe(items[1]); // B, the new last item
    });
    expect(document.activeElement?.textContent).toBe('B');
    expect(document.activeElement).not.toBe(document.body);

    // The menu still responds to the keyboard after the repair.
    const menu = screen.getByRole('menu');
    fireEvent.keyDown(menu, { key: 'ArrowDown' });
    expect(hasFocus(items[0])).toBe(true); // wraps
  });

  test('removing the only focused item closes the menu and returns focus to the trigger', async () => {
    const { rerender } = render(<ShrinkableMenu items={['A']} />);
    const trigger = screen.getByRole('button', { name: 'Settings' });
    fireEvent.click(trigger);
    const items = screen.getAllByRole('menuitem');
    await waitFor(() => expect(hasFocus(items[0])).toBe(true));

    rerender(<ShrinkableMenu items={[]} />); // remove the only item

    await waitFor(() => {
      expect(screen.queryByRole('menu')).toBeNull();
    });
    expect(hasFocus(trigger)).toBe(true);
    expect(document.activeElement).not.toBe(document.body);
    expect(attr(trigger, 'aria-expanded')).toBe('false');

    // Empty case: the trigger is left focused and functional afterward.
    fireEvent.keyDown(trigger, { key: 'ArrowDown' });
    expect(screen.getByRole('menu')).toBeTruthy();
  });

  test('removing a non-focused item does not steal focus', async () => {
    const { rerender } = render(<ShrinkableMenu items={['A', 'B', 'C']} />);
    fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
    const items = screen.getAllByRole('menuitem');
    await waitFor(() => expect(hasFocus(items[0])).toBe(true)); // focus on A

    rerender(<ShrinkableMenu items={['A', 'B']} />); // remove C, unfocused

    // A's own DOM node never moved or unmounted, so nothing should touch it.
    expect(hasFocus(items[0])).toBe(true);
  });

  test('moving focus to the menu root before the previously-focused item is removed leaves focus on the root', async () => {
    // "The tracked item left the list" is not the same signal as "focus was
    // lost" -- a user can click the menu's own padding (tabIndex 0) and move
    // focus there deliberately before a re-render removes whatever used to
    // be focused.
    const { rerender } = render(<ShrinkableMenu items={['A', 'B']} />);
    fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
    const items = screen.getAllByRole('menuitem');
    await waitFor(() => expect(hasFocus(items[0])).toBe(true));

    const menu = screen.getByRole('menu');
    menu.focus();
    expect(hasFocus(menu)).toBe(true);

    rerender(<ShrinkableMenu items={['B']} />); // remove A, which had focus

    expect(hasFocus(menu)).toBe(true);
  });

  test('focus moved outside the menu while it stays open is not stolen back when the previously-focused item is removed', async () => {
    // Nothing requires the menu to close before focus moves elsewhere --
    // consumer code can move focus out from under it while `open` stays
    // true. The repair effect must tell that apart from the browser
    // actually dropping focus to <body>.
    const { rerender } = render(
      <div>
        <button type="button">outside</button>
        <ShrinkableMenu items={['A', 'B']} />
      </div>
    );
    fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
    const items = screen.getAllByRole('menuitem');
    await waitFor(() => expect(hasFocus(items[0])).toBe(true));

    const outside = screen.getByRole('button', { name: 'outside' });
    outside.focus();
    expect(hasFocus(outside)).toBe(true);

    rerender(
      <div>
        <button type="button">outside</button>
        <ShrinkableMenu items={['B']} />
      </div>
    ); // remove A, which had focus before it moved outside

    expect(hasFocus(outside)).toBe(true);
  });

  test('inserting an item ahead of the focused one keeps the repair index in sync when it is later removed', async () => {
    const { rerender } = render(<ShrinkableMenu items={['A', 'B', 'C']} />);
    fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
    let items = screen.getAllByRole('menuitem');
    await waitFor(() => expect(hasFocus(items[0])).toBe(true));
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'ArrowDown' });
    expect(hasFocus(items[1])).toBe(true); // focus on B, index 1

    // B's own DOM node stays focused across this re-render (keyed, not
    // unmounted), so no focus event fires -- but its index moves from 1 to
    // 2, and nothing else updates the tracked index outside a focus event.
    rerender(<ShrinkableMenu items={['Z', 'A', 'B', 'C']} />);
    items = screen.getAllByRole('menuitem');
    expect(hasFocus(items[2])).toBe(true); // sanity check: B, now at index 2

    rerender(<ShrinkableMenu items={['Z', 'A', 'C']} />); // remove B

    await waitFor(() => {
      items = screen.getAllByRole('menuitem');
      expect(document.activeElement).toBe(items[2]); // C, now at index 2
    });
    expect(document.activeElement?.textContent).toBe('C');
  });

  test('selecting the focused item removes it and closes the menu in the same render', async () => {
    // The removal-repair effect must not fire once `open` has already gone
    // false in the same commit as the removal.
    render(<ClosingShrinkMenu />);
    const trigger = screen.getByRole('button', { name: 'Settings' });
    fireEvent.click(trigger);
    const items = screen.getAllByRole('menuitem');
    await waitFor(() => expect(hasFocus(items[0])).toBe(true));
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'ArrowDown' });
    expect(hasFocus(items[1])).toBe(true); // focus on B

    fireEvent.click(items[1]); // select B: shrinks to ['A'] and closes

    expect(screen.queryByRole('menu')).toBeNull();
    expect(hasFocus(trigger)).toBe(true);
  });

  test('unmounting while a since-removed item held focus does not throw', async () => {
    const { rerender, unmount } = render(<ShrinkableMenu items={['A', 'B']} />);
    fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
    const items = screen.getAllByRole('menuitem');
    await waitFor(() => expect(hasFocus(items[0])).toBe(true));
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'ArrowDown' });
    expect(hasFocus(items[1])).toBe(true);

    rerender(<ShrinkableMenu items={['A']} />); // remove the focused item

    expect(() => unmount()).not.toThrow();
  });

  test('menu items meet the 44px hit target', async () => {
    render(<Menu />);
    fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
    const item = (await screen.findAllByRole('menuitem'))[0];
    // A `var()` read (#622), not the literal `44px` it used to be -- see
    // `controlTargetStyle`'s own comment in `loading-error.tsx`.
    expect(item.style.minWidth).toBe(
      'var(--playdeck-control-min-size, 2.75rem)'
    );
    expect(item.style.minHeight).toBe(
      'var(--playdeck-control-min-size, 2.75rem)'
    );
  });
});

describe('ref forwarding', () => {
  test('forwards an object ref on SettingsMenu to its root element', () => {
    const ref = createRef<HTMLDivElement>();
    render(<Player.SettingsMenu ref={ref} />);
    expect(ref.current).toBe(
      document.querySelector('[data-playdeck-part="settings-menu-root"]')
    );
  });

  test('forwards a callback ref on SettingsMenu to its root element, and null on unmount', () => {
    const consumerRef = vi.fn();
    const { unmount } = render(<Player.SettingsMenu ref={consumerRef} />);
    const root = document.querySelector(
      '[data-playdeck-part="settings-menu-root"]'
    );
    expect(consumerRef).toHaveBeenCalledExactlyOnceWith(root);

    unmount();

    expect(consumerRef).toHaveBeenCalledTimes(2);
    expect(consumerRef.mock.calls[1][0]).toBeNull();
  });

  test('forwards an object ref on SettingsMenuTrigger to the trigger button', () => {
    const ref = createRef<HTMLButtonElement>();
    render(
      <Player.SettingsMenu>
        <Player.SettingsMenuTrigger ref={ref} />
      </Player.SettingsMenu>
    );
    expect(ref.current).toBe(screen.getByRole('button', { name: 'Settings' }));
  });

  test('forwards a callback ref on SettingsMenuTrigger to the trigger button, and null on unmount', () => {
    const consumerRef = vi.fn();
    const { unmount } = render(
      <Player.SettingsMenu>
        <Player.SettingsMenuTrigger ref={consumerRef} />
      </Player.SettingsMenu>
    );
    const trigger = screen.getByRole('button', { name: 'Settings' });
    expect(consumerRef).toHaveBeenCalledExactlyOnceWith(trigger);

    unmount();

    expect(consumerRef).toHaveBeenCalledTimes(2);
    expect(consumerRef.mock.calls[1][0]).toBeNull();
  });

  test('forwards an object ref on SettingsMenuContent to the menu element', () => {
    const ref = createRef<HTMLDivElement>();
    render(
      <Player.SettingsMenu>
        <Player.SettingsMenuTrigger />
        <Player.SettingsMenuContent ref={ref}>
          <Player.MenuItem>Quality</Player.MenuItem>
        </Player.SettingsMenuContent>
      </Player.SettingsMenu>
    );
    fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
    expect(ref.current).toBe(screen.getByRole('menu'));
  });

  test('forwards a callback ref on SettingsMenuContent to the menu element, and null on close', () => {
    const consumerRef = vi.fn();
    render(
      <Player.SettingsMenu>
        <Player.SettingsMenuTrigger />
        <Player.SettingsMenuContent ref={consumerRef}>
          <Player.MenuItem>Quality</Player.MenuItem>
        </Player.SettingsMenuContent>
      </Player.SettingsMenu>
    );
    fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
    const menu = screen.getByRole('menu');
    expect(consumerRef).toHaveBeenCalledExactlyOnceWith(menu);

    // SettingsMenuContent unmounts itself (returns null) once closed, rather
    // than the test unmounting the tree.
    fireEvent.keyDown(menu, { key: 'Escape' });

    expect(screen.queryByRole('menu')).toBeNull();
    expect(consumerRef).toHaveBeenCalledTimes(2);
    expect(consumerRef.mock.calls[1][0]).toBeNull();
  });

  // React 19 runs a callback ref's own returned cleanup on detach instead of
  // calling the callback again with `null` -- so a naive merge that just
  // returns that cleanup upward never sees a `null` call itself, either.
  test('SettingsMenu respects a callback ref that returns its own cleanup, and does not call it again with null', () => {
    const cleanup = vi.fn();
    const consumerRef = vi.fn(() => cleanup);
    const { unmount } = render(<Player.SettingsMenu ref={consumerRef} />);
    const root = document.querySelector(
      '[data-playdeck-part="settings-menu-root"]'
    );
    expect(consumerRef).toHaveBeenCalledExactlyOnceWith(root);

    unmount();

    expect(cleanup).toHaveBeenCalledOnce();
    expect(consumerRef).toHaveBeenCalledOnce();
  });

  test('SettingsMenuTrigger respects a callback ref that returns its own cleanup, and does not call it again with null', () => {
    const cleanup = vi.fn();
    const consumerRef = vi.fn(() => cleanup);
    const { unmount } = render(
      <Player.SettingsMenu>
        <Player.SettingsMenuTrigger ref={consumerRef} />
      </Player.SettingsMenu>
    );
    const trigger = screen.getByRole('button', { name: 'Settings' });
    expect(consumerRef).toHaveBeenCalledExactlyOnceWith(trigger);

    unmount();

    expect(cleanup).toHaveBeenCalledOnce();
    expect(consumerRef).toHaveBeenCalledOnce();
  });

  // Reproduces the bug directly: `close()` reads `triggerRef` from context,
  // not from this trigger's own props, so it can run after the trigger that
  // set it has unmounted while `SettingsMenu` itself stays mounted. If the
  // merge above only forwards the consumer's own cleanup on detach without
  // also releasing `triggerRef`, `triggerRef.current` keeps pointing at the
  // detached button and `close()` calls `.focus()` on it.
  test('unmounting SettingsMenuTrigger releases its internal ref, so Escape does not focus the detached button', async () => {
    const consumerRef = () => () => {};
    const Harness = ({ showTrigger }: { showTrigger: boolean }) => (
      <Player.SettingsMenu>
        {showTrigger && <Player.SettingsMenuTrigger ref={consumerRef} />}
        <Player.SettingsMenuContent>
          <Player.MenuItem>Quality</Player.MenuItem>
        </Player.SettingsMenuContent>
      </Player.SettingsMenu>
    );
    const { rerender } = render(<Harness showTrigger />);
    const trigger = screen.getByRole('button', { name: 'Settings' });
    const focusSpy = vi.spyOn(trigger, 'focus');
    fireEvent.click(trigger);
    await waitFor(() => expect(screen.getByRole('menu')).toBeTruthy());

    rerender(<Harness showTrigger={false} />);
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' });

    expect(focusSpy).not.toHaveBeenCalled();
  });

  test('SettingsMenuContent respects a callback ref that returns its own cleanup, and does not call it again with null', () => {
    const cleanup = vi.fn();
    const consumerRef = vi.fn(() => cleanup);
    render(
      <Player.SettingsMenu>
        <Player.SettingsMenuTrigger />
        <Player.SettingsMenuContent ref={consumerRef}>
          <Player.MenuItem>Quality</Player.MenuItem>
        </Player.SettingsMenuContent>
      </Player.SettingsMenu>
    );
    fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
    const menu = screen.getByRole('menu');
    expect(consumerRef).toHaveBeenCalledExactlyOnceWith(menu);

    fireEvent.keyDown(menu, { key: 'Escape' });

    expect(screen.queryByRole('menu')).toBeNull();
    expect(cleanup).toHaveBeenCalledOnce();
    expect(consumerRef).toHaveBeenCalledOnce();
  });
});

describe('MenuRadioGroup', () => {
  const SpeedMenu = ({
    value,
    onValueChange
  }: {
    value: string;
    onValueChange: (v: string) => void;
  }) => (
    <Player.SettingsMenu>
      <Player.SettingsMenuTrigger />
      <Player.SettingsMenuContent>
        <Player.MenuRadioGroup value={value} onValueChange={onValueChange}>
          <Player.MenuRadioItem value="0.5">0.5×</Player.MenuRadioItem>
          <Player.MenuRadioItem value="1">1×</Player.MenuRadioItem>
          <Player.MenuRadioItem value="2">2×</Player.MenuRadioItem>
        </Player.MenuRadioGroup>
      </Player.SettingsMenuContent>
    </Player.SettingsMenu>
  );

  test('marks the selected item and exposes menuitemradio semantics', () => {
    render(<SpeedMenu value="1" onValueChange={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
    const selected = screen.getByRole('menuitemradio', { name: '1×' });
    expect(selected.getAttribute('aria-checked')).toBe('true');
    expect(
      screen
        .getByRole('menuitemradio', { name: '0.5×' })
        .getAttribute('aria-checked')
    ).toBe('false');
  });

  test('selecting a radio item fires onValueChange with its value and closes', async () => {
    let value = '1';
    const onChange = (v: string) => (value = v);
    const { rerender } = render(
      <SpeedMenu value={value} onValueChange={onChange} />
    );
    const trigger = screen.getByRole('button', { name: 'Settings' });
    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole('menuitemradio', { name: '2×' }));
    expect(value).toBe('2');
    expect(screen.queryByRole('menu')).toBeNull();
    expect(hasFocus(trigger)).toBe(true);
    rerender(<SpeedMenu value={value} onValueChange={onChange} />);
    fireEvent.click(trigger);
    expect(
      screen
        .getByRole('menuitemradio', { name: '2×' })
        .getAttribute('aria-checked')
    ).toBe('true');
  });
});
