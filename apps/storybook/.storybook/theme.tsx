import type { Decorator } from '@storybook/react-vite';
// Read as text, not injected. A plain `import '@playdeck/react/theme.css'`
// attaches it to the whole Storybook preview -- every story renders in the same
// document, and the stories that do assert computed styles assume unthemed
// values -- so the theme is mounted per story below and torn down with it.
//
// Imported by path rather than as `@playdeck/react/theme.css?inline`, because Vite
// cannot carry a query through the package exports map. The published entry is
// covered where it belongs: packages/react/test/theme.test.ts asserts the
// exports and files entries, and publint/attw check the tarball.
import themeCss from '../../../packages/react/theme.css?inline';
// The second theme, mounted by the same mechanism and never alongside the
// first: both files open `@layer playdeck`, and two files declaring one layer
// name merge into it rather than shadowing each other, so a document carrying
// both would have their rules for a shared selector competing on source order
// alone. `withTheme` below is an either/or for exactly that reason.
import dockedCss from '../../../packages/react/docked.css?inline';

/**
 * Mounts a stylesheet as a `<style>` inside the story's own tree, so it is torn
 * down with the story rather than leaking into the next one in the same
 * document. The mechanism the theme toggle needs, and the one the per-part CSS
 * examples need too — `stories/*.stories.tsx` reach for it directly to mount
 * the `examples/css-*.css` file their docs page shows.
 */
export const withCss =
  (css: string): Decorator =>
  (Story) => (
    <>
      <style>{css}</style>
      <Story />
    </>
  );

const withThemeCss = withCss(themeCss);
const withDockedCss = withCss(dockedCss);

/**
 * Mounts one optional theme, or none, from the toolbar's Theme toggle. This is
 * the only place either stylesheet is mounted; a story that wants one
 * regardless of the toolbar pins itself with `globals: { theme: 'themed' }`
 * (see `stories/theme.stories.tsx`), and `e2e/a11y.spec.ts` reaches the docked
 * one the same way through a story URL's `globals=theme:docked`.
 *
 * Never both at once — see the import comment above.
 */
export const withTheme: Decorator = (Story, context) => {
  if (context.globals.theme === 'themed') return withThemeCss(Story, context);
  if (context.globals.theme === 'docked') return withDockedCss(Story, context);
  return <Story />;
};
