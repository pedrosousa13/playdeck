import type { Decorator } from '@storybook/react-vite';
// Read as text, not injected. A plain `import '@reely/react/theme.css'`
// attaches it to the whole Storybook preview -- every story renders in the same
// document, and the stories that do assert computed styles assume unthemed
// values -- so the theme is mounted per story below and torn down with it.
//
// Imported by path rather than as `@reely/react/theme.css?inline`, because Vite
// cannot carry a query through the package exports map. The published entry is
// covered where it belongs: packages/react/test/theme.test.ts asserts the
// exports and files entries, and publint/attw check the tarball.
import themeCss from '../../../packages/react/theme.css?inline';

/**
 * Mounts the optional theme when the toolbar's Theme toggle is on, as a
 * `<style>` inside the story's own tree so it unmounts with the story. This is
 * the only place the stylesheet is mounted; a story that wants it regardless of
 * the toolbar pins itself with `globals: { theme: 'themed' }` (see
 * `stories/theme.stories.tsx`).
 */
export const withTheme: Decorator = (Story, context) =>
  context.globals.theme === 'themed' ? (
    <>
      <style>{themeCss}</style>
      <Story />
    </>
  ) : (
    <Story />
  );
