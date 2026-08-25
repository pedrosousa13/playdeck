import type { ComponentProps } from 'react';
import { expectTypeOf, test } from 'vitest';
import * as Player from '../src/index';
import type {
  MenuItemProps,
  MenuRadioGroupProps,
  MenuRadioItemProps,
  SettingsMenuContentProps,
  SettingsMenuProps,
  SettingsMenuTriggerProps
} from '../src/index';

// The menu parts are the one corner of the surface a consumer is guaranteed to
// wrap: the package ships no playback-rate or quality menu and the README sends
// them here to compose one. A wrapper cannot be written against props that have
// no name, and these six had none (#438) -- they took their props inline, so
// there was nothing to import.
//
// Each wrapper below compiles only while its type is exported from the package
// entry, and each assertion holds only while that type still describes the
// component it is named for -- re-inlining one, or letting the two drift, fails
// here. These are type-level claims, so they fail `pnpm typecheck` rather than
// the runtime run, the same way `root-props.test.ts` does.
const Menu = (props: SettingsMenuProps) => <Player.SettingsMenu {...props} />;

const Trigger = (props: SettingsMenuTriggerProps) => (
  <Player.SettingsMenuTrigger {...props} />
);

const Content = (props: SettingsMenuContentProps) => (
  <Player.SettingsMenuContent {...props} />
);

const Item = (props: MenuItemProps) => <Player.MenuItem {...props} />;

const RadioGroup = (props: MenuRadioGroupProps) => (
  <Player.MenuRadioGroup {...props} />
);

const RadioItem = (props: MenuRadioItemProps) => (
  <Player.MenuRadioItem {...props} />
);

test('every menu part has a named props type a consumer can wrap it in', () => {
  expectTypeOf(Menu)
    .parameter(0)
    .toEqualTypeOf<ComponentProps<typeof Player.SettingsMenu>>();
  expectTypeOf(Trigger)
    .parameter(0)
    .toEqualTypeOf<ComponentProps<typeof Player.SettingsMenuTrigger>>();
  expectTypeOf(Content)
    .parameter(0)
    .toEqualTypeOf<ComponentProps<typeof Player.SettingsMenuContent>>();
  expectTypeOf(Item)
    .parameter(0)
    .toEqualTypeOf<ComponentProps<typeof Player.MenuItem>>();
  expectTypeOf(RadioGroup)
    .parameter(0)
    .toEqualTypeOf<ComponentProps<typeof Player.MenuRadioGroup>>();
  expectTypeOf(RadioItem)
    .parameter(0)
    .toEqualTypeOf<ComponentProps<typeof Player.MenuRadioItem>>();
});
