// Composes the one deployed artifact out of the one build behind it: the Astro
// site, at the root of `playdeck.video` and alone in it. Until #534 the
// Storybook workbench was copied in under `storybook/` as well; it is a
// development tool for this repository now and nothing publishes it. The
// directory this writes is what `wrangler.jsonc` publishes as its assets, so
// what lands here is the URL space of the domain.
//
// A script rather than a `cp` line inline in
// `.github/workflows/deploy-site.yml`, because the verification harness
// assembles the same artifact in order to prove it loads where it is served
// from. Two copies of the composition would drift, and the drift would be
// silent: the harness would go green against a shape the deploy no longer
// produces. One caller cannot disagree with the other about what ships.

import { cp, mkdir, rm, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

// As in scripts/verify-packaging.mjs: the lint config gives this directory node
// globals, but `console` and `process` still have to be reached through
// globalThis.
const console = globalThis.console;
const process = globalThis.process;

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// The build the artifact is made of, and the whole of it.
const siteBuild = join(repoRoot, 'apps/site/dist');

/**
 * @param {string} destination Where to assemble the artifact.
 */
export const assembleDeploy = async (destination) => {
  // Loudly, and before anything is copied: a missing source means the build did
  // not run, and an empty artifact deployed is worse than a red run.
  const built = await stat(siteBuild).catch(() => null);
  if (!built?.isDirectory()) {
    throw new Error(`Build output is missing: ${siteBuild}. Build it first.`);
  }

  // A stale destination would leave files from an earlier run in the artifact,
  // which is how a page nobody builds any more stays published.
  await rm(destination, { recursive: true, force: true });
  await mkdir(destination, { recursive: true });

  await cp(siteBuild, destination, { recursive: true });
};

// Only when run as a command. `scripts/check-deploy-artifact.mjs` imports the
// function above so the harness and the deploy cannot disagree about what the
// artifact holds, and an import must not assemble anything as a side effect
// (#519).
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const destination = resolve(process.argv[2] ?? join(repoRoot, 'deploy-dist'));
  await assembleDeploy(destination);
  console.log(`Assembled the deployed artifact at ${destination}`);
}
