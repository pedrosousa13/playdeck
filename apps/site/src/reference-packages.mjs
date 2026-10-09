/*
 * Which packages get a reference page, and what the pages say about them.
 *
 * The set is not a list kept here. It is `scripts/workspace-packages.mjs`'s
 * answer, imported rather than restated: that module is the one definition of
 * "publishable" in this repository -- a workspace project whose manifest does
 * not set `private` -- and the packaging harness and the audit gate already
 * share it so they cannot disagree about what ships. A site that decided the
 * question again would be a third opinion, and the failure would be silent: a
 * package published with no page, or a page for something that never left the
 * workspace. Discovery is `pnpm list -r`, so a package added tomorrow is
 * covered without anyone remembering this file exists.
 *
 * Deliberately NOT a directory listing of `packages/`. The audit gate's own
 * notes make the point that publishable is a property of the manifest and never
 * of where a package sits, and a private package under `packages/` is a shape
 * this repository has had before.
 *
 * The one publishable package left out is `@playdeck/docs`, through
 * `codePackages`: it ships these pages' own markdown and no README, so a
 * reference page for it would be a page about the pages.
 *
 * This is `.mjs` rather than `.ts`, and that is about what `tsc` can follow
 * from this project rather than a preference. It reaches two things the site's
 * `tsconfig.json` deliberately cannot see: a `.mjs` module belonging to the
 * `scripts` project, and `astro:content`, whose declarations are generated into
 * the `.astro/` directory that project leaves out. Nothing type-checks it as a
 * result — there is no `astro check` in this repository — so what stands behind
 * it is `astro build`, which runs this module for real on every build; see the
 * note in `apps/site/tsconfig.json`.
 */

import { readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { codePackages } from '../../../scripts/workspace-packages.mjs';

/**
 * A package with a reference page: what it is called, what the route is spelt
 * with, and the README entry the page renders.
 *
 * @typedef {{ dir: string; name: string; version: string; description: string; entry: import('astro:content').CollectionEntry<'reference'> }} ReferencePackage
 */

/**
 * Alphabetical by package name, which is the order `pnpm list -r` already
 * returns and is restated here so it survives a change of listing order.
 *
 * The ordering is derived rather than chosen, which is the point: an order that
 * put the two entry points first would read better and would be a decision
 * somebody has to remember to revisit the next time a package is added. These
 * are scoped names that share a prefix and differ at the end, so alphabetical
 * costs a reader very little.
 *
 * @returns {Promise<ReferencePackage[]>}
 */
export const referencePackages = async () => {
  // Imported here rather than at the top, so that `scripts/docs-package.mjs`
  // can load this module's other exports under plain Node, where the virtual
  // module does not exist.
  const { getCollection } = await import('astro:content');
  const readmes = new Map(
    (await getCollection('reference')).map((entry) => [entry.id, entry])
  );

  return codePackages(import.meta.env.PLAYDECK_REPO_ROOT)
    .map((pkg) => {
      const dir = basename(pkg.path);
      const entry = readmes.get(dir);
      if (entry === undefined) {
        // A publishable package with no README to render is a build failure and
        // not an empty page, because the two ways to arrive here both need a
        // decision: a package published without the document that ships inside
        // its own tarball, or a publishable package outside `packages/`, which
        // the collection in `src/content.config.ts` does not look at. Either
        // way the reader of this error is the person who introduced it.
        throw new Error(
          `${pkg.name} is publishable but has no README in the reference collection (looked for the entry '${dir}'). Add one at ${pkg.path}/README.md, or widen the loader in src/content.config.ts if the package sits outside packages/.`
        );
      }
      const manifest = JSON.parse(
        readFileSync(join(pkg.path, 'package.json'), 'utf8')
      );
      return {
        dir,
        name: pkg.name,
        version: pkg.version,
        // The manifest's own sentence, which is the one npm shows beside the
        // package. Writing a summary here instead would be the second copy this
        // whole ticket exists to avoid, at a smaller scale.
        description: manifest.description,
        entry
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
};

/**
 * Just the directory names, for a caller that has to answer "does this package
 * have a reference page?" without a rendered collection to consult:
 * `src/content.config.ts` needs the set while it is still loading the READMEs
 * the function above reads back, so it cannot ask that one. Same rule and same
 * source -- publishable, from `scripts/workspace-packages.mjs` -- which is what
 * keeps the two answers from being two answers.
 *
 * @param {string} repoRoot
 * @returns {string[]}
 */
export const referencePackageDirs = (repoRoot) =>
  codePackages(repoRoot).map((pkg) => basename(pkg.path));

/**
 * The address of a package's reference page on this site, with an optional
 * `#fragment`. Through `import.meta.env.BASE_URL`, which is what Astro fills
 * the configured `base` into, and never as a literal `/reference/` (#435).
 *
 * The document modules that link a package to its reference page take this
 * as a default they can be handed something else in place of:
 * `scripts/docs-package.mjs` passes the relative `.md` link the docs contract
 * asks for, and runs under plain Node, where `import.meta.env` does not exist
 * and so this is never called.
 *
 * @param {string} dir
 * @param {string} [fragment]
 * @returns {string}
 */
export const siteReferenceHref = (dir, fragment = '') =>
  `${import.meta.env.BASE_URL}reference/${dir}/${fragment}`;
