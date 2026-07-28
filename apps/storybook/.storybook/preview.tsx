import type { Preview } from '@storybook/react-vite';
import { withMockPlayer } from './mock-player';
import { withTheme } from './theme';

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
