import type { Decorator, Preview } from '@storybook/react-vite';
import { withMockPlayer } from './mock-player';
// Read as text, not injected. A plain `import '@reely/react/theme.css'`
// attaches it to the whole Storybook preview -- every story renders in the same
// document, and most of them assert unthemed computed styles -- so the theme is
// mounted per story below and torn down with it.
//
// Imported by path rather than as `@reely/react/theme.css?inline`, because Vite
// cannot carry a query through the package exports map. The published entry is
// covered where it belongs: packages/react/test/theme.test.ts asserts the
// exports and files entries, and publint/attw check the tarball.
import themeCss from '../../../packages/react/theme.css?inline';

/**
 * Mounts the optional theme when the toolbar's Theme toggle is on, as a `<style>`
 * inside the story's own tree so it unmounts with the story. This is the only
 * place the stylesheet is mounted; a story that wants it regardless of the
 * toolbar pins itself with `globals: { theme: 'themed' }` (see
 * `stories/theme.stories.tsx`).
 */
const withTheme: Decorator = (Story, context) =>
  context.globals.theme === 'themed' ? (
    <>
      <style>{themeCss}</style>
      <Story />
    </>
  ) : (
    <Story />
  );

const preview: Preview = {
  decorators: [withTheme, withMockPlayer],
  tags: ['autodocs'],
  globalTypes: {
    theme: {
      description: 'Mount the optional @reely/react/theme.css',
      toolbar: {
        title: 'Theme',
        icon: 'paintbrush',
        items: [
          { value: 'headless', title: 'Headless' },
          { value: 'themed', title: 'Themed' }
        ],
        dynamicTitle: true
      }
    }
  },
  // Headless is the default the library ships, so it is the default the
  // workbench shows. Stated here rather than left to the toggle: `initialGlobals`
  // is the one declaration both the preview and the portable-story path Vitest
  // runs on read, so this is what pins the toggle off for the test run.
  initialGlobals: { theme: 'headless' },
  parameters: {
    a11y: {
      // Fail the Vitest story test when axe reports a violation.
      test: 'error'
    }
  }
};

export default preview;
