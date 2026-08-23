#!/usr/bin/env node
// The dependency audit gate.
//
// Severity is a label, not the axis. A `high` in a linting toolchain never
// reaches a consumer; a `low` under a published package's `dependencies`
// does. Gating on severity therefore fails loudest on the code that never
// ships and waves through the code that does, so this gate fails whenever an
// advisory is reachable from a non-private workspace package's
// `dependencies` -- at any severity. Everything else is printed, labelled
// "not shipped", and left alone, whatever its severity.
//
// Two things besides an advisory fail it, and both are settings in
// `pnpm-workspace.yaml` rather than anything pnpm reported. The first is an
// `overrides` entry whose package name lands inside a publishable
// package's dependency closure. The two inputs the gate joins are both
// produced by running pnpm at the repository root, so both are computed under
// that block: `pnpm list --prod` reports the floored version, and `pnpm audit`
// is never asked about the version it replaced, so it returns no advisory for
// it and the join below finds nothing. But an override is a workspace-local
// resolution instruction and is written into no published package.json, so it
// does not travel to a consumer: the version that consumer resolves is the
// un-floored one, and nothing here has looked at it. Whatever an override
// changes -- another version brings its own dependencies, and an `npm:`,
// `file:` or `link:` value replaces the package outright -- it changes at or
// beneath the name the entry selects, and pnpm reports the dependency under
// that entry's own name whichever form the value takes. So a closure an
// override touched always contains the name it selects: where no such name
// appears the graph measured here is the graph a consumer resolves and the
// reachability above is sound, and where one does appear it is not, and this
// gate says so rather than reporting a clean tree.
//
// The second is an `auditConfig` entry, which is not a narrowing of the gate
// but a hole underneath it. pnpm applies `ignoreGhsas` and `ignoreCves` while
// it builds the report, so a suppressed advisory never reaches this file to be
// classified: what arrives is a clean report, indistinguishable from the one a
// genuinely clean tree produces. Reachability cannot be measured for something
// the gate was not shown, so it reports the entry and fails rather than passing
// off the remainder as the whole. See workspaceSuppressions.
//
// The third is not a workspace setting but the boundary itself. Reachability
// is measured from the publishable packages, and which packages those are is
// declared in manifests this pull request owns: adding `private: true` to a
// shipped package's package.json, or dropping a glob from
// `pnpm-workspace.yaml`'s `packages:` list, takes it out of the boundary and
// reclassifies every advisory reachable only through it from shipped to not
// shipped -- with the dependency tree untouched. Pinning the gate's source to
// `main` (#337) does not reach it, because both copies compute the boundary
// from this tree and so agree on the narrowed one: it is a change to the
// gate's input, not to its logic. So the boundary is compared against `main`'s
// own, computed by this same definition of publishable from `main`'s
// manifests, and a package that left it fails the gate by name. See
// departedPackages and gather.
//
// `pnpm audit --prod` is not the same boundary and is not used: a private
// integration fixture in this workspace declares its framework under
// `dependencies`, so a workspace-root production audit counts a test
// fixture's build as production. Reachability is computed per publishable
// package instead, from `pnpm list --prod` run against each one.
//
// Coverage is unchanged from the severity gate it replaces: `pnpm audit`
// still runs once, unfiltered, over every workspace importer, and every
// advisory it returns is printed.
//
// Fails closed. `pnpm audit` exits non-zero both when it found something and
// when it could not reach the registry, and on an outage it prints an `error`
// object instead of a report -- which, taken at face value, reads as a clean
// tree. parseAuditOutput refuses anything that is not a report.

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath, URL } from 'node:url';
import { parse } from 'yaml';
import {
  publishableBaseline,
  selectPublishable,
  workspaceProjects
} from './workspace-packages.mjs';

const console = globalThis.console;
const process = globalThis.process;
const repoRoot = fileURLToPath(new URL('..', import.meta.url));

/**
 * @typedef {import('./workspace-packages.mjs').WorkspaceProject} WorkspaceProject
 * @typedef {import('./workspace-packages.mjs').PublishablePackage} PublishablePackage
 *
 * A finding from `pnpm audit --json`: one resolved version of the vulnerable
 * module, and the dependency paths that reach it. Each path starts with the
 * importer it belongs to.
 * @typedef {{ version: string; paths: string[]; dev: boolean; optional: boolean }} AuditFinding
 * @typedef {{ id: number; title: string; module_name: string; severity: string; github_advisory_id: string; url: string; findings: AuditFinding[] }} AuditAdvisory
 * @typedef {{ vulnerabilities: Record<string, number>; totalDependencies: number }} AuditMetadata
 * @typedef {{ advisories: Record<string, AuditAdvisory>; metadata: AuditMetadata; error?: { code: string; message: string } }} AuditReport
 *
 * A node of `pnpm list --prod --json`. A workspace link carries the version
 * `link:<relative path>`. `from` is the name of the package actually
 * installed, which is the key's own name except under an npm alias. A node
 * pnpm has already printed in full elsewhere is marked `deduped` and carries no
 * `dependencies`. `path` is the directory the package was installed in, and is
 * how a deduped node is joined back to the one carrying its subtree (#377).
 * @typedef {{ version: string; from?: string; path?: string; deduped?: boolean; dedupedDependenciesCount?: number; dependencies?: Record<string, DependencyNode> }} DependencyNode
 * @typedef {{ name: string; path?: string; dependencies?: Record<string, DependencyNode> }} ProjectTree
 *
 * The three captured pnpm outputs the gate reads, plus the one thing gather()
 * derives from them -- which package boundary reachability is drawn around --
 * and the `overrides` block gather() reads from `pnpm-workspace.yaml`, keyed by
 * pnpm selector.
 *
 * `baseline` is that same boundary computed from `main`'s manifests, or null
 * when there is none to compare against. Null is the developer's path and only
 * the developer's path; CI always supplies one. See gather.
 * @typedef {{ workspace: WorkspaceProject[]; publishable: PublishablePackage[]; baseline: PublishablePackage[] | null; prodTrees: ProjectTree[]; audit: AuditReport; overrides: Readonly<Record<string, string>>; suppressions: AuditSuppression[] }} AuditInputs
 * @typedef {{ severity: string; module: string; advisoryId: string; title: string; url: string; shipped: boolean; reachableFrom: string[]; paths: string[] }} ClassifiedAdvisory
 *
 * One `name@version` in a publishable package's closure whose name an override
 * floors. A workspace link counts, so the version may read `link:<path>`.
 * @typedef {{ module: string; reachableFrom: string[] }} FlooredModule
 *
 * One `auditConfig` entry, as the key it was written under and the identifiers
 * it carries.
 * @typedef {{ key: string; identifiers: string[] }} AuditSuppression
 */

// Report order only. The gate does not read it.
const SEVERITY_ORDER = ['critical', 'high', 'moderate', 'low', 'info'];

/**
 * Every subtree `pnpm list` printed, keyed by the directory the node carrying
 * it was installed in.
 *
 * pnpm prints a physical package's subtree once. Every later occurrence of it
 * anywhere in the output -- in the same tree or in another one -- is marked
 * `deduped` and carries no `dependencies` at all, only a
 * `dedupedDependenciesCount`. So a walk that reads `dependencies` alone has
 * nothing to descend into and loses the whole closure beneath that node for
 * whichever package met it, and `--depth Infinity` does not prevent it (#377).
 * This index is what the walk joins a deduped node back to.
 *
 * Keyed on `path` rather than on `resolved`, for two reasons. `path` is the one
 * field every deduped node carries: two of the three this repository's trees
 * produce are workspace links, and a link node has a `path` -- the linked
 * directory -- and no `resolved` at all, so a join on `resolved` alone would
 * silently skip exactly the nodes a link's closure hangs under. And `path` is
 * the finer identity of the two even where both are present: it is pnpm's
 * virtual-store directory, which carries the peer-dependency suffix, so two
 * peer variants of one version -- same tarball, same `resolved`, different
 * resolved dependencies -- are two paths and one `resolved`. Joining on
 * `resolved` would hand a node the other variant's subtree.
 *
 * That second reason is forward-looking where the first is measured, and the
 * two should not be read in one breath. It is a property of how pnpm names the
 * virtual store, not something these trees exhibit: the publishable packages'
 * prod trees hold zero peer-suffixed paths as the graph resolves today. The
 * store does carry them: the directory
 * `typescript-eslint@8.65.0_eslint@10.7.0_typescript@6.0.3` exists, but as a
 * devDependency, which this gate never walks. So the key is chosen to survive
 * the first peer-suffixed path that reaches a publishable closure, not to fix
 * one already there.
 *
 * The project roots are indexed alongside the nodes beneath them, because a
 * deduped node naming a workspace package may have its only full copy at the
 * root of that package's own tree rather than nested in another's.
 *
 * A node with no `dependencies` offers no subtree and is not indexed, which
 * covers every deduped node: pnpm omits the key outright on one. So what wins
 * is the first occurrence carrying `dependencies` rather than the first
 * occurrence -- one without them is skipped before the index is written -- and
 * that is the copy pnpm printed in full.
 * @param {readonly ProjectTree[]} prodTrees
 * @returns {Map<string, Record<string, DependencyNode>>}
 */
const printedSubtrees = (prodTrees) => {
  /** @type {Map<string, Record<string, DependencyNode>>} */
  const subtrees = new Map();

  /** @param {ProjectTree | DependencyNode} node */
  const index = (node) => {
    if (!node.dependencies) return;
    if (node.path !== undefined && !subtrees.has(node.path))
      subtrees.set(node.path, node.dependencies);
    for (const child of Object.values(node.dependencies)) index(child);
  };

  for (const project of prodTrees) index(project);
  return subtrees;
};

/**
 * Every `name@version` in the transitive `dependencies` closure of each
 * publishable package, mapped to the packages it is reachable from.
 *
 * The name is the installed package's, taken from `from`, not the key it is
 * installed under. Those are the same string until an npm alias separates
 * them: `"foo": "npm:bar@1.0.0"` installs `bar` and pnpm reports it under
 * `foo`, carrying `bar` in `from`. This map exists to be joined to
 * `pnpm audit`'s `module_name`, which names the package the advisory is
 * against, so `bar` is the only side of that pair an advisory can ever meet --
 * keyed under `foo` the entry is unreachable by construction, and the advisory
 * against a package a publishable one really does ship reads as `not shipped`.
 *
 * Keyed on the installed name alone rather than on both names, because the
 * alias key is not merely useless to the join, it is wrong for it. Aliasing
 * away from a vulnerable package to a patched fork -- `"cookie":
 * "npm:safe-cookie@1.0.0"` -- leaves the vulnerable name as the key over a
 * package that is not it, and an advisory against `cookie@1.0.0` would join to
 * it and report a module the closure does not contain.
 *
 * `from` is absent on no node pnpm 11.20.0 reports, at any depth and for every
 * shape the walk meets -- a workspace link, a deduped node, a scoped package.
 * The fallback to the key is for a pnpm that stops emitting it: the join is
 * then no worse than it was before this, rather than throwing or dropping the
 * closure.
 *
 * A node pnpm marked `deduped` carries no `dependencies`, so its subtree is
 * taken from `printedSubtrees` and walked as though it had been printed here
 * (#377). Without that the closure stops at the deduped node and everything
 * beneath it goes unrecorded for that owner.
 *
 * What that costs is attribution and only attribution: the `reachable from:`
 * line an operator reads to decide what to do about an advisory named fewer
 * packages than actually reach the module. The `shipped` boolean was correct
 * throughout, and why is worth stating here, because it is the non-obvious part
 * and because the scarier claim -- that a module could read `not shipped` -- is
 * what a later reader will otherwise put back. gather() filters `pnpm list` to
 * every publishable package, so every root of `prodTrees` is publishable. A
 * node marked `deduped` is one pnpm printed in full elsewhere in that same
 * output, and a deduped node carries no `dependencies` and so has no printed
 * descendants -- which puts that full copy under a chain of ordinary nodes
 * hanging off one of those publishable roots, a chain the walk descended even
 * before this. The map is a union over owners, so every module was already
 * recorded against at least one publishable package and `shipped` was never
 * wrongly `false`. Measured over this repository's trees: the splice gains zero
 * module keys and two owner entries.
 *
 * A wrong verdict needs the full copy to sit under a root that is not
 * publishable, which listing a whole workspace unfiltered can produce and this
 * gate's invocation cannot.
 * @param {readonly ProjectTree[]} prodTrees
 * @returns {Map<string, string[]>}
 */
export const shippedVersions = (prodTrees) => {
  /** @type {Map<string, string[]>} */
  const shipped = new Map();
  const subtrees = printedSubtrees(prodTrees);

  /**
   * @param {Record<string, DependencyNode> | undefined} dependencies
   * @param {string} owner
   * @param {Set<string>} descended Paths this owner's walk is already inside or
   *   past. Splicing makes a repeat possible, so this is what bounds the work.
   */
  const walk = (dependencies, owner, descended) => {
    for (const [name, node] of Object.entries(dependencies ?? {})) {
      // A workspace link is not a registry package and can carry no advisory
      // of its own. What it pulls in transitively is what matters, so keep
      // walking through it -- a deduped link included, which is why the splice
      // below is not conditional on the node being recorded here.
      if (!node.version.startsWith('link:')) {
        const module = `${node.from ?? name}@${node.version}`;
        const owners = shipped.get(module) ?? [];
        if (!owners.includes(owner)) owners.push(owner);
        shipped.set(module, owners);
      }
      // Recording happens above whatever this decides, so a path met twice is
      // still recorded on both visits -- only the descent is skipped. Keyed on
      // `path`, the physical package's identity and the same key the splice
      // joins on: two nodes at one path have one subtree, so a second descent
      // can record nothing the first did not. Per owner rather than shared,
      // because the map this builds is per-owner attribution and a shared set
      // would let whichever package reached a subtree first take it from the
      // rest.
      //
      // Every route back into a subtree the walk is already inside runs through
      // a deduped node, and a deduped node is joined by `path`, so this bounds
      // the walk at one descent per distinct path per owner. A node with no
      // `path` cannot be joined and so cannot be spliced; what it carries is
      // the literal subtree pnpm printed, which is finite.
      if (node.path !== undefined) {
        if (descended.has(node.path)) continue;
        descended.add(node.path);
      }
      walk(
        node.dependencies ??
          (node.path === undefined ? undefined : subtrees.get(node.path)),
        owner,
        descended
      );
    }
  };

  for (const project of prodTrees)
    walk(project.dependencies, project.name, new Set());
  return shipped;
};

/**
 * The `overrides` block of a `pnpm-workspace.yaml`, keyed by pnpm selector.
 *
 * Text in, map out, so the gate's own read and the tests exercise one
 * implementation rather than two copies of it. A workspace that declares no
 * `overrides` -- and a file that is empty or all comments, which parses to
 * `null` -- yields an empty map: having nothing to intersect is the ordinary
 * answer here, not a failure.
 * @param {string} workspaceYaml
 * @returns {Readonly<Record<string, string>>}
 */
export const workspaceOverrides = (workspaceYaml) =>
  parse(workspaceYaml)?.overrides ?? {};

/**
 * Every `auditConfig` entry in a `pnpm-workspace.yaml` that carries something.
 *
 * This is the one input the gate cannot recover by looking harder at its own
 * output. `pnpm audit` applies `auditConfig` while building the report: in
 * pnpm 10.34.5 `ignoreGhsas` drops advisories by `github_advisory_id` and
 * `ignoreCves` by `cves`, both before the `--json` branch serialises anything.
 * So a suppressed advisory is not labelled in the report, it is absent from
 * it, and `parseAuditOutput` receives a clean tree indistinguishable from a
 * genuinely clean one. Reachability is computed over what is left, which makes
 * the gate's silence meaningless rather than merely narrower -- the failure
 * mode `parseAuditOutput` already refuses for a registry outage, arriving
 * through a workspace setting instead.
 *
 * Read out of the same file the `overrides` block is read from, and reported
 * the same way a floored module is: this is the second thing that voids the
 * measurement without any advisory being reachable.
 *
 * Keyed on the block rather than on the two names pnpm reads today, so a key
 * added by a later pnpm fails closed instead of passing unnoticed. Nothing is
 * lost by the breadth: `auditConfig` is a suppression-only namespace, and a
 * benign key appearing there later should be a decision taken here rather than
 * a default.
 *
 * An entry carrying nothing is not reported. An empty list suppresses no
 * advisory, so failing on one would be a false alarm, and it buys nothing as a
 * foothold either -- the pull request that adds the first identifier is the one
 * that fails. A bare string counts as an entry rather than as a mistake: pnpm
 * tests `ignoreGhsas` with `.includes`, which a string answers too.
 * @param {string} workspaceYaml
 * @returns {AuditSuppression[]}
 */
export const workspaceSuppressions = (workspaceYaml) => {
  const auditConfig = parse(workspaceYaml)?.auditConfig;
  if (typeof auditConfig !== 'object' || auditConfig === null) return [];
  return Object.entries(auditConfig)
    .map(([key, value]) => ({
      key: `auditConfig.${key}`,
      identifiers: (Array.isArray(value) ? value : [value])
        .filter((entry) => entry != null && entry !== '')
        .map(String)
    }))
    .filter((entry) => entry.identifiers.length > 0)
    .sort((a, b) => a.key.localeCompare(b.key));
};

/**
 * The packages publishable on `main` that are not publishable here.
 *
 * One direction only. A boundary that shrank is a departure and fails: what
 * left it is still on the registry, consumers still resolve it, and this gate
 * has stopped measuring it. A boundary that widened is a new package, which is
 * how a package arrives and hides nothing. Unchanged is the ordinary case and
 * says nothing at all. A package absent from `main` cannot have departed from
 * it, which falls out of comparing in this direction rather than needing a
 * rule of its own.
 *
 * Compared by name rather than by path or version: a package that moved
 * directory or changed version is the same package, still shipping under the
 * same name to the same consumers, and neither is a narrowing of the boundary.
 *
 * Both sides are `selectPublishable`'s output, so the two things a pull
 * request can change -- an entry's `private` field, and whether `pnpm list -r`
 * reports the entry at all -- both arrive here as a name that is missing from
 * `current`. Neither route needs its own case.
 * @param {readonly PublishablePackage[]} baseline
 * @param {readonly PublishablePackage[]} current
 * @returns {string[]}
 */
export const departedPackages = (baseline, current) => {
  const present = new Set(current.map((pkg) => pkg.name));
  return baseline
    .map((pkg) => pkg.name)
    .filter((name) => !present.has(name))
    .sort();
};

// Inside a range, a `>` is a semver operator, and these are the characters one
// can follow: the `@` that opens the range, whitespace, and semver's own
// operators and separators. Everywhere else a `>` ends a path segment.
const RANGE_OPERATOR_FOLLOWS = new Set([
  '@',
  ' ',
  '|',
  ',',
  '=',
  '<',
  '>',
  '~',
  '^'
]);

/**
 * The package name a pnpm override selector key floors. A key is one segment,
 * or two separated by `>` -- `parent>child` floors `child` only where `parent`
 * reaches it, and pnpm rejects a third, since the child must itself be a valid
 * package name. Each segment is a package name optionally followed by `@` and a
 * version range, and the last segment's name is the package floored. Taking the
 * last segment whatever the count is the conservative reading either way.
 *
 * Both delimiters are ambiguous, so neither can be found by splitting:
 *
 * - `@` opens a range only past the first character of a segment. At the first
 *   it opens a scope, as in `@scope/pkg`.
 * - `>` separates segments only outside a range. Inside one it is an operator,
 *   as in `postcss@>=8.5.23` -- a form that binds exactly as `<` does, and
 *   which a split on `>` would read as the segment `=8.5.23`.
 *
 * Both are decided by position, so one left-to-right scan carrying whether it
 * is inside a range settles them, and both meanings of `>` can occur in one
 * key: in `qar@1>zoo` a range closes and a segment ends after it.
 * @param {string} selector
 * @returns {string}
 */
export const flooredName = (selector) => {
  let start = 0;
  let end = selector.length;
  let inRange = false;
  for (let index = 0; index < selector.length; index++) {
    const character = selector[index];
    if (character === '@' && !inRange && index > start) {
      inRange = true;
      end = index;
    } else if (
      character === '>' &&
      !(inRange && RANGE_OPERATOR_FOLLOWS.has(selector[index - 1]))
    ) {
      start = index + 1;
      end = selector.length;
      inRange = false;
    }
  }
  return selector.slice(start, end);
};

/**
 * @param {string} stdout
 * @returns {AuditReport}
 */
export const parseAuditOutput = (stdout) => {
  /** @type {AuditReport} */
  let report;
  try {
    report = JSON.parse(stdout);
  } catch {
    throw new Error(
      `The audit report could not be read as JSON:\n${stdout.trim()}`
    );
  }
  if (report?.error) {
    throw new Error(
      `The audit did not run: ${report.error.code} ${report.error.message}`
    );
  }
  if (!report?.advisories || !report?.metadata) {
    throw new Error(
      `The audit report could not be read: it carries no advisories and no metadata.\n${stdout.trim()}`
    );
  }
  return report;
};

/**
 * @param {AuditReport} audit
 * @param {Map<string, string[]>} shipped
 * @returns {ClassifiedAdvisory[]}
 */
const classify = (audit, shipped) =>
  Object.values(audit.advisories)
    .map((advisory) => {
      /** @type {string[]} */
      const reachableFrom = [];
      for (const finding of advisory.findings) {
        for (const owner of shipped.get(
          `${advisory.module_name}@${finding.version}`
        ) ?? []) {
          if (!reachableFrom.includes(owner)) reachableFrom.push(owner);
        }
      }
      return {
        severity: advisory.severity,
        module: `${advisory.module_name}@${advisory.findings
          .map((finding) => finding.version)
          .join(', ')}`,
        advisoryId: advisory.github_advisory_id,
        title: advisory.title,
        url: advisory.url,
        shipped: reachableFrom.length > 0,
        reachableFrom,
        paths: advisory.findings.flatMap((finding) => finding.paths)
      };
    })
    .sort(
      (a, b) =>
        Number(b.shipped) - Number(a.shipped) ||
        SEVERITY_ORDER.indexOf(a.severity) -
          SEVERITY_ORDER.indexOf(b.severity) ||
        a.module.localeCompare(b.module)
    );

/**
 * Every `name@version` in a publishable package's transitive `dependencies`
 * closure whose name an override floors, with the packages it is reachable
 * from.
 *
 * This walks the trees itself rather than reading `shippedVersions`, because
 * the two are asking different questions of the same graph: that one asks
 * which resolved versions can carry an advisory, and so drops workspace links,
 * which carry none. Here a link is a hit like any other -- an override value
 * may be a `link:` spec, and the dependency it replaces then shows a `link:`
 * version under the key's own name, which is precisely a floor rewriting this
 * closure.
 *
 * Matching on the name alone catches every closure an override changed. What
 * an override does beyond flooring a version -- another version brings its own
 * dependencies, and an `npm:`, `file:` or `link:` value replaces the package
 * outright -- all lands at or beneath the name the entry selects, and pnpm
 * reports the dependency under that entry's own name whichever form the value
 * takes. So a closure an override changed at all holds the name it selects.
 *
 * That is also why this matches on the key while `shippedVersions` keys on
 * `from`: an override selects by the name the dependency is written under, and
 * an aliased value moves `from` off that name while leaving the key on it.
 *
 * Where no floored name appears, then, nothing the block could have changed is
 * in the closure: it is the one a consumer resolves, and the reachability this
 * gate reports holds. Where one does appear, both inputs the gate joins were
 * produced under that floor and neither can describe the un-floored version, so
 * the hits are reported and the gate fails.
 *
 * What remains, stated rather than hidden: this walk still has the blind spot
 * `shippedVersions` had before #377, and keeps it deliberately. It reads
 * `node.dependencies` and nothing else, so a node pnpm marked `deduped` --
 * which carries none -- stops it, and every name beneath that node goes
 * unmatched for whichever package met it. #377 is scoped to the reachability
 * closure and to changing no verdict, so the splice is not repeated here.
 *
 * The cost is the same shape as it was there, and safe for the same reason. The
 * `FLOORED ... reachable from:` line under-reports its owners. The verdict does
 * not move: every root of `prodTrees` is publishable and a deduped node has no
 * printed descendants, so the full copy of any elided subtree hangs off a
 * publishable root through ordinary nodes this walk does descend, and `hits` is
 * a union over owners -- a floored name anywhere in the printed output is a hit
 * from somebody and still fails the gate. Not inert for want of overrides,
 * either: `pnpm-workspace.yaml` declares six. None of the six names appears in
 * any publishable closure as the graph resolves today, and splicing the elided
 * subtrees in over these trees gains no `name@version` at all -- only the same
 * two owner entries #377 gained.
 * @param {Readonly<Record<string, string>>} overrides
 * @param {readonly ProjectTree[]} prodTrees
 * @returns {FlooredModule[]}
 */
const flooredModules = (overrides, prodTrees) => {
  const floored = new Set(Object.keys(overrides).map(flooredName));
  /** @type {Map<string, string[]>} */
  const hits = new Map();

  /**
   * @param {Record<string, DependencyNode> | undefined} dependencies
   * @param {string} owner
   */
  const walk = (dependencies, owner) => {
    for (const [name, node] of Object.entries(dependencies ?? {})) {
      if (floored.has(name)) {
        const owners = hits.get(`${name}@${node.version}`) ?? [];
        if (!owners.includes(owner)) owners.push(owner);
        hits.set(`${name}@${node.version}`, owners);
      }
      walk(node.dependencies, owner);
    }
  };

  for (const project of prodTrees) walk(project.dependencies, project.name);
  return [...hits]
    .map(([module, reachableFrom]) => ({ module, reachableFrom }))
    .sort((a, b) => a.module.localeCompare(b.module));
};

/**
 * @param {readonly ClassifiedAdvisory[]} advisories
 * @param {AuditMetadata} metadata
 * @param {number} importers
 * @param {readonly string[]} publishable
 * @param {readonly FlooredModule[]} floored
 * @param {readonly AuditSuppression[]} suppressions
 * @param {readonly string[]} departed
 */
const formatReport = (
  advisories,
  metadata,
  importers,
  publishable,
  floored,
  suppressions,
  departed
) => {
  const shippedCount = advisories.filter((advisory) => advisory.shipped).length;
  const lines = [
    `Audited ${metadata.totalDependencies} dependencies across ${importers} workspace importers: ${advisories.length} advisories.`,
    `Reachability is measured from the \`dependencies\` of ${publishable.length} publishable package(s): ${publishable.join(', ')}`,
    ''
  ];

  for (const advisory of advisories) {
    lines.push(
      `${advisory.shipped ? 'SHIPPED    ' : 'not shipped'}  ${advisory.severity.padEnd(8)}  ${advisory.module}  ${advisory.advisoryId}`,
      `              ${advisory.title}`,
      `              ${advisory.url}`,
      advisory.shipped
        ? `              reachable from: ${advisory.reachableFrom.join(', ')}`
        : `              reached only by: ${advisory.paths.join(', ')}`
    );
  }
  // A floored module is a finding too, and prints among them: it says the same
  // thing an advisory line says -- this is in a publishable package's closure
  // -- about a version no consumer resolves.
  for (const entry of floored) {
    lines.push(
      `FLOORED      ${entry.module}`,
      `              floored by \`overrides\` in pnpm-workspace.yaml, which does not travel to a consumer`,
      `              reachable from: ${entry.reachableFrom.join(', ')}`
    );
  }
  // A suppression is a finding about the report itself, so it prints among
  // them and says which advisories the line above it can no longer be read as
  // covering.
  for (const entry of suppressions) {
    lines.push(
      `SUPPRESSED   ${entry.key}`,
      `              ${entry.identifiers.join(', ')}`,
      `              set in pnpm-workspace.yaml, which drops these advisories from the audit report before this gate reads it`
    );
  }
  // A departure is a finding about the boundary the two lines at the top of
  // this report are drawn around, so it names the package that left it rather
  // than only reporting that the count moved -- otherwise a reader has to diff
  // two trees of manifests to find out what stopped being measured.
  for (const name of departed) {
    lines.push(
      `DEPARTED     ${name}`,
      `              publishable on main and not publishable here, so every advisory reachable only through it has gone unmeasured above`
    );
  }
  if (
    advisories.length + floored.length + suppressions.length + departed.length >
    0
  )
    lines.push('');

  const summary = [
    shippedCount === 0
      ? "No advisory is reachable from a publishable package's dependencies."
      : `${shippedCount} of ${advisories.length} advisories are reachable from a publishable package's dependencies. Severity is not the gate; reachability is.`
  ];
  if (floored.length > 0) {
    summary.push(
      `${floored.length} module(s) above are floored. A floor does not travel to a consumer, so what a consumer resolves was never measured.`
    );
  }
  if (suppressions.length > 0) {
    summary.push(
      suppressions.length === 1
        ? '1 auditConfig entry above suppresses advisories, so the count this report opens with is not the count pnpm found.'
        : `${suppressions.length} auditConfig entries above suppress advisories, so the count this report opens with is not the count pnpm found.`
    );
  }
  if (departed.length > 0) {
    summary.push(
      `${departed.length} package(s) above are publishable on main and are not publishable here, so this report measures a narrower boundary than the one consumers resolve.`
    );
  }
  lines.push(summary.join(' '));
  return lines.join('\n');
};

/**
 * @param {AuditInputs} inputs
 * @returns {{ report: string; advisories: ClassifiedAdvisory[]; exitCode: number }}
 */
export const gate = ({
  workspace,
  publishable,
  baseline,
  prodTrees,
  audit,
  overrides,
  suppressions
}) => {
  const advisories = classify(audit, shippedVersions(prodTrees));
  const floored = flooredModules(overrides, prodTrees);
  // No baseline means no comparison, and no line about one either: a developer
  // running this locally has no `main` manifests to compare against and should
  // see the report they saw before this existed. That is safe only because CI
  // never takes this branch -- gather() throws rather than passing null when it
  // was asked for a baseline and could not read one.
  const departed = baseline ? departedPackages(baseline, publishable) : [];
  return {
    report: formatReport(
      advisories,
      audit.metadata,
      workspace.length,
      publishable.map((pkg) => pkg.name),
      floored,
      suppressions,
      departed
    ),
    advisories,
    // A suppression fails on its own, and unlike a floor it is not scoped to a
    // publishable closure: an advisory pnpm removed from the report cannot be
    // tested for reachability, because it is not there to test. There is
    // nothing to intersect, so there is nothing to narrow this to. A departure
    // fails on its own for the same reason from the other side -- what left
    // the boundary took its closure out of the reachability walk with it, so
    // there is again nothing to intersect.
    exitCode:
      advisories.some((advisory) => advisory.shipped) ||
      floored.length > 0 ||
      suppressions.length > 0 ||
      departed.length > 0
        ? 1
        : 0
  };
};

/** @param {readonly string[]} args */
const pnpm = (args) =>
  execFileSync('pnpm', args, {
    cwd: repoRoot,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'inherit']
  });

/** @returns {AuditInputs} */
const gather = () => {
  const workspace = workspaceProjects(repoRoot);
  const publishable = selectPublishable(workspace);
  /** @type {ProjectTree[]} */
  const prodTrees = JSON.parse(
    pnpm([
      'list',
      '--prod',
      '--no-optional',
      '--depth',
      'Infinity',
      '--json',
      ...publishable.flatMap((pkg) => ['--filter', pkg.name])
    ])
  );

  let output;
  try {
    output = pnpm(['audit', '--json']);
  } catch (error) {
    // `pnpm audit` exits non-zero whenever it found anything at all, and also
    // when it could not reach the registry. Only the output tells those two
    // apart, so read it either way and let parseAuditOutput decide. A spawn
    // that produced no output at all is re-thrown and fails the gate.
    const stdout = /** @type {{ stdout?: unknown }} */ (error).stdout;
    if (typeof stdout !== 'string') throw error;
    output = stdout;
  }

  // Read rather than run: an override and an audit suppression are both
  // workspace settings, not command output. One file, read once, since the two
  // answers come out of the same parse either way.
  const workspaceYaml = readFileSync(
    new URL('../pnpm-workspace.yaml', import.meta.url),
    'utf8'
  );

  // The boundary comparison (#373) needs `main`'s manifests, which only CI has
  // fetched, so CI points this at the directory it extracted them into and a
  // developer machine leaves the variable unset and compares nothing.
  //
  // Set means mandatory. `publishableBaseline` throws when the directory is
  // missing, empty or carries no workspace file, rather than shrugging and
  // returning nothing to compare -- a gate that skips itself when its baseline
  // is absent is a bypass, and a bypass is the thing this comparison exists to
  // close. Unset is the only silence, and CI never leaves it unset.
  //
  // What remains, stated rather than hidden: a pull request can edit
  // `.github/workflows/ci.yml` and drop the variable, which is the same
  // residual the pinned run already carries ("A pull request can still edit
  // this file and take the pinned run out"). Neutering this is a diff to a
  // workflow file, not a field in a manifest.
  const baselineDir = process.env.PLAYDECK_PUBLISHABLE_BASELINE;

  return {
    workspace,
    publishable,
    baseline: baselineDir ? publishableBaseline(baselineDir) : null,
    prodTrees,
    audit: parseAuditOutput(output),
    overrides: workspaceOverrides(workspaceYaml),
    suppressions: workspaceSuppressions(workspaceYaml)
  };
};

// Only when run as a command: audit.test.mjs imports this module for its pure
// functions, and importing it must not shell out to pnpm.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const result = gate(gather());
    console.log(result.report);
    process.exit(result.exitCode);
  } catch (error) {
    // Not every throw is an Error — a rejection carrying a string would
    // otherwise print an empty line and exit 1 with no reason given.
    console.error(
      `\n${error instanceof Error ? error.message : String(error)}`
    );
    process.exit(1);
  }
}
