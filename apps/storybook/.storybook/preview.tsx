import type { Preview } from '@storybook/react-vite';
import { withMockPlayer } from './mock-player';
import { withTheme } from './theme';

const preview: Preview = {
  decorators: [withTheme, withMockPlayer],
  tags: ['autodocs'],
  globalTypes: {
    theme: {
      description: 'Mount the optional @playdeck/react/theme.css',
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
      // Fail the Vitest story test when axe reports a violation. Vitest never
      // loads a URL, so this role is untouched by `e2e/a11y.spec.ts`, which
      // appends `globals=a11y.manual:!true` to its story URLs to keep the
      // addon's axe-core out of the Playwright scan's frame (#346). That spec
      // depends on the addon's `a11y.manual` global, so anything here that
      // touches the `a11y` globals — an `initialGlobals: { a11y: … }`, a
      // `globalTypes.a11y` — belongs in that spec's reasoning too.
      test: 'error'
    },
    options: {
      // Storybook opens on the first leaf in the sidebar, and left to sort
      // itself that was `Overview/Capabilities matrix` — a table. Every
      // per-part story is unstyled and inert by design (no CSS, mock provider,
      // no media), so whichever one sorts first reads as a broken widget on
      // first contact. `Overview/Reference example` is the page that answers
      // "what is this", so it goes first and the workbench opens there.
      //
      // Sorting only. Story ids come from each story's `title`, which nothing
      // here touches, so the e2e suite keeps addressing stories by the same ids.
      storySort: {
        // Reading order: what it is, then the parts, then the parts composed,
        // then the optional theme, then the stories that need the network.
        order: [
          'Overview',
          [
            // The composed player first — it is where the sidebar lands.
            'Reference example',
            // Then the workbench's own conventions, then the contract every
            // primitive obeys, then the narrower topics, then the optional
            // stylesheet the library does not require.
            'Introduction',
            'Contract',
            'Captions',
            'Capabilities matrix',
            'Theme'
          ],
          'Player',
          'Reference',
          // The two composed archetypes, after the primitives they are built
          // from and after the reference composition that proves the surface is
          // sufficient — they are what the parts add up to, so they read last
          // among the things a visitor is meant to look at.
          'Archetypes',
          'Theme',
          // Both hit the network or exist to be driven by e2e, so they sit
          // below everything a visitor reads.
          'Real playback',
          'Fixtures'
        ]
      }
    }
  }
};

export default preview;
