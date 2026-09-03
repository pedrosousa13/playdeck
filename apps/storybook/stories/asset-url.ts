/**
 * Resolves a fixture served from this app's `staticDirs`
 * (`apps/storybook/public`) against the path the workbench itself is served
 * from.
 *
 * That path is `/` on `storybook dev` and under the Vitest browser run, so
 * every caller below produces exactly the root-absolute URL it would have
 * carried as a literal. Under any other prefix a literal `/tracer.mp4` resolves
 * outside the workbench, where no fixture is served, and 404s — which is why
 * the resolver is here rather than the literal (#435). `pnpm
 * test:story-fixtures` fails on a story that writes such a literal for a file
 * that exists under `public/`; `README.md`'s "Base path" section carries that
 * and the build-and-serve pair that shows the 404 itself.
 *
 * `import.meta.env.BASE_URL` is Vite's name for that prefix, and it always ends
 * in a slash. `.storybook/main.ts` is where it is set.
 */
export const assetUrl = (path: string): string =>
  `${import.meta.env.BASE_URL}${path}`;
