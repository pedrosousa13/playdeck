import js from '@eslint/js';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/node_modules/**',
      '**/storybook-static/**',
      'playwright-report/**',
      'test-results/**',
      '.superpowers/**',
      'docs/superpowers/plans/**',
      // MPEG-TS media segments share the .ts extension with TypeScript.
      'apps/storybook/public/hls/**'
    ]
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{js,ts}'],
    languageOptions: { globals: globals.node }
  },
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: { globals: { ...globals.browser, ...globals.node } },
    plugins: { 'react-hooks': reactHooks },
    rules: reactHooks.configs.recommended.rules
  },
  {
    // Playwright matches accessible names as SUBSTRINGS (testing-library
    // matches exactly), so `{ name: 'Play' }` also resolves "AirPlay" and
    // "Play video". The resulting strict-mode violation only appears once a
    // second control renders — often on one engine only, which is the most
    // expensive shape of CI failure. See #73.
    files: ['e2e/**/*.ts'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector:
            "CallExpression[callee.property.name='getByRole'] > ObjectExpression:has(Property[key.name='name']):not(:has(Property[key.name='exact']))",
          message:
            'Playwright name matching is a substring match. Locate reely controls by [data-reely-part=...], or pass exact: true.'
        }
      ]
    }
  }
);
