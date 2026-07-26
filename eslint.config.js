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
    // Playwright matches accessible names and text as SUBSTRINGS
    // (testing-library matches exactly), so `{ name: 'Play' }` also resolves
    // "AirPlay" and "Play video". The resulting strict-mode violation only
    // appears once a second element renders — often on one engine only, which
    // is the most expensive shape of CI failure. See #73. `exact: false` is a
    // substring match too, so only `exact: true` satisfies these rules.
    files: ['e2e/**/*.ts'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector:
            "CallExpression[callee.property.name='getByRole'] > ObjectExpression:has(> Property[key.name='name']):not(:has(> Property[key.name='exact'][value.value=true]))",
          message:
            'Playwright name matching is a substring match. Locate reely controls by [data-reely-part=...], or pass exact: true.'
        },
        {
          selector:
            'CallExpression[callee.property.name=/^getBy(Label|Text|Placeholder|Title|AltText)$/][arguments.length<2]',
          message:
            'Playwright text matching is a substring match. Locate by [data-reely-part=...], or pass exact: true.'
        },
        {
          selector:
            "CallExpression[callee.property.name=/^getBy(Label|Text|Placeholder|Title|AltText)$/] > ObjectExpression:not(:has(> Property[key.name='exact'][value.value=true]))",
          message:
            'Playwright text matching is a substring match. Locate by [data-reely-part=...], or pass exact: true.'
        }
      ]
    }
  },
  {
    // #67's reference example is the proof that the primitives are sufficient,
    // which only holds if it composes from public exports. Convention has
    // failed twice (#15, #73), so this is a gate rather than a comment.
    //
    // A denylist, not an allowlist: ESLint's group negation never un-matches a
    // specifier containing `/`, so `['**', '!@reely/react', ...]` rejects
    // `@reely/react` itself. Verified over 13 cases by
    // stories/reference/import-rule.contract.test.ts, which is also what keeps
    // this rule red-then-green rather than merely present.
    //
    // Known limit, stated in Reference.mdx: this proves specifier hygiene, not
    // that a brand-new third-party dependency was not added.
    files: ['apps/storybook/stories/reference/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['../*', '../**'],
              message:
                'The reference example must not reach outside its own directory: it exists to prove the primitives are sufficient from public exports alone. Rebuild what you need from @reely/react / @reely/core.'
            },
            {
              group: ['**/packages/**', '@reely/*/src/**'],
              message:
                'Import the package entry (@reely/react, @reely/core), never a path into its source.'
            },
            {
              group: ['@reely/provider-*', 'hls.js'],
              message:
                'The example composes against the public React surface only; providers are wired by Player.Root.'
            }
          ]
        }
      ]
    }
  }
);
