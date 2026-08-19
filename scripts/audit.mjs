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
// One thing besides an advisory fails it, and only one: an `overrides` entry
// in `pnpm-workspace.yaml` whose package name lands inside a publishable
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
import { selectPublishable, workspaceProjects } from './workspace-packages.mjs';

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
 * `link:<relative path>`.
 * @typedef {{ version: string; dependencies?: Record<string, DependencyNode> }} DependencyNode
 * @typedef {{ name: string; dependencies?: Record<string, DependencyNode> }} ProjectTree
 *
 * The three captured pnpm outputs the gate reads, plus the one thing gather()
 * derives from them -- which package boundary reachability is drawn around --
 * and the `overrides` block gather() reads from `pnpm-workspace.yaml`, keyed by
 * pnpm selector.
 * @typedef {{ workspace: WorkspaceProject[]; publishable: PublishablePackage[]; prodTrees: ProjectTree[]; audit: AuditReport; overrides: Readonly<Record<string, string>> }} AuditInputs
 * @typedef {{ severity: string; module: string; advisoryId: string; title: string; url: string; shipped: boolean; reachableFrom: string[]; paths: string[] }} ClassifiedAdvisory
 *
 * One `name@version` in a publishable package's closure whose name an override
 * floors. A workspace link counts, so the version may read `link:<path>`.
 * @typedef {{ module: string; reachableFrom: string[] }} FlooredModule
 */

// Report order only. The gate does not read it.
const SEVERITY_ORDER = ['critical', 'high', 'moderate', 'low', 'info'];

/**
 * Every `name@version` in the transitive `dependencies` closure of each
 * publishable package, mapped to the packages it is reachable from.
 * @param {readonly ProjectTree[]} prodTrees
 * @returns {Map<string, string[]>}
 */
export const shippedVersions = (prodTrees) => {
  /** @type {Map<string, string[]>} */
  const shipped = new Map();

  /**
   * @param {Record<string, DependencyNode> | undefined} dependencies
   * @param {string} owner
   */
  const walk = (dependencies, owner) => {
    for (const [name, node] of Object.entries(dependencies ?? {})) {
      // A workspace link is not a registry package and can carry no advisory
      // of its own. What it pulls in transitively is what matters, so keep
      // walking through it.
      if (!node.version.startsWith('link:')) {
        const owners = shipped.get(`${name}@${node.version}`) ?? [];
        if (!owners.includes(owner)) owners.push(owner);
        shipped.set(`${name}@${node.version}`, owners);
      }
      walk(node.dependencies, owner);
    }
  };

  for (const project of prodTrees) walk(project.dependencies, project.name);
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
 * Where no floored name appears, then, nothing the block could have changed is
 * in the closure: it is the one a consumer resolves, and the reachability this
 * gate reports holds. Where one does appear, both inputs the gate joins were
 * produced under that floor and neither can describe the un-floored version, so
 * the hits are reported and the gate fails.
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
 */
const formatReport = (
  advisories,
  metadata,
  importers,
  publishable,
  floored
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
  if (advisories.length + floored.length > 0) lines.push('');

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
  prodTrees,
  audit,
  overrides
}) => {
  const advisories = classify(audit, shippedVersions(prodTrees));
  const floored = flooredModules(overrides, prodTrees);
  return {
    report: formatReport(
      advisories,
      audit.metadata,
      workspace.length,
      publishable.map((pkg) => pkg.name),
      floored
    ),
    advisories,
    exitCode:
      advisories.some((advisory) => advisory.shipped) || floored.length > 0
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

  // Read rather than run: an override is a workspace setting, not command
  // output.
  const overrides = workspaceOverrides(
    readFileSync(new URL('../pnpm-workspace.yaml', import.meta.url), 'utf8')
  );

  return {
    workspace,
    publishable,
    prodTrees,
    audit: parseAuditOutput(output),
    overrides
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
