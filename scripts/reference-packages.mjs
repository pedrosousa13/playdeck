/*
 * Which packages get a reference page in `@playdeck/docs`, and the link to one.
 *
 * `referencePackageDirs` is `scripts/workspace-packages.mjs`'s answer,
 * restated as directory names rather than a list kept here: that module is
 * the one definition of "publishable" in this repository -- a workspace
 * project whose manifest does not set `private` -- and the packaging harness
 * and the audit gate already share it so they cannot disagree about what
 * ships. Deciding the question again here would be a third opinion, and the
 * failure would be silent: a package published with no page, or a page for
 * something that never left the workspace.
 *
 * Deliberately NOT a directory listing of `packages/`. The audit gate's own
 * notes make the point that publishable is a property of the manifest and
 * never of where a package sits, and a private package under `packages/` is a
 * shape this repository has had before.
 *
 * The one publishable package left out is `@playdeck/docs` itself, through
 * `codePackages`: it ships these pages' own markdown and no README, so a
 * reference page for it would be a page about the pages.
 */

import { basename } from 'node:path';
import { codePackages } from './workspace-packages.mjs';

/**
 * Just the directory names, for a caller that has to answer "does this
 * package have a reference page?" without rendering one.
 *
 * @param {string} repoRoot
 * @returns {string[]}
 */
export const referencePackageDirs = (repoRoot) =>
  codePackages(repoRoot).map((pkg) => basename(pkg.path));

/**
 * The address of a package's reference page, with an optional `#fragment`.
 * `scripts/docs-package.mjs` passes its own relative `.md` link instead of
 * calling this, since the document modules below take it as a default they
 * can be handed something else in place of -- this one is never reached from
 * there, and is kept for the signature's own documentation value.
 *
 * @param {string} dir
 * @param {string} [fragment]
 * @returns {string}
 */
export const siteReferenceHref = (dir, fragment = '') =>
  `/reference/${dir}/${fragment}`;
