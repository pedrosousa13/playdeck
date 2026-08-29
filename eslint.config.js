import js from '@eslint/js';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      // The site built a second time under a non-root prefix, by
      // `apps/site`'s `build:based` for `e2e/site-search.spec.ts`. It is the
      // same build output as `dist/` above under a name that pattern does not
      // reach, so without this the gate lints Pagefind's own bundles and the
      // minified islands (#525).
      'apps/site/dist-base/**',
      '**/node_modules/**',
      '**/storybook-static/**',
      // Gitignored and generated, and listed for the reason `.scratch/**`
      // below is: flat config does not read .gitignore, so without this the
      // ambient types `astro build` writes are linted as project source and
      // fail the gate on code nobody in this repo wrote (#519).
      '**/.astro/**',
      // The assembled deployment (scripts/assemble-deploy.mjs) is a copy of the
      // two build outputs above, so linting it lints minified bundles that were
      // already excluded under the names they were built as (#519).
      'deploy-dist/**',
      'playwright-report/**',
      'test-results/**',
      // Gitignored, unlike the two entries below — and not redundant for it.
      // Flat config does not read .gitignore, so without this the scratch
      // files a session writes are linted as project source and fail that
      // session's own gate (#410).
      '.scratch/**',
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
            'Playwright name matching is a substring match. Locate playdeck controls by [data-playdeck-part=...], or pass exact: true.'
        },
        {
          selector:
            'CallExpression[callee.property.name=/^getBy(Label|Text|Placeholder|Title|AltText)$/][arguments.length<2]',
          message:
            'Playwright text matching is a substring match. Locate by [data-playdeck-part=...], or pass exact: true.'
        },
        {
          selector:
            "CallExpression[callee.property.name=/^getBy(Label|Text|Placeholder|Title|AltText)$/] > ObjectExpression:not(:has(> Property[key.name='exact'][value.value=true]))",
          message:
            'Playwright text matching is a substring match. Locate by [data-playdeck-part=...], or pass exact: true.'
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
    // specifier containing `/`, so `['**', '!@playdeck/react', ...]` rejects
    // `@playdeck/react` itself. Verified over 13 cases by
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
                'The reference example must not reach outside its own directory: it exists to prove the primitives are sufficient from public exports alone. Rebuild what you need from @playdeck/react / @playdeck/core.'
            },
            {
              group: ['**/packages/**', '@playdeck/*/src/**'],
              message:
                'Import the package entry (@playdeck/react, @playdeck/core), never a path into its source.'
            },
            {
              group: ['@playdeck/provider-*', 'hls.js'],
              message:
                'The example composes against the public React surface only; providers are wired by Player.Root.'
            }
          ]
        }
      ]
    }
  },
  {
    // A poster must be a real <img>/<picture> element: the geometry
    // guarantees and the poster state machine both depend on that element
    // existing, so a CSS background-image is a regression class (see
    // e2e/poster.spec.ts), not a style preference. That gate used to read raw
    // source text for every language and could not tell a declaration from a
    // doc comment describing one (#184). ESLint parses an AST instead, where
    // comments are never nodes, so a comment tripping this is structurally
    // impossible rather than regex-patched. CSS has no AST tooling in this
    // repo, so its half stays a comment-stripped text scan in
    // e2e/poster.spec.ts.
    //
    // Scoped to the product source this gate polices. Two legitimate
    // occurrences must keep passing, carved out by two different mechanisms:
    // `packages/react/test/index.test.tsx` asserts the poster element
    // carries no `background-image` inline style, and is carved out by
    // `ignores` below (it is both a `.test.` file and inside a `test/`
    // directory); `e2e/background-image-scan.ts` holds this same gate's CSS
    // half as a regex literal, and needs no carve-out at all — `e2e/` was
    // never in the `files` glob this block matches against, so it is out of
    // this rule's reach regardless of what it contains. Verified
    // red-then-green by
    // apps/storybook/stories/no-background-image.contract.test.ts.
    files: ['apps/**/*.{js,jsx,ts,tsx}', 'packages/**/*.{js,jsx,ts,tsx}'],
    ignores: ['**/*.test.*', '**/*.spec.*', '**/test/**'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector:
            "Property[key.name='backgroundImage'], Property[key.value='backgroundImage']",
          message:
            'A poster must be a real <img>/<picture> element, never a CSS background-image: this object property sets one. If this is prose about the property rather than a live style, move it into a comment. See e2e/poster.spec.ts.'
        },
        {
          selector:
            "AssignmentExpression[left.property.name='backgroundImage'], AssignmentExpression[left.property.value='backgroundImage']",
          message:
            'A poster must be a real <img>/<picture> element, never a CSS background-image: this assignment sets one. If this is prose about the property rather than a live style, move it into a comment. See e2e/poster.spec.ts.'
        },
        {
          selector:
            'Literal[value=/background-image/], TemplateElement[value.raw=/background-image/]',
          message:
            'A poster must be a real <img>/<picture> element, never a CSS background-image: this string/template text contains one. If this is prose about the property rather than CSS text, move it into a comment. See e2e/poster.spec.ts.'
        }
      ]
    }
  }
);
