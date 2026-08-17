#!/usr/bin/env node
// The dependency audit gate.
//
// Severity is a label, not the axis. A `high` in a linting toolchain never
// reaches a consumer; a `low` under a published package's `dependencies`
// does. Gating on severity therefore fails loudest on the code that never
// ships and waves through the code that does, so this gate fails if and only
// if an advisory is reachable from a non-private workspace package's
// `dependencies` -- at any severity. Everything else is printed, labelled
// "not shipped", and left alone, whatever its severity.
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
import { fileURLToPath, URL } from 'node:url';
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
 * derives from them -- which package boundary reachability is drawn around.
 * @typedef {{ workspace: WorkspaceProject[]; publishable: PublishablePackage[]; prodTrees: ProjectTree[]; audit: AuditReport }} AuditInputs
 * @typedef {{ severity: string; module: string; advisoryId: string; title: string; url: string; shipped: boolean; reachableFrom: string[]; paths: string[] }} ClassifiedAdvisory
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
 * @param {readonly ClassifiedAdvisory[]} advisories
 * @param {AuditMetadata} metadata
 * @param {number} importers
 * @param {readonly string[]} publishable
 */
const formatReport = (advisories, metadata, importers, publishable) => {
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
  if (advisories.length > 0) lines.push('');

  lines.push(
    shippedCount === 0
      ? "No advisory is reachable from a publishable package's dependencies."
      : `${shippedCount} of ${advisories.length} advisories are reachable from a publishable package's dependencies. Severity is not the gate; reachability is.`
  );
  return lines.join('\n');
};

/**
 * @param {AuditInputs} inputs
 * @returns {{ report: string; advisories: ClassifiedAdvisory[]; exitCode: number }}
 */
export const gate = ({ workspace, publishable, prodTrees, audit }) => {
  const advisories = classify(audit, shippedVersions(prodTrees));
  return {
    report: formatReport(
      advisories,
      audit.metadata,
      workspace.length,
      publishable.map((pkg) => pkg.name)
    ),
    advisories,
    exitCode: advisories.some((advisory) => advisory.shipped) ? 1 : 0
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

  return { workspace, publishable, prodTrees, audit: parseAuditOutput(output) };
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
