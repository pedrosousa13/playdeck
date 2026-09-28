// @vitest-environment happy-dom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor
} from '@testing-library/react';
import { createRef } from 'react';
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
