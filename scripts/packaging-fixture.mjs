// The two rules that keep the packaging fixture's install governed. See #336.
//
// `scripts/verify-packaging.mjs` installs the packed tarballs into a fixture it
// copies to an OS temp directory, because the tarball paths are per-run and the
// fixture must not be a workspace member. Outside the repository the root
// `pnpm-workspace.yaml` no longer applies, and until #336 that made this the
// one install in the pipeline with no lockfile, no release cooldown and no
// advisory floor behind it -- followed immediately by `pnpm run build`, which
// executes what it resolved.

import { parse, parseDocument } from 'yaml';

/**
 * The synthesised `pnpm-workspace.yaml` for the temp fixture: the root file
 * itself, with the member globs dropped and the `@playdeck/*` tarball
 * overrides added.
 *
 * Derived from the root document rather than assembled from a list of settings
 * this file knows about, and that is the point: an advisory floor, a cooldown
 * exclusion or a setting that does not exist yet all travel without anyone
 * editing this function. Dropping `packages` is the only edit -- the globs name
 * directories that do not exist in the temp copy.
 *
 * @param {string} rootWorkspaceYaml the repository's `pnpm-workspace.yaml`
 * @param {Readonly<Record<string, string>>} tarballSpecs package name -> `file:` spec
 */
export const fixtureWorkspaceYaml = (rootWorkspaceYaml, tarballSpecs) => {
  const document = parseDocument(rootWorkspaceYaml);
  document.delete('packages');
  // Packages depend on each other by workspace name (e.g. @playdeck/react
  // depends on @playdeck/core). `pnpm pack` rewrites those to plain semver
  // ranges, which don't exist on the real registry. Force every internal
  // dependency, however deep, to resolve to the tarball being tested.
  for (const [name, spec] of Object.entries(tarballSpecs)) {
    document.setIn(['overrides', name], spec);
  }
  return String(document);
};

/**
 * The `packages:` keys of a pnpm lockfile, each `<name>@<version>`. The name
 * may itself contain an `@`, so the split is at the last one.
 *
 * @param {string} lockfile
 */
const packageKeys = (lockfile) =>
  Object.keys(parse(lockfile)?.packages ?? {}).map((key) => {
    const separator = key.lastIndexOf('@');
    return {
      key,
      name: key.slice(0, separator),
      version: key.slice(separator + 1)
    };
  });

/**
 * Every package the fixture install resolved to a version the committed
 * lockfile does not carry, for a name that lockfile does pin.
 *
 * The fixture install cannot be `--frozen-lockfile`: the `@playdeck/*` specs
 * are `file:` paths into a per-run temp directory and carry the version under
 * test, so they change on every run and on every version bump, and no
 * committed lockfile can ever satisfy them exactly. `--no-frozen-lockfile`
 * does replay the locked resolutions for everything else -- established by
 * running it against a lockfile pinning `nanoid@3.3.17` with `3.3.18`
 * published and in range, which stayed at 3.3.17, and against a dead registry,
 * which it did not need to reach. This function is what keeps that true: a
 * pnpm release that stopped replaying would otherwise leave a gate that reads
 * as pinned and silently re-resolves, which is worse than the honest state
 * #336 started from.
 *
 * Names the committed lockfile does not pin at all are not reported. Those are
 * what the packed tarballs drag in -- `hls.js` and `@vimeo/player`, exact-pinned
 * in the packages' own manifests, plus their transitive closure -- and they
 * cannot be in a lockfile generated without the tarballs. They resolve under
 * the cooldown and the advisory floors the synthesised workspace file carries,
 * which is the residual gap this leaves and the reason it is named here.
 *
 * @param {string} committedLockfile `tests/packaging/fixture/pnpm-lock.yaml`
 * @param {string} resultLockfile the lockfile the fixture install wrote
 */
export const reresolvedPackages = (committedLockfile, resultLockfile) => {
  const committed = packageKeys(committedLockfile);
  if (committed.length === 0) {
    throw new Error(
      'The committed lockfile has no `packages:` in it, so nothing the fixture installed can be checked against it.'
    );
  }

  /** @type {Map<string, Set<string>>} */
  const locked = new Map();
  for (const { name, version } of committed) {
    const versions = locked.get(name) ?? new Set();
    versions.add(version);
    locked.set(name, versions);
  }

  return packageKeys(resultLockfile)
    .filter(({ name, version }) => locked.get(name)?.has(version) === false)
    .map(({ key }) => key)
    .sort();
};
