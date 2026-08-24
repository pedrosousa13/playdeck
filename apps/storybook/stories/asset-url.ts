/**
 * Resolves a fixture served from this app's `staticDirs`
 * (`apps/storybook/public`) against the path the workbench itself is served
 * from.
 *
 * That path is `/` on `storybook dev` and under the Vitest browser run, so
 * every caller below produces exactly the root-absolute URL it used to carry.
 * On the hosted build it is `/playdeck/`, because a GitHub Pages project site
 * is never served from the domain root — and there a literal `/tracer.mp4`
 * resolves to another site's root and 404s (#435).
 *
 * `import.meta.env.BASE_URL` is Vite's name for that prefix, and it always ends
 * in a slash. `.storybook/main.ts` is where it is set.
 */
export const assetUrl = (path: string): string =>
  `${import.meta.env.BASE_URL}${path}`;
