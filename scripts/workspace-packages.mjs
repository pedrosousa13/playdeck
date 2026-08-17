// The one definition of "publishable" in this repo: a workspace project whose
// package.json does not set `private`. Both gates that need the boundary --
// the packaging harness (scripts/verify-packaging.mjs) and the audit gate
// (scripts/audit.mjs) -- import it from here, so they cannot drift apart on
// what does and does not ship.
//
// Discovery comes from `pnpm list -r`, never from a hardcoded list, so a new
// workspace package is covered the moment it exists.

import { execFileSync } from 'node:child_process';

/**
 * A project entry from `pnpm list -r --depth -1 --json`. The workspace root
 * and other private projects carry no `version`.
 * @typedef {{ name: string; version?: string; path: string; private: boolean }} WorkspaceProject
 * @typedef {WorkspaceProject & { version: string }} PublishablePackage
 */

/**
 * @param {readonly WorkspaceProject[]} listing
 * @returns {PublishablePackage[]}
 */
export const selectPublishable = (listing) => {
  // A package npm will accept always has a version, so narrowing here is safe.
  const packages = /** @type {PublishablePackage[]} */ (
    listing.filter((entry) => entry.private === false)
  );
  if (packages.length === 0) {
    throw new Error('No publishable workspace packages were discovered.');
  }
  return packages;
};

/**
 * @param {string} repoRoot
 * @returns {WorkspaceProject[]}
 */
export const workspaceProjects = (repoRoot) =>
  JSON.parse(
    execFileSync('pnpm', ['list', '-r', '--depth', '-1', '--json'], {
      cwd: repoRoot,
      encoding: 'utf8'
    })
  );

/** @param {string} repoRoot */
export const publishablePackages = (repoRoot) =>
  selectPublishable(workspaceProjects(repoRoot));
