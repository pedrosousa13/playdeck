// The rule that a package built on React declares its own client boundary, and
// the one place the directive that declares it is written down. #500 is the
// record of why: @playdeck/react is hooks, context and refs end to end, and a
// bundler resolving it into a server graph has nothing to learn that from
// unless the module says so. What such a bundler reports instead names a React
// API inside the package's own built entry, which for an installed consumer is
// a file under `node_modules` that they cannot edit.
//
// The judgement is separated from the IO for the reason
// scripts/shipped-changelog.mjs separates them. The near misses that matter --
// a directive that is not the leading statement, a directive sitting behind a
// comment, a package the rule must not reach at all -- are decided here and
// tested directly, while the caller supplies the bytes. Both gates that need
// the rule call it: scripts/verify-packaging.mjs, which reads it out of a
// packed tarball, and scripts/client-boundary.test.mjs.
//
// Which packages it reaches is read off the manifest rather than off a list of
// names. A package that names `react` in `peerDependencies` builds on React and
// owes the directive; one that does not is framework-neutral, and a directive
// there would push its code across a boundary it has no reason to cross and
// stop server code calling it at all.

/**
 * The fields of a package.json this reads, each narrowed at the point it is
 * used: a manifest that has one of them wrong is the case this reports on.
 * @typedef {{ peerDependencies?: Record<string, unknown>; exports?: Record<string, unknown> }} BoundaryManifest
 */

// A directive is a leading string expression statement, so comments and blank
// lines may precede it and nothing else may. Anchored rather than searched: a
// `'use client'` further down a bundle is an ordinary string expression, and a
// rule that accepted one would pass a chunk where the directive had been
// demoted out of the prologue -- which is the failure this exists to catch,
// because a demoted directive is inert and looks identical to a grep.
//
// The block-comment branch is spelled out rather than written `\/\*[\s\S]*?\*\/`
// so that each character has exactly one way to be consumed. A lazy any-character
// run nested inside the outer repetition can be split between the two in many
// ways, and on input that never matches -- a chunk opening with comments and no
// directive, which is precisely the failure case -- the engine tries all of them.
// Measured before the rewrite, each added comment multiplied the time to report:
// sixteen took 3ms and twenty-four took 201ms. A gate that hangs rather than
// reports is worse than one that never ran.
const CLIENT_DIRECTIVE =
  /^(?:\s|\/\/[^\n]*|\/\*[^*]*\*+(?:[^/*][^*]*\*+)*\/)*(['"])use client\1\s*;?/;

/**
 * What is wrong with the client boundary a package declares, as phrases that
 * read after a package name -- the voice `tarballProblems` in
 * scripts/verify-packaging.mjs already reports in.
 *
 * The file read is the one the `import` condition of the `.` entry points at,
 * rather than a path assembled here, because that is the file a consumer's
 * bundler resolves. An `exports` map moved somewhere the build does not write,
 * and a `files` field that stopped shipping the built entry, both land on the
 * missing-entry branch rather than on a directive that is quietly never read.
 * @param {unknown} manifest a parsed package.json
 * @param {(entry: string) => string | undefined} read the package's own files
 * @returns {string[]}
 */
export const clientBoundaryProblems = (manifest, read) => {
  const { exports, peerDependencies } = /** @type {BoundaryManifest} */ (
    manifest
  );
  if (peerDependencies?.react === undefined) return [];

  /**
   * @param {unknown} value
   * @param {string} key
   */
  const at = (value, key) =>
    value !== null && typeof value === 'object'
      ? /** @type {Record<string, unknown>} */ (value)[key]
      : undefined;

  const specifier = at(at(at(exports, '.'), 'import'), 'default');
  if (typeof specifier !== 'string') {
    return [
      'names react as a peer dependency, and its exports "." has no import entry for the directive to sit on'
    ];
  }

  const path = specifier.replace(/^\.\//, '');
  const source = read(path);
  if (source === undefined) {
    return [
      `names react as a peer dependency, and its import entry ${specifier} is not in the tarball`
    ];
  }

  return CLIENT_DIRECTIVE.test(source)
    ? []
    : [
        `names react as a peer dependency, and ${path} does not open with a 'use client' directive, so a React Server Component importing this package fails to build`
      ];
};
