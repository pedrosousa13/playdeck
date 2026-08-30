// Composes the one deployed artifact out of the two builds behind it: the Astro
// site at the root, the Storybook workbench under `storybook/` (#519). The
// directory this writes is what `wrangler.jsonc` publishes as its assets, so
// the layout below is the URL space of `playdeck.video`.
//
// A script rather than a few `cp` lines inline in
// `.github/workflows/deploy-site.yml`, because the verification harness
// assembles the same artifact in order to prove both surfaces load under the
// prefixes they are served from. Two copies of the layout would drift, and the
// drift would be silent: the harness would go green against a shape the deploy
// no longer produces. One caller cannot disagree with the other about where
// Storybook lands.

import { cp, mkdir, rm, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

// As in scripts/verify-packaging.mjs: the lint config gives this directory node
// globals, but `console` and `process` still have to be reached through
// globalThis.
const console = globalThis.console;
const process = globalThis.process;

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Every source directory, and where it lands inside the artifact.
 *
 * Exported for `scripts/check-site-links.mjs`, which checks the built site on
 * every pull request and therefore has to know which addresses are answered by
 * a surface that is not in `apps/site/dist`. Reading this list is what makes
 * that check derive the exemption instead of hard-coding a prefix: rename `to`
 * here and the link check fails on the link that no longer has a mount, rather
 * than going on skipping a string nothing produces any more.
 */
export const layout = [
  { from: join(repoRoot, 'apps/site/dist'), to: '.' },
  { from: join(repoRoot, 'apps/storybook/storybook-static'), to: 'storybook' }
];

/**
 * @param {string} destination Where to assemble the artifact.
 */
export const assembleDeploy = async (destination) => {
  for (const { from } of layout) {
    // Loudly, and before anything is copied: a missing source means a build
    // did not run, and half an artifact deployed is worse than a red run.
    const built = await stat(from).catch(() => null);
    if (!built?.isDirectory()) {
      throw new Error(`Build output is missing: ${from}. Build it first.`);
    }
  }

  // A stale destination would leave files from an earlier run in the artifact,
  // which is how a page nobody builds any more stays published.
  await rm(destination, { recursive: true, force: true });
  await mkdir(destination, { recursive: true });

  for (const { from, to } of layout) {
    await cp(from, join(destination, to), { recursive: true });
  }
};

// Only when run as a command. `scripts/check-deploy-artifact.mjs` imports the
// function above so the harness and the deploy cannot disagree about the
// layout, and an import must not assemble anything as a side effect (#519).
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const destination = resolve(process.argv[2] ?? join(repoRoot, 'deploy-dist'));
  await assembleDeploy(destination);
  console.log(`Assembled the deployed artifact at ${destination}`);
}
