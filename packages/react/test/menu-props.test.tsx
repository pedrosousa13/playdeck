import type { ComponentPropsWithRef } from 'react';
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
// Two claims, and they catch different regressions. The wrappers below compile
// only while each type is exported from the package entry AND still covers
// everything its part demands -- narrow one and the spread stops satisfying the
// part. The assertions restate each shape independently, the way
// `root-props.test.ts` restates `RootProps`'s key set, so widening one fails
// too. Asserting a type against `ComponentProps<typeof Part>` would do neither:
// the part is annotated with that same type, so it would only ever compare a
// thing to itself.
//
// What nothing here catches is a swap between two parts that genuinely take the
// same props -- `SettingsMenuProps` and `SettingsMenuContentProps` are both a
// div's props, and no assertion can separate types that are equal.
//
// These are type-level claims, so they fail `pnpm typecheck` rather than the
// runtime run, the same way `root-props.test.ts` does.
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
  // Each wrapper is referenced as a value, which is what proves it compiled.
  expectTypeOf(Menu).parameter(0).toEqualTypeOf<SettingsMenuProps>();
  expectTypeOf(Trigger).parameter(0).toEqualTypeOf<SettingsMenuTriggerProps>();
  expectTypeOf(Content).parameter(0).toEqualTypeOf<SettingsMenuContentProps>();
  expectTypeOf(Item).parameter(0).toEqualTypeOf<MenuItemProps>();
  expectTypeOf(RadioGroup).parameter(0).toEqualTypeOf<MenuRadioGroupProps>();
  expectTypeOf(RadioItem).parameter(0).toEqualTypeOf<MenuRadioItemProps>();
});

test('each menu part accepts exactly the props it accepted before it was named', () => {
  // Restated here rather than read off the parts, so that widening or narrowing
  // one of the six aliases fails rather than moving both sides at once.
  expectTypeOf<SettingsMenuProps>().toEqualTypeOf<
    ComponentPropsWithRef<'div'>
  >();
  expectTypeOf<SettingsMenuTriggerProps>().toEqualTypeOf<
    ComponentPropsWithRef<'button'>
  >();
  expectTypeOf<SettingsMenuContentProps>().toEqualTypeOf<
    ComponentPropsWithRef<'div'>
  >();
  expectTypeOf<MenuItemProps>().toEqualTypeOf<
    ComponentPropsWithRef<'button'> & { readonly onSelect?: () => void }
  >();
  expectTypeOf<MenuRadioGroupProps>().toEqualTypeOf<
    ComponentPropsWithRef<'div'> & {
      readonly value: string;
      readonly onValueChange: (value: string) => void;
    }
  >();
  expectTypeOf<MenuRadioItemProps>().toEqualTypeOf<
    ComponentPropsWithRef<'button'> & { readonly value: string }
  >();
});
