// @vitest-environment happy-dom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor
} from '@testing-library/react';
import { afterEach, describe, expect, test } from 'vitest';
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
    expect(attr(menu, 'data-reely-menu')).toBe('open');
    expect(attr(menu, 'data-reely-part')).toBe('settings-menu');
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

  test('menu items meet the 44px hit target', async () => {
    render(<Menu />);
    fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
    const item = (await screen.findAllByRole('menuitem'))[0];
    expect(item.style.minWidth).toBe('44px');
    expect(item.style.minHeight).toBe('44px');
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
