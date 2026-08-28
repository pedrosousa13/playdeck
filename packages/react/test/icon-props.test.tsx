import type { SVGProps } from 'react';
import { expectTypeOf, test } from 'vitest';
import * as Player from '../src/index';
import type { IconProps } from '../src/index';

// The icons reach consumers through a re-export from the package entry, so they
// are public, and elsewhere in the package an exported component ships a props
// type a consumer can import. These did not (#478) -- the alias existed in the
// icons module without the `export` keyword, so a wrapper had to restate
// `SVGProps<SVGSVGElement>` from memory.
//
// One shared type covers them all rather than an alias per icon. They accept
// the same props, and a name each would be a difference a reader has to check
// for and never finds.
//
// The two tests below prove different things, and the split is the point.
//
// The first proves only that the name is importable from the entry and that an
// icon accepts a value of it. It does NOT constrain the shape: every icon is
// annotated `(props: IconProps)`, so a wrapper spreading `IconProps` into one
// compiles for any definition of the alias -- narrow it and both sides move
// together. This is the same trap as asserting against
// `ComponentProps<typeof PlayIcon>`, and the reason the second test exists
// rather than being folded into the first.
//
// The second is what pins the shape, by restating it independently of the
// icons. Widening or narrowing the alias fails there.
//
// These are type-level claims, so they fail `pnpm typecheck` rather than the
// runtime run.
const Play = (props: IconProps) => <Player.PlayIcon {...props} />;

const Captions = (props: IconProps) => <Player.CaptionsIcon {...props} />;

const Settings = (props: IconProps) => <Player.SettingsIcon {...props} />;

test('an icon has a named props type a consumer can wrap it in', () => {
  // Each wrapper is referenced as a value, which is what proves it compiled --
  // and compiling is the whole claim, since the import above fails outright if
  // the entry stops exporting the name.
  expectTypeOf(Play).parameter(0).toEqualTypeOf<IconProps>();
  expectTypeOf(Captions).parameter(0).toEqualTypeOf<IconProps>();
  expectTypeOf(Settings).parameter(0).toEqualTypeOf<IconProps>();
});

test('the icons accept exactly what they accepted before the type was named', () => {
  // Restated here rather than read off an icon, so that widening or narrowing
  // the alias fails rather than moving both sides at once.
  expectTypeOf<IconProps>().toEqualTypeOf<SVGProps<SVGSVGElement>>();
});
